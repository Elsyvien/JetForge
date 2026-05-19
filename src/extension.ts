import { existsSync, readFileSync } from "node:fs";
import * as vscode from "vscode";
import { buildTxtJetCodeActionEdit } from "./codeActions";
import { detectTargetLanguage, detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import { COMPLETION_TRIGGER_CHARACTERS, isTxtJetPath, shouldOfferMarkerCompletions } from "./extensionSupport";
import { scanTxtJetDirectiveIssues, scanTxtJetIssues, TxtJetIssue } from "./scanner";
import {
  buildGeneratedJavaPreview,
  buildGeneratedOutputPreview,
  headerComment,
  mapPreviewRangeToSource,
  mapSourceRangeToPreview,
  parseTxtJetTemplate,
  resolveIncludePath,
  targetPreviewLanguage,
  TxtJetBlock,
  TxtJetDirective,
  TxtJetGeneratedPreview,
  TxtJetRange
} from "./templateModel";

const TXTJET_LANGUAGES = new Set<TxtJetTargetLanguage>([
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python"
]);

const LANGUAGE_OPTIONS: Array<{ label: string; shortLabel: string; description: string; languageId: TxtJetTargetLanguage; command: string }> = [
  { label: "Generic TxtJet Template", shortLabel: "Generic", description: "Outer content is plain template text; embedded Java is still highlighted.", languageId: "txtjet", command: "txtjet.setLanguage.default" },
  { label: "Generated Java Output", shortLabel: "Java output", description: "Use only when the generated outer content is Java.", languageId: "txtjet-java", command: "txtjet.setLanguage.java" },
  { label: "Generated HTML Output", shortLabel: "HTML output", description: "Use only when the generated outer content is HTML.", languageId: "txtjet-html", command: "txtjet.setLanguage.html" },
  { label: "Generated XML Output", shortLabel: "XML output", description: "Use only when the generated outer content is XML.", languageId: "txtjet-xml", command: "txtjet.setLanguage.xml" },
  { label: "Generated C Output", shortLabel: "C output", description: "Use only when the generated outer content is C/C header code.", languageId: "txtjet-c", command: "txtjet.setLanguage.c" },
  { label: "Generated Python Output", shortLabel: "Python output", description: "Use only when the generated outer content is Python.", languageId: "txtjet-python", command: "txtjet.setLanguage.python" }
];

const MODE_STORAGE_KEY = "txtjet.documentLanguageModes.v2";
const CONFIG_SECTION = "txtjet";
const DIAGNOSTIC_SOURCE = "txtjet";
const DEFAULT_MAX_DIAGNOSTIC_FILE_SIZE_KB = 1024;
const OUTPUT_PREVIEW_SCHEME = "txtjet-preview-output";
const JAVA_PREVIEW_SCHEME = "txtjet-preview-java";

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "txtjet.selectTargetLanguage";
  context.subscriptions.push(statusBar);
  const diagnostics = vscode.languages.createDiagnosticCollection("txtjet");
  context.subscriptions.push(diagnostics);
  const previewProvider = new TxtJetPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(OUTPUT_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(JAVA_PREVIEW_SCHEME, previewProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.detectTargetLanguage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetDocument(editor.document)) {
        return;
      }

      await clearStoredLanguage(context, editor.document);
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
        languageQuickPickItems(context, editor.document),
        {
          title: "Select generated output mode",
          placeHolder: "Choose the generated output language. Embedded Java is always highlighted."
        }
      );

      if (picked) {
        if (picked.languageId === "auto") {
          await clearStoredLanguage(context, editor.document);
          await applyDetectedLanguage(context, editor.document, true, statusBar);
        } else {
          await setLanguage(context, editor.document, picked.languageId, statusBar, true);
        }
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
      updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openGeneratedOutputPreview", async () => {
      await openPreview("output", false);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openGeneratedJavaPreview", async () => {
      await openPreview("java", false);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openPreviewBesideSource", async () => {
      await openPreview("output", true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.revealPreviewFromSource", async () => {
      await revealPreviewFromSource();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.revealSourceFromPreview", async () => {
      await revealSourceFromPreview();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyDetectedLanguage(context, document, false, statusBar);
      updateDiagnostics(diagnostics, document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      updateDiagnostics(diagnostics, event.document);
      previewProvider.refresh(event.document.uri);
    })
  );
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      for (const uri of event.uris) {
        if (uri.scheme !== JAVA_PREVIEW_SCHEME) {
          continue;
        }
        const source = sourceUriFromPreview(uri);
        const sourceDocument = source
          ? vscode.workspace.textDocuments.find((document) => document.uri.toString() === source.toString())
          : undefined;
        if (sourceDocument) {
          updateDiagnostics(diagnostics, sourceDocument);
        }
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) {
        return;
      }

      updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context);
      for (const document of vscode.workspace.textDocuments) {
        updateDiagnostics(diagnostics, document);
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      previewProvider.forget(document.uri);
    })
  );

  context.subscriptions.push(registerCompletionProvider());
  context.subscriptions.push(registerCodeActionProvider());
  context.subscriptions.push(registerDocumentSymbolProvider());
  context.subscriptions.push(registerDefinitionProvider());

  for (const document of vscode.workspace.textDocuments) {
    void applyDetectedLanguage(context, document, false, statusBar);
    updateDiagnostics(diagnostics, document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => updateStatusBar(statusBar, editor?.document, context))
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(() => updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context))
  );
  updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context);
}

export function deactivate(): void {
  return;
}

type PreviewKind = "output" | "java";

class TxtJetPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private readonly previewsBySource = new Map<string, Set<string>>();

  readonly onDidChange = this.changed.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const source = sourceUriFromPreview(uri);
    const target = targetLanguageFromPreview(uri);
    if (!source) {
      return "TxtJet preview source is unavailable.";
    }

    this.track(source, uri);
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === source.toString());
    if (!document) {
      return "Open the source TxtJet document to refresh this preview.";
    }

    if (uri.scheme === JAVA_PREVIEW_SCHEME) {
      return buildGeneratedJavaPreview(document.getText(), document.fileName).text;
    }
    const targetLanguage = target ?? detectLanguage(document);
    return buildOutputPreviewForDocument(document, targetLanguage).text;
  }

  refresh(source: vscode.Uri): void {
    const previews = this.previewsBySource.get(source.toString());
    if (!previews) {
      return;
    }
    for (const preview of previews) {
      this.changed.fire(vscode.Uri.parse(preview));
    }
  }

  forget(closed: vscode.Uri): void {
    this.previewsBySource.delete(closed.toString());

    for (const [source, previews] of this.previewsBySource) {
      previews.delete(closed.toString());
      if (previews.size === 0) {
        this.previewsBySource.delete(source);
      }
    }
  }

  private track(source: vscode.Uri, preview: vscode.Uri): void {
    const key = source.toString();
    const previews = this.previewsBySource.get(key) ?? new Set<string>();
    previews.add(preview.toString());
    this.previewsBySource.set(key, previews);
  }
}

async function openPreview(kind: PreviewKind, forceBeside: boolean): Promise<void> {
  const sourceEditor = vscode.window.activeTextEditor;
  if (!sourceEditor || !isTxtJetFile(sourceEditor.document)) {
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, sourceEditor.document.uri);
  if (!config.get<boolean>("previews.enabled", true)) {
    return;
  }
  if (kind === "java" && !config.get<boolean>("previews.generatedJava.enabled", true)) {
    return;
  }

  const detectedLanguage = detectLanguage(sourceEditor.document);
  const preview = buildPreviewForDocument(sourceEditor.document, kind);
  const mappedPreviewRange = mapSourceRangeToPreview(
    preview.mappings,
    selectionToRange(sourceEditor.document, sourceEditor.selection)
  );
  const previewUri = buildPreviewUri(sourceEditor.document, kind);
  const previewDocument = await vscode.workspace.openTextDocument(previewUri);
  const targetLanguage = kind === "java" ? "java" : targetPreviewLanguage(detectedLanguage);
  const updatedDocument = await vscode.languages.setTextDocumentLanguage(previewDocument, targetLanguage);
  const viewColumn = forceBeside || config.get<boolean>("previews.openBeside", true)
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.Active;
  const previewEditor = await vscode.window.showTextDocument(updatedDocument, { preview: true, viewColumn });
  revealMappedPreviewRange(previewEditor, mappedPreviewRange);
}

function buildPreviewUri(document: vscode.TextDocument, kind: PreviewKind): vscode.Uri {
  const scheme = kind === "java" ? JAVA_PREVIEW_SCHEME : OUTPUT_PREVIEW_SCHEME;
  const detectedLanguage = detectLanguage(document);
  const suffix = kind === "java" ? ".java" : `.preview.${targetPreviewLanguage(detectedLanguage)}`;
  return vscode.Uri.from({
    scheme,
    path: `${document.uri.path}${suffix}`,
    query: kind === "java"
      ? `source=${encodeURIComponent(document.uri.toString())}`
      : `source=${encodeURIComponent(document.uri.toString())}&target=${encodeURIComponent(detectedLanguage)}`
  });
}

function sourceUriFromPreview(uri: vscode.Uri): vscode.Uri | undefined {
  const source = queryValue(uri, "source");
  return source ? vscode.Uri.parse(source) : undefined;
}

function targetLanguageFromPreview(uri: vscode.Uri): TxtJetTargetLanguage | undefined {
  const target = queryValue(uri, "target");
  return target && TXTJET_LANGUAGES.has(target as TxtJetTargetLanguage)
    ? target as TxtJetTargetLanguage
    : undefined;
}

function queryValue(uri: vscode.Uri, key: string): string | undefined {
  for (const part of uri.query.split("&")) {
    const separator = part.indexOf("=");
    const candidate = separator === -1 ? part : part.slice(0, separator);
    if (candidate === key) {
      const value = separator === -1 ? "" : part.slice(separator + 1);
      return decodeURIComponent(value);
    }
  }
  return undefined;
}

function buildPreview(text: string, kind: PreviewKind, targetLanguage: TxtJetTargetLanguage): TxtJetGeneratedPreview {
  return kind === "java" ? buildGeneratedJavaPreview(text) : buildGeneratedOutputPreview(text, targetLanguage);
}

function buildPreviewForDocument(document: vscode.TextDocument, kind: PreviewKind): TxtJetGeneratedPreview {
  const targetLanguage = detectLanguage(document);
  return kind === "java"
    ? buildGeneratedJavaPreview(document.getText(), document.fileName)
    : buildOutputPreviewForDocument(document, targetLanguage);
}

function buildOutputPreviewForDocument(
  document: vscode.TextDocument,
  targetLanguage: TxtJetTargetLanguage
): TxtJetGeneratedPreview {
  const header = headerComment("output", document.fileName, targetLanguage);
  const preview = buildGeneratedOutputPreview(document.getText(), targetLanguage, outputPreviewOptions(document));
  return {
    text: header + preview.text,
    mappings: preview.mappings.map((mapping) => ({
      ...mapping,
      preview: {
        start: mapping.preview.start + header.length,
        end: mapping.preview.end + header.length
      }
    }))
  };
}

function outputPreviewOptions(document: vscode.TextDocument) {
  return {
    sourceFileName: document.fileName,
    expandIncludes: true,
    readInclude(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    }
  };
}

function selectionToRange(document: vscode.TextDocument, selection: vscode.Selection): TxtJetRange {
  return {
    start: document.offsetAt(selection.start),
    end: document.offsetAt(selection.end)
  };
}

function revealMappedPreviewRange(editor: vscode.TextEditor, range: TxtJetRange | undefined): void {
  if (!range) {
    return;
  }

  const start = editor.document.positionAt(range.start);
  const end = editor.document.positionAt(Math.max(range.start, range.end));
  const vscodeRange = new vscode.Range(start, end);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(vscodeRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function revealPreviewFromSource(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document)) {
    return;
  }

  const preview = buildPreviewForDocument(editor.document, "output");
  const mappedRange = mapSourceRangeToPreview(preview.mappings, selectionToRange(editor.document, editor.selection));
  const previewUri = buildPreviewUri(editor.document, "output");
  const previewDocument = await vscode.workspace.openTextDocument(previewUri);
  const updatedDocument = await vscode.languages.setTextDocumentLanguage(previewDocument, targetPreviewLanguage(detectLanguage(editor.document)));
  const previewEditor = await vscode.window.showTextDocument(updatedDocument, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  revealMappedPreviewRange(previewEditor, mappedRange);
}

async function revealSourceFromPreview(): Promise<void> {
  const previewEditor = vscode.window.activeTextEditor;
  if (!previewEditor || !isPreviewDocument(previewEditor.document)) {
    return;
  }

  const source = sourceUriFromPreview(previewEditor.document.uri);
  if (!source) {
    return;
  }

  const sourceDocument = await vscode.workspace.openTextDocument(source);
  const kind: PreviewKind = previewEditor.document.uri.scheme === JAVA_PREVIEW_SCHEME ? "java" : "output";
  const preview = buildPreviewForDocument(sourceDocument, kind);
  const mappedRange = mapPreviewRangeToSource(preview.mappings, selectionToRange(previewEditor.document, previewEditor.selection));
  const sourceEditor = await vscode.window.showTextDocument(sourceDocument, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  revealMappedPreviewRange(sourceEditor, mappedRange);
}

function isPreviewDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === OUTPUT_PREVIEW_SCHEME || document.uri.scheme === JAVA_PREVIEW_SCHEME;
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

  await setLanguage(context, document, target, statusBar, false);
}

function isTxtJetDocument(document: vscode.TextDocument): boolean {
  return isTxtJetFile(document) && TXTJET_LANGUAGES.has(document.languageId as TxtJetTargetLanguage);
}

function isTxtJetFile(document: vscode.TextDocument): boolean {
  return isTxtJetPath(document.uri.path) || isTxtJetPath(document.fileName);
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
    updateStatusBar(statusBar, document, context);
    return;
  }

  const updatedDocument = await vscode.languages.setTextDocumentLanguage(document, languageId);
  updateStatusBar(statusBar, updatedDocument, context);
}

function updateStatusBar(
  statusBar: vscode.StatusBarItem,
  document?: vscode.TextDocument,
  context?: vscode.ExtensionContext
): void {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document?.uri);
  if (!config.get<boolean>("statusBar.enabled", true)) {
    statusBar.hide();
    return;
  }

  if (!document || !isTxtJetFile(document)) {
    statusBar.hide();
    return;
  }

  const current = LANGUAGE_OPTIONS.find((option) => option.languageId === document.languageId);
  const storedLanguage = context ? getStoredLanguage(context, document) : undefined;
  const persistenceLabel = storedLanguage ? "remembered manual mode" : "auto/default mode";
  statusBar.text = current ? `TxtJet: ${current.shortLabel}` : "TxtJet: Select output";
  statusBar.tooltip = [
    "Select generated output mode.",
    `Current language id: ${document.languageId}.`,
    `Persistence: ${persistenceLabel}.`,
    "Embedded Java is always highlighted."
  ].join(" ");
  statusBar.show();
}

function updateDiagnostics(collection: vscode.DiagnosticCollection, document: vscode.TextDocument): void {
  if (!isTxtJetFile(document)) {
    collection.delete(document.uri);
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.enabled", true)) {
    collection.delete(document.uri);
    return;
  }

  const maxFileSizeKb = config.get<number>("diagnostics.maxFileSizeKb", DEFAULT_MAX_DIAGNOSTIC_FILE_SIZE_KB);
  if (maxFileSizeKb > 0 && Buffer.byteLength(document.getText(), "utf8") > maxFileSizeKb * 1024) {
    collection.delete(document.uri);
    return;
  }

  const severity = diagnosticSeverityFromSetting(config.get<string>("diagnostics.severity", "warning"));
  const text = document.getText();
  const diagnostics = [
    ...scanTxtJetIssues(text),
    ...scanTxtJetDirectiveIssues(text, (includeFile) => {
      const resolved = resolveIncludePath(document.fileName, includeFile);
      return Boolean(resolved && existsSync(resolved));
    })
  ].map((issue) => issueToDiagnostic(document, issue, severity));
  collection.set(document.uri, diagnostics.concat(mappedGeneratedJavaDiagnostics(document)));
}

function issueToDiagnostic(
  document: vscode.TextDocument,
  issue: TxtJetIssue,
  severity: vscode.DiagnosticSeverity
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end)),
    issue.message,
    severity
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = issue.code;
  return diagnostic;
}

function diagnosticSeverityFromSetting(value: string | undefined): vscode.DiagnosticSeverity {
  switch (value) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "information":
      return vscode.DiagnosticSeverity.Information;
    case "hint":
      return vscode.DiagnosticSeverity.Hint;
    case "warning":
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

function mappedGeneratedJavaDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.generatedJava.enabled", false)) {
    return [];
  }

  const javaPreviewUri = buildPreviewUri(document, "java");
  const previewDiagnostics = vscode.languages.getDiagnostics(javaPreviewUri);
  if (previewDiagnostics.length === 0) {
    return [];
  }

  const preview = buildGeneratedJavaPreview(document.getText(), document.fileName);
  return previewDiagnostics.flatMap((diagnostic) => {
    const mappedRange = mapPreviewRangeToSource(preview.mappings, {
      start: offsetAt(preview.text, diagnostic.range.start),
      end: offsetAt(preview.text, diagnostic.range.end)
    });
    if (!mappedRange) {
      return [];
    }

    const mappedDiagnostic = new vscode.Diagnostic(
      new vscode.Range(document.positionAt(mappedRange.start), document.positionAt(mappedRange.end)),
      `Generated Java preview: ${diagnostic.message}`,
      diagnostic.severity
    );
    mappedDiagnostic.source = `${DIAGNOSTIC_SOURCE}.generatedJava`;
    mappedDiagnostic.code = diagnostic.code;
    return [mappedDiagnostic];
  });
}

function offsetAt(text: string, position: vscode.Position): number {
  let line = 0;
  let lineStart = 0;
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === "\n") {
      if (line === position.line) {
        return Math.min(lineStart + position.character, offset);
      }
      line += 1;
      lineStart = offset + 1;
    }
  }
  return line === position.line ? Math.min(lineStart + position.character, text.length) : text.length;
}

function registerCodeActionProvider(): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideCodeActions(document, range, context) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
        if (!config.get<boolean>("codeActions.enabled", true)) {
          return [];
        }

        const text = document.getText();
        return context.diagnostics
          .filter((diagnostic) => diagnostic.source === DIAGNOSTIC_SOURCE && diagnostic.range.intersection(range))
          .map((diagnostic) => diagnosticToCodeAction(document, text, diagnostic))
          .filter((action): action is vscode.CodeAction => Boolean(action));
      }
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }
  );
}

function registerDocumentSymbolProvider(): vscode.Disposable {
  return vscode.languages.registerDocumentSymbolProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideDocumentSymbols(document) {
        const model = parseTxtJetTemplate(document.getText());
        return model.blocks.map((block) => blockToSymbol(document, block));
      }
    }
  );
}

function registerDefinitionProvider(): vscode.Disposable {
  return vscode.languages.registerDefinitionProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideDefinition(document, position) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
        if (!config.get<boolean>("navigation.includeDefinitions.enabled", true)) {
          return undefined;
        }

        const offset = document.offsetAt(position);
        const model = parseTxtJetTemplate(document.getText());
        const include = includeDirectiveAtOffset(model.includes, offset);
        const includeFile = include?.attributes.file;
        if (!include || !includeFile) {
          return undefined;
        }

        const resolved = resolveIncludePath(document.fileName, includeFile);
        if (!resolved || !existsSync(resolved)) {
          return undefined;
        }
        return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0));
      }
    }
  );
}

function diagnosticToCodeAction(
  document: vscode.TextDocument,
  text: string,
  diagnostic: vscode.Diagnostic
): vscode.CodeAction | undefined {
  if (typeof diagnostic.code !== "string") {
    return undefined;
  }

  const issue = {
    code: diagnostic.code as TxtJetIssue["code"],
    start: document.offsetAt(diagnostic.range.start),
    end: document.offsetAt(diagnostic.range.end)
  };
  const fix = buildTxtJetCodeActionEdit(text, issue);
  if (!fix) {
    return undefined;
  }

  const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  action.isPreferred = true;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(fix.edit.start), document.positionAt(fix.edit.end)),
    fix.edit.newText
  );
  action.edit = edit;
  return action;
}

function blockToSymbol(document: vscode.TextDocument, block: TxtJetBlock): vscode.DocumentSymbol {
  const range = new vscode.Range(document.positionAt(block.range.start), document.positionAt(block.range.end));
  const selectionRange = new vscode.Range(
    document.positionAt(block.contentRange.start),
    document.positionAt(Math.max(block.contentRange.start, Math.min(block.contentRange.end, block.contentRange.start + 1)))
  );
  const symbol = new vscode.DocumentSymbol(symbolLabel(block), "", symbolKind(block), range, selectionRange);
  if (block.directive) {
    for (const [name, attrRange] of Object.entries(block.directive.attributeRanges)) {
      const childRange = new vscode.Range(document.positionAt(attrRange.start), document.positionAt(attrRange.end));
      symbol.children.push(new vscode.DocumentSymbol(name, block.directive.attributes[name], vscode.SymbolKind.Property, childRange, childRange));
    }
  }
  return symbol;
}

function symbolLabel(block: TxtJetBlock): string {
  if (block.directive) {
    return block.directive.name ? `@${block.directive.name} directive` : "empty directive";
  }
  switch (block.kind) {
    case "outer":
      return "generated output";
    case "scriptlet":
      return "scriptlet block";
    case "expression":
      return "expression block";
    case "declaration":
      return "declaration block";
    case "directive":
    default:
      return "directive block";
  }
}

function symbolKind(block: TxtJetBlock): vscode.SymbolKind {
  switch (block.kind) {
    case "directive":
      return vscode.SymbolKind.Namespace;
    case "declaration":
      return vscode.SymbolKind.Method;
    case "expression":
      return vscode.SymbolKind.Variable;
    case "scriptlet":
      return vscode.SymbolKind.Function;
    case "outer":
    default:
      return vscode.SymbolKind.String;
  }
}

function includeDirectiveAtOffset(includes: TxtJetDirective[], offset: number): TxtJetDirective | undefined {
  return includes.find((include) => {
    const fileRange = include.attributeRanges.file;
    if (fileRange) {
      return fileRange.start <= offset && offset <= fileRange.end;
    }
    return include.nameRange.start <= offset && offset <= include.nameRange.end;
  });
}

function registerCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideCompletionItems(document, position) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
        if (!config.get<boolean>("completions.enabled", true)) {
          return [];
        }

        if (isInsideDirective(document, position)) {
          return directiveCompletions();
        }

        if (isInsideTemplateBlock(document, position)) {
          return [];
        }

        const range = markerCompletionRange(document, position);
        return range ? markerCompletions(range) : [];
      }
    },
    ...COMPLETION_TRIGGER_CHARACTERS
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
    attribute("skeleton"),
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
  if (!shouldOfferMarkerCompletions(linePrefix)) {
    return undefined;
  }
  return new vscode.Range(position.translate(0, -1), position);
}

function languageQuickPickItems(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument
): Array<vscode.QuickPickItem & { languageId: TxtJetTargetLanguage | "auto" }> {
  const detected = detectLanguage(document);
  const storedLanguage = getStoredLanguage(context, document);
  return [
    {
      label: "Auto Detect Generated Output",
      description: detected === "txtjet" ? "No strong target language detected" : labelForLanguage(detected),
      detail: storedLanguage
        ? "Clears the remembered manual mode and applies detection once."
        : "Applies detection once without remembering the result.",
      languageId: "auto"
    },
    ...LANGUAGE_OPTIONS.map((option) => ({
      label: option.label,
      description: option.languageId === storedLanguage
        ? "Remembered for this file"
        : option.languageId === detected
          ? "Detected for this file"
          : option.description,
      detail: option.languageId === "txtjet-java"
        ? "This is for generated Java output. Template Java blocks are highlighted in every mode."
        : undefined,
      picked: option.languageId === document.languageId,
      languageId: option.languageId
    }))
  ];
}

function labelForLanguage(languageId: TxtJetTargetLanguage): string {
  return LANGUAGE_OPTIONS.find((option) => option.languageId === languageId)?.label ?? "Generic TxtJet Template";
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
