import * as vscode from "vscode";
import { detectTargetLanguage, detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import { scanTxtJetIssues, TxtJetIssue } from "./scanner";

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

const MODE_STORAGE_KEY = "txtjet.documentLanguageModes";
const CONFIG_SECTION = "txtjet";
const DIAGNOSTIC_SOURCE = "txtjet";

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "txtjet.selectTargetLanguage";
  context.subscriptions.push(statusBar);
  const diagnostics = vscode.languages.createDiagnosticCollection("txtjet");
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.detectTargetLanguage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetDocument(editor.document)) {
        return;
      }

      await applyDetectedLanguage(context, editor.document, true, statusBar);
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
        await setLanguage(context, editor.document, picked.languageId, statusBar, true);
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

        await setLanguage(context, editor.document, option.languageId, statusBar, true);
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.clearLanguage.active", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetFile(editor.document)) {
        return;
      }

      await clearStoredLanguage(context, editor.document);
      await setLanguage(context, editor.document, "txtjet", statusBar, false);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.clearLanguage.all", async () => {
      await context.workspaceState.update(MODE_STORAGE_KEY, {});
      updateStatusBar(statusBar, vscode.window.activeTextEditor?.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyDetectedLanguage(context, document, false, statusBar);
      updateDiagnostics(diagnostics, document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(diagnostics, event.document))
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri))
  );

  context.subscriptions.push(registerCompletionProvider());

  for (const document of vscode.workspace.textDocuments) {
    void applyDetectedLanguage(context, document, false, statusBar);
    updateDiagnostics(diagnostics, document);
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

async function applyDetectedLanguage(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  allowManualModes: boolean,
  statusBar: vscode.StatusBarItem
): Promise<void> {
  if (!isTxtJetDocument(document)) {
    return;
  }

  const storedLanguage = getStoredLanguage(context, document);
  if (storedLanguage && !allowManualModes) {
    await setLanguage(context, document, storedLanguage, statusBar, false);
    return;
  }

  if (!allowManualModes && document.languageId !== "txtjet") {
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!allowManualModes && !config.get<boolean>("autoDetect.enabled", true)) {
    const preferred = config.get<TxtJetTargetLanguage>("defaultTargetLanguage", "txtjet");
    if (preferred !== "txtjet") {
      await setLanguage(context, document, preferred, statusBar, false);
    }
    return;
  }

  const target = detectLanguage(document);
  if (target === document.languageId) {
    return;
  }

  if (target === "txtjet" && !allowManualModes) {
    return;
  }

  await setLanguage(context, document, target, statusBar, allowManualModes);
}

function isTxtJetDocument(document: vscode.TextDocument): boolean {
  return isTxtJetFile(document) && TXTJET_LANGUAGES.has(document.languageId as TxtJetTargetLanguage);
}

function isTxtJetFile(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file"
    && document.fileName.endsWith(".txtjet");
}

async function setLanguage(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  languageId: TxtJetTargetLanguage,
  statusBar: vscode.StatusBarItem,
  persist: boolean
): Promise<void> {
  if (persist) {
    await storeLanguage(context, document, languageId);
  }

  if (document.languageId === languageId) {
    updateStatusBar(statusBar, document);
    return;
  }

  await vscode.languages.setTextDocumentLanguage(document, languageId);
  updateStatusBar(statusBar, document);
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

function updateDiagnostics(collection: vscode.DiagnosticCollection, document: vscode.TextDocument): void {
  if (!isTxtJetFile(document)) {
    return;
  }

  const diagnostics = scanTxtJetIssues(document.getText()).map((issue) => issueToDiagnostic(document, issue));
  collection.set(document.uri, diagnostics);
}

function issueToDiagnostic(document: vscode.TextDocument, issue: TxtJetIssue): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end)),
    issue.message,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = issue.code;
  return diagnostic;
}

function registerCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideCompletionItems(document, position) {
        if (isInsideDirective(document, position)) {
          return directiveCompletions();
        }

        if (isInsideTemplateBlock(document, position)) {
          return [];
        }

        return markerCompletions(markerCompletionRange(document, position));
      }
    },
    "<",
    "@",
    " "
  );
}

function markerCompletions(range: vscode.Range | undefined): vscode.CompletionItem[] {
  return [
    snippet("<%", "TxtJet scriptlet", "<%\n\t$0\n%>", range),
    snippet("<%=", "TxtJet expression", "<%= $1 %>", range),
    snippet("<%!", "TxtJet declaration", "<%!\n\t$0\n%>", range),
    snippet("<%@", "TxtJet directive", "<%@ $1 %>", range)
  ];
}

function directiveCompletions(): vscode.CompletionItem[] {
  return [
    keyword("jet", "TxtJet directive"),
    keyword("include", "Include directive"),
    attribute("package"),
    attribute("class"),
    attribute("imports"),
    attribute("file")
  ];
}

function snippet(label: string, detail: string, insertText: string, range?: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
  item.detail = detail;
  item.insertText = new vscode.SnippetString(insertText);
  item.range = range;
  return item;
}

function keyword(label: string, detail: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
  item.detail = detail;
  return item;
}

function attribute(label: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
  item.detail = "TxtJet directive attribute";
  item.insertText = new vscode.SnippetString(`${label}="$1"`);
  return item;
}

function isInsideDirective(document: vscode.TextDocument, position: vscode.Position): boolean {
  const offset = document.offsetAt(position);
  const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const directiveOpen = textBefore.lastIndexOf("<%@");
  const lastClose = textBefore.lastIndexOf("%>");
  return directiveOpen > lastClose;
}

function isInsideTemplateBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
  const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  const blockOpen = Math.max(
    textBefore.lastIndexOf("<%@"),
    textBefore.lastIndexOf("<%="),
    textBefore.lastIndexOf("<%!"),
    textBefore.lastIndexOf("<%")
  );
  const lastClose = textBefore.lastIndexOf("%>");
  return blockOpen > lastClose;
}

function markerCompletionRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  if (!linePrefix.endsWith("<")) {
    return undefined;
  }
  return new vscode.Range(position.translate(0, -1), position);
}

function detectLanguage(document: vscode.TextDocument): TxtJetTargetLanguage {
  const byFileName = detectTargetLanguageFromFileName(document.fileName);
  if (byFileName !== "txtjet") {
    return byFileName;
  }
  return detectTargetLanguage(document.getText());
}

function getStoredLanguage(context: vscode.ExtensionContext, document: vscode.TextDocument): TxtJetTargetLanguage | undefined {
  const stored = context.workspaceState.get<Record<string, TxtJetTargetLanguage>>(MODE_STORAGE_KEY, {});
  const languageId = stored[document.uri.toString()];
  return TXTJET_LANGUAGES.has(languageId) ? languageId : undefined;
}

async function storeLanguage(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  languageId: TxtJetTargetLanguage
): Promise<void> {
  const stored = context.workspaceState.get<Record<string, TxtJetTargetLanguage>>(MODE_STORAGE_KEY, {});
  await context.workspaceState.update(MODE_STORAGE_KEY, {
    ...stored,
    [document.uri.toString()]: languageId
  });
}

async function clearStoredLanguage(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
  const uri = document.uri.toString();
  const stored = { ...context.workspaceState.get<Record<string, TxtJetTargetLanguage>>(MODE_STORAGE_KEY, {}) };
  delete stored[uri];
  await context.workspaceState.update(MODE_STORAGE_KEY, stored);
}
