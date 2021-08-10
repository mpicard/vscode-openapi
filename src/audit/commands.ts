/*
 Copyright (c) 42Crunch Ltd. All rights reserved.
 Licensed under the GNU Affero General Public License version 3. See LICENSE.txt in the project root for license information.
*/
import { basename } from "path";
import * as vscode from "vscode";

import { audit, requestToken } from "./client";
import { setDecorations, updateDecorations } from "./decoration";
import { updateDiagnostics } from "./diagnostic";

import { ReportWebView } from "./report";
import { TextDocument } from "vscode";
import { findMapping } from "../bundler";
import { Node } from "@xliic/openapi-ast-node";
import { AuditContext, Audit, Grades, Issue, ReportedIssue, IssuesByDocument } from "../types";

import { Cache } from "../cache";
import { getLocationByPointer } from "./util";
import { stringify } from "@xliic/preserving-json-yaml-parser";

function findIssueLocation(
  mainUri: vscode.Uri,
  root: Node,
  mappings,
  pointer
): [string, string] | undefined {
  const node = root.find(pointer);
  if (node) {
    return [mainUri.toString(), pointer];
  } else {
    const mapping = findMapping(mappings, pointer);
    if (mapping.hash) {
      return [mapping.uri, mapping.hash];
    }
  }
}

async function processIssues(
  document: vscode.TextDocument,
  cache: Cache,
  mappings,
  issues: ReportedIssue[]
): Promise<[Node, string[], { [uri: string]: ReportedIssue[] }, ReportedIssue[]]> {
  const mainUri = document.uri;
  const documentUris: { [uri: string]: boolean } = { [mainUri.toString()]: true };
  const issuesPerDocument: { [uri: string]: ReportedIssue[] } = {};
  const badIssues: ReportedIssue[] = [];

  const root = cache.getLastGoodDocumentAst(document);

  for (const issue of issues) {
    const location = findIssueLocation(mainUri, root, mappings, issue.pointer);
    if (location) {
      const [uri, pointer] = location;

      if (!issuesPerDocument[uri]) {
        issuesPerDocument[uri] = [];
      }

      if (!documentUris[uri]) {
        documentUris[uri] = true;
      }

      issuesPerDocument[uri].push({
        ...issue,
        pointer: pointer,
      });
    } else {
      // can't find issue, add to the list ot bad issues
      badIssues.push(issue);
    }
  }

  return [root, Object.keys(documentUris), issuesPerDocument, badIssues];
}

async function auditDocument(
  mainDocument: TextDocument,
  json: string,
  cache: Cache,
  mappings,
  apiToken,
  progress
): Promise<[Grades, IssuesByDocument, { [uri: string]: TextDocument }, ReportedIssue[]]> {
  const [grades, reportedIssues] = await audit(json, apiToken.trim(), progress);
  const [mainRoot, documentUris, issuesPerDocument, badIssues] = await processIssues(
    mainDocument,
    cache,
    mappings,
    reportedIssues
  );

  const files: { [uri: string]: [TextDocument, Node] } = {
    [mainDocument.uri.toString()]: [mainDocument, mainRoot],
  };

  // load and parse all documents
  for (const uri of documentUris) {
    if (!files[uri]) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      const root = cache.getLastGoodDocumentAst(document);
      files[uri] = [document, root];
    }
  }

  const issues: IssuesByDocument = {};
  for (const [uri, reportedIssues] of Object.entries(issuesPerDocument)) {
    const [document, root] = files[uri];
    issues[uri] = reportedIssues.map((issue: ReportedIssue): Issue => {
      const [lineNo, range] = getLocationByPointer(document, root, issue.pointer);
      return {
        ...issue,
        documentUri: uri,
        lineNo,
        range,
      };
    });
  }

  const documents = {};
  for (const [uri, [document, root]] of Object.entries(files)) {
    documents[uri] = document;
  }

  return [grades, issues, documents, badIssues];
}
