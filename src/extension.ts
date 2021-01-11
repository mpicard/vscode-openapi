/*
 Copyright (c) 42Crunch Ltd. All rights reserved.
 Licensed under the GNU Affero General Public License version 3. See LICENSE.txt in the project root for license information.
*/

import * as vscode from "vscode";
import * as semver from "semver";
import { configuration, Configuration } from "./configuration";
import { RuntimeContext, extensionQualifiedId, CacheEntry } from "./types";
import { provideYamlSchemas } from "./util";
import { parserOptions } from "./parser-options";
import { registerOutlines } from "./outline";
import { JsonSchemaDefinitionProvider, YamlSchemaDefinitionProvider } from "./reference";
import { CompletionItemProvider } from "./completion";
import { updateContext } from "./context";
import { registerCommands } from "./commands";
import { create as createWhatsNewPanel } from "./whatsnew";
import { Cache } from "./cache";

import * as audit from "./audit/activate";
import * as preview from "./preview";

async function updateDiagnostics(current: CacheEntry, diagnostics: vscode.DiagnosticCollection) {
  if (current.errors) {
    diagnostics.set(current.uri, current.errors);
    vscode.commands.executeCommand("setContext", "openapiErrors", true);
  } else {
    diagnostics.delete(current.uri);
    vscode.commands.executeCommand("setContext", "openapiErrors", false);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const versionProperty = "openapiVersion";
  const openapiExtension = vscode.extensions.getExtension(extensionQualifiedId);
  const currentVersion = semver.parse(openapiExtension.packageJSON.version);
  const previousVersion = context.globalState.get<string>(versionProperty)
    ? semver.parse(context.globalState.get<string>(versionProperty))
    : semver.parse("0.0.1");
  const yamlConfiguration = new Configuration("yaml");
  context.globalState.update(versionProperty, currentVersion.toString());
  parserOptions.configure(yamlConfiguration);

  const cache = new Cache();
  cache.onDidChange(updateContext);
  cache.onDidChange((entry) => updateDiagnostics(entry, runtimeContext.diagnostics));

  context.subscriptions.push(...registerOutlines(context, cache.onDidActiveDocumentChange));
  context.subscriptions.push(...registerCommands());

  const jsonFile: vscode.DocumentSelector = { language: "json" };
  const jsoncFile: vscode.DocumentSelector = { language: "jsonc" };
  const yamlFile: vscode.DocumentSelector = { language: "yaml" };

  const completionProvider = new CompletionItemProvider(context, cache.onDidActiveDocumentChange);
  vscode.languages.registerCompletionItemProvider(yamlFile, completionProvider, '"');
  vscode.languages.registerCompletionItemProvider(jsonFile, completionProvider, '"');
  vscode.languages.registerCompletionItemProvider(jsoncFile, completionProvider, '"');

  const jsonSchemaDefinitionProvider = new JsonSchemaDefinitionProvider();
  const yamlSchemaDefinitionProvider = new YamlSchemaDefinitionProvider();

  vscode.languages.registerDefinitionProvider(jsonFile, jsonSchemaDefinitionProvider);
  vscode.languages.registerDefinitionProvider(jsoncFile, jsonSchemaDefinitionProvider);
  vscode.languages.registerDefinitionProvider(yamlFile, yamlSchemaDefinitionProvider);

  const runtimeContext: RuntimeContext = {
    diagnostics: vscode.languages.createDiagnosticCollection("openapi"),
    bundlingDiagnostics: vscode.languages.createDiagnosticCollection("openapi-bundling"),
  };

  vscode.workspace.onDidCloseTextDocument((document) => {
    runtimeContext.diagnostics.delete(document.uri);
  });

  // trigger refresh on activation
  cache.onActiveEditorChanged(vscode.window.activeTextEditor);

  vscode.window.onDidChangeActiveTextEditor((e) => cache.onActiveEditorChanged(e));
  vscode.workspace.onDidChangeTextDocument((e) => cache.onDocumentChanged(e));

  const yamlExtension = vscode.extensions.getExtension("redhat.vscode-yaml");
  provideYamlSchemas(context, yamlExtension);

  audit.activate(context, runtimeContext);
  preview.activate(context, runtimeContext);

  if (previousVersion.major < currentVersion.major) {
    createWhatsNewPanel(context);
  }

  configuration.configure(context);
  yamlConfiguration.configure(context);
}

export function deactivate() {}
