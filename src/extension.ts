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

const LANGUAGE_OPTIONS: Array<{ label: string; description: string; languageId: TxtJetTargetLanguage; command: string }> = [
  { label: "TxtJet", description: "Generic template text", languageId: "txtjet", command: "txtjet.setLanguage.default" },
  { label: "TxtJet Java", description: "Java output", languageId: "txtjet-java", command: "txtjet.setLanguage.java" },
  { label: "TxtJet HTML", description: "HTML output", languageId: "txtjet-html", command: "txtjet.setLanguage.html" },
  { label: "TxtJet XML", description: "XML output", languageId: "txtjet-xml", command: "txtjet.setLanguage.xml" },
  { label: "TxtJet C", description: "C output", languageId: "txtjet-c", command: "txtjet.setLanguage.c" },
  { label: "TxtJet Python", description: "Python output", languageId: "txtjet-python", command: "txtjet.setLanguage.python" }
];

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "txtjet.selectTargetLanguage";
  context.subscriptions.push(statusBar);

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
    vscode.commands.registerCommand("txtjet.selectTargetLanguage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetFile(editor.document)) {
        return;
      }

      const picked = await vscode.window.showQuickPick(
        LANGUAGE_OPTIONS.map((option) => ({
          label: option.label,
          description: option.description,
          languageId: option.languageId
        })),
        {
          title: "Select TxtJet target language",
          placeHolder: "Choose the generated output language for this template"
        }
      );

      if (picked) {
        await setLanguage(editor.document, picked.languageId);
      }
    })
  );

  for (const option of LANGUAGE_OPTIONS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(option.command, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isTxtJetFile(editor.document)) {
          return;
        }

        await setLanguage(editor.document, option.languageId);
      })
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyDetectedLanguage(document, false);
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    void applyDetectedLanguage(document, false);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => updateStatusBar(statusBar, editor?.document))
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(() => updateStatusBar(statusBar, vscode.window.activeTextEditor?.document))
  );
  updateStatusBar(statusBar, vscode.window.activeTextEditor?.document);
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

  await setLanguage(document, target);
}

function isTxtJetDocument(document: vscode.TextDocument): boolean {
  return isTxtJetFile(document) && TXTJET_LANGUAGES.has(document.languageId as TxtJetTargetLanguage);
}

function isTxtJetFile(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file"
    && document.fileName.endsWith(".txtjet");
}

async function setLanguage(document: vscode.TextDocument, languageId: TxtJetTargetLanguage): Promise<void> {
  if (document.languageId === languageId) {
    return;
  }

  await vscode.languages.setTextDocumentLanguage(document, languageId);
}

function updateStatusBar(statusBar: vscode.StatusBarItem, document?: vscode.TextDocument): void {
  if (!document || !isTxtJetFile(document)) {
    statusBar.hide();
    return;
  }

  const current = LANGUAGE_OPTIONS.find((option) => option.languageId === document.languageId);
  statusBar.text = current ? `TxtJet: ${current.label.replace("TxtJet ", "")}` : "TxtJet: Select";
  statusBar.tooltip = "Select TxtJet target language";
  statusBar.show();
}
