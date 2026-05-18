import * as vscode from "vscode";
import { detectTargetLanguage, TxtJetTargetLanguage } from "./detector";

const TXTJET_LANGUAGES = new Set<TxtJetTargetLanguage>([
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python"
]);

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.detectTargetLanguage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetDocument(editor.document)) {
        return;
      }

      await applyDetectedLanguage(editor.document, true);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyDetectedLanguage(document, false);
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    void applyDetectedLanguage(document, false);
  }
}

export function deactivate(): void {
  return;
}

async function applyDetectedLanguage(document: vscode.TextDocument, allowManualModes: boolean): Promise<void> {
  if (!isTxtJetDocument(document)) {
    return;
  }

  if (!allowManualModes && document.languageId !== "txtjet") {
    return;
  }

  const target = detectTargetLanguage(document.getText());
  if (target === document.languageId) {
    return;
  }

  if (target === "txtjet" && !allowManualModes) {
    return;
  }

  await vscode.languages.setTextDocumentLanguage(document, target);
}

function isTxtJetDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file"
    && document.fileName.endsWith(".txtjet")
    && TXTJET_LANGUAGES.has(document.languageId as TxtJetTargetLanguage);
}
