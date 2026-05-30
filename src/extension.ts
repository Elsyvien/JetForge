import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute as isAbsolutePath, join, relative } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { buildTxtJetCodeActionEdit } from "./codeActions";
import {
  mapCompilerProblemsToSource,
  parseCompilerProblems,
  TxtJetCompilerDiagnosticSeverity
} from "./compilerDiagnostics";
import { detectTargetLanguage, detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import {
  COMPLETION_TRIGGER_CHARACTERS,
  DIRECTIVE_VALUE_TRIGGER_CHARACTERS,
  directiveValueContextAt,
  isTxtJetPath,
  selectedTargetLanguageId,
  shellSingleQuote,
  shouldOfferMarkerCompletions
} from "./extensionSupport";
import { formatTxtJetBlock } from "./formatter";
import {
  effectiveCompletionTarget,
  isJavaKeywordCompletionName,
  javaCompletionContextAt,
  localJavaDefinitionAndReferenceRangesAt,
  localJavaDefinitionRangesAt,
  localJavaHoverSignaturesAt,
  localJavaSignatureHelpAt,
  mapJavaPreviewRangeToSource,
  projectSourceOffsetToJavaPreview,
  targetFallbackCompletionLabels
} from "./javaIntelliSenseBridge";
import {
  classifyTxtJetRegionAt,
  classifyTxtJetRegions,
  previewKindForTxtJetRegion,
  TxtJetRegionKind
} from "./regionClassifier";
import { scanTxtJetDirectiveIssues, scanTxtJetIssues, TxtJetIssue } from "./scanner";
import {
  buildGeneratedJavaPreview,
  buildGeneratedOutputPreview,
  headerComment,
  mapPreviewRangeToSource,
  mapSourceRangeToPreview,
  parseTxtJetTemplate,
  resolveReferenceCandidates,
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
const GENERATED_DIFF_SCHEME = "txtjet-generated-diff";
const GENERATION_STORAGE_KEY = "txtjet.lastGeneratedOutput.v1";
const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "txtjet.selectTargetLanguage";
  context.subscriptions.push(statusBar);
  const diagnostics = vscode.languages.createDiagnosticCollection("txtjet");
  context.subscriptions.push(diagnostics);
  const compilerDiagnosticsBySource = new Map<string, vscode.Diagnostic[]>();
  const previewProvider = new TxtJetPreviewProvider();
  const generatedDiffProvider = new TxtJetGeneratedDiffProvider(context);
  const visualDifferentiator = new TxtJetVisualDifferentiator();
  context.subscriptions.push(
    visualDifferentiator,
    vscode.workspace.registerTextDocumentContentProvider(OUTPUT_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(JAVA_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(GENERATED_DIFF_SCHEME, generatedDiffProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.detectTargetLanguage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetDocument(editor.document)) {
        return;
      }

      await clearStoredLanguage(context, editor.document);
      await applyDetectedLanguage(context, editor.document, true, statusBar, visualDifferentiator);
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
          await applyDetectedLanguage(context, editor.document, true, statusBar, visualDifferentiator);
        } else {
          await setLanguage(context, editor.document, picked.languageId, statusBar, true, visualDifferentiator);
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

        await setLanguage(context, editor.document, option.languageId, statusBar, true, visualDifferentiator);
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
      await setLanguage(context, editor.document, "txtjet", statusBar, false, visualDifferentiator);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.clearLanguage.all", async () => {
      await context.workspaceState.update(MODE_STORAGE_KEY, {});
      updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context);
      visualDifferentiator.refreshAll();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.toggleVisualDifferentiation", async () => {
      const resource = vscode.window.activeTextEditor?.document.uri;
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
      const nextEnabled = !config.get<boolean>("visualDifferentiation.enabled", true);
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await config.update("visualDifferentiation.enabled", nextEnabled, target);
      visualDifferentiator.refreshAll();
      vscode.window.setStatusBarMessage(`TxtJet region background coloring ${nextEnabled ? "enabled" : "disabled"}.`, 4000);
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
    vscode.commands.registerCommand("txtjet.openRegionInGeneratedPreview", async () => {
      await openRegionPreview("output");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openRegionInJavaPreview", async () => {
      await openRegionPreview("java");
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
    vscode.commands.registerCommand("txtjet.generateOutput", async () => {
      await generateOutput(context, generatedDiffProvider, false);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.diffLastGeneratedOutput", async () => {
      await generateOutput(context, generatedDiffProvider, true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.compileTemplate", async () => {
      await compileTemplateWithExternalTool();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.validateWithCompiler", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetFile(editor.document)) {
        return;
      }
      await validateTemplateWithCompiler(editor.document, diagnostics, compilerDiagnosticsBySource, true);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyDetectedLanguage(context, document, false, statusBar, visualDifferentiator);
      updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource);
      visualDifferentiator.refreshDocument(document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      updateDiagnostics(diagnostics, event.document, compilerDiagnosticsBySource);
      previewProvider.refresh(event.document.uri);
      visualDifferentiator.refreshDocument(event.document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
      if (
        isTxtJetFile(document)
        && config.get<boolean>("diagnostics.compiler.enabled", true)
        && config.get<boolean>("diagnostics.compiler.runOnSave", false)
      ) {
        void validateTemplateWithCompiler(document, diagnostics, compilerDiagnosticsBySource, false);
      }
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
          updateDiagnostics(diagnostics, sourceDocument, compilerDiagnosticsBySource);
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
        updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource);
      }
      visualDifferentiator.refreshAll();
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      compilerDiagnosticsBySource.delete(document.uri.toString());
      diagnostics.delete(document.uri);
      previewProvider.forget(document.uri);
      visualDifferentiator.clearDocument(document);
    })
  );

  context.subscriptions.push(registerCompletionProvider());
  context.subscriptions.push(registerCodeActionProvider());
  context.subscriptions.push(registerDocumentSymbolProvider());
  context.subscriptions.push(registerDefinitionProvider());
  context.subscriptions.push(registerHoverProvider());
  context.subscriptions.push(registerReferenceProvider());
  context.subscriptions.push(registerRenameProvider());
  context.subscriptions.push(registerSignatureHelpProvider());
  context.subscriptions.push(registerFormattingProvider());

  for (const document of vscode.workspace.textDocuments) {
    void applyDetectedLanguage(context, document, false, statusBar, visualDifferentiator);
    updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource);
    visualDifferentiator.refreshDocument(document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateStatusBar(statusBar, editor?.document, context);
      visualDifferentiator.refreshEditor(editor);
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        visualDifferentiator.refreshEditor(editor);
      }
    })
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
type CompletionInsertReplaceRange = { inserting: vscode.Range; replacing: vscode.Range };
const JAVA_COMPLETION_TRIGGER_CHARACTERS = [
  ".",
  ":",
  ">",
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_".split("")
] as const;

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
      return buildGeneratedJavaPreview(document.getText(), document.fileName, javaPreviewOptions(document)).text;
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

class TxtJetGeneratedDiffProvider implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const source = queryValue(uri, "source");
    return source ? this.context.workspaceState.get<Record<string, string>>(GENERATION_STORAGE_KEY, {})[source] ?? "" : "";
  }

  refresh(uri: vscode.Uri): void {
    this.changed.fire(uri);
  }
}

class TxtJetVisualDifferentiator implements vscode.Disposable {
  private readonly markerDecoration = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editorBracketMatch.border"),
    backgroundColor: new vscode.ThemeColor("editorBracketMatch.background"),
    fontWeight: "600"
  });
  private readonly directiveDecoration = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    backgroundColor: "rgba(197, 134, 192, 0.12)",
    border: "1px solid rgba(197, 134, 192, 0.20)"
  });
  private readonly templateJavaDecoration = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    backgroundColor: "rgba(86, 156, 214, 0.10)",
    border: "1px solid rgba(86, 156, 214, 0.18)"
  });
  private readonly outputDecorations: Record<TxtJetTargetLanguage, vscode.TextEditorDecorationType> = {
    "txtjet": outputDecoration("rgba(128, 128, 128, 0.06)", "rgba(128, 128, 128, 0.20)"),
    "txtjet-java": outputDecoration("rgba(78, 201, 176, 0.08)", "rgba(78, 201, 176, 0.22)"),
    "txtjet-html": outputDecoration("rgba(224, 108, 117, 0.08)", "rgba(224, 108, 117, 0.22)"),
    "txtjet-xml": outputDecoration("rgba(229, 192, 123, 0.10)", "rgba(229, 192, 123, 0.24)"),
    "txtjet-c": outputDecoration("rgba(97, 175, 239, 0.08)", "rgba(97, 175, 239, 0.22)"),
    "txtjet-python": outputDecoration("rgba(152, 195, 121, 0.10)", "rgba(152, 195, 121, 0.24)")
  };

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.refreshEditor(editor);
    }
  }

  refreshDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === document.uri.toString()) {
        this.refreshEditor(editor);
      }
    }
  }

  refreshEditor(editor?: vscode.TextEditor): void {
    if (!editor) {
      return;
    }

    const document = editor.document;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
    if (!isTxtJetDocument(document) || !config.get<boolean>("visualDifferentiation.enabled", true)) {
      this.clearEditor(editor);
      return;
    }

    const target = selectedTargetLanguage(document);
    const grouped = emptyDecorationGroups();
    for (const region of classifyTxtJetRegions(document.getText(), target)) {
      const range = vscodeRangeFor(document, region.range);
      if (region.kind === "generated-output") {
        grouped.output[region.targetLanguage].push(range);
      } else {
        grouped.template[region.kind].push(range);
      }
    }

    editor.setDecorations(this.markerDecoration, grouped.template.marker);
    editor.setDecorations(this.directiveDecoration, grouped.template.directive);
    editor.setDecorations(this.templateJavaDecoration, grouped.template["template-java"]);
    for (const language of TXTJET_LANGUAGES) {
      editor.setDecorations(this.outputDecorations[language], grouped.output[language]);
    }
  }

  clearDocument(document: vscode.TextDocument): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === document.uri.toString()) {
        this.clearEditor(editor);
      }
    }
  }

  dispose(): void {
    for (const decoration of this.allDecorations()) {
      decoration.dispose();
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const decoration of this.allDecorations()) {
      editor.setDecorations(decoration, []);
    }
  }

  private allDecorations(): vscode.TextEditorDecorationType[] {
    return [
      this.markerDecoration,
      this.directiveDecoration,
      this.templateJavaDecoration,
      ...Array.from(TXTJET_LANGUAGES).map((language) => this.outputDecorations[language])
    ];
  }
}

function outputDecoration(backgroundColor: string, overviewRulerColor: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    backgroundColor,
    overviewRulerColor,
    overviewRulerLane: vscode.OverviewRulerLane.Right
  });
}

function emptyDecorationGroups(): {
  template: Record<TxtJetRegionKind, vscode.Range[]>;
  output: Record<TxtJetTargetLanguage, vscode.Range[]>;
} {
  return {
    template: {
      "directive": [],
      "template-java": [],
      "generated-output": [],
      "marker": []
    },
    output: {
      "txtjet": [],
      "txtjet-java": [],
      "txtjet-html": [],
      "txtjet-xml": [],
      "txtjet-c": [],
      "txtjet-python": []
    }
  };
}

async function openPreview(kind: PreviewKind, forceBeside: boolean): Promise<void> {
  const sourceEditor = vscode.window.activeTextEditor;
  if (!sourceEditor || !isTxtJetFile(sourceEditor.document)) {
    return;
  }

  await openMappedPreview(sourceEditor, kind, selectionToRange(sourceEditor.document, sourceEditor.selection), forceBeside);
}

async function openRegionPreview(kind: PreviewKind): Promise<void> {
  const sourceEditor = vscode.window.activeTextEditor;
  if (!sourceEditor || !isTxtJetFile(sourceEditor.document)) {
    return;
  }

  const document = sourceEditor.document;
  const offset = document.offsetAt(sourceEditor.selection.active);
  const region = classifyTxtJetRegionAt(document.getText(), offset, selectedTargetLanguage(document));
  if (!region || previewKindForTxtJetRegion(region) !== kind) {
    vscode.window.showInformationMessage(regionPreviewMessage(kind));
    return;
  }

  await openMappedPreview(sourceEditor, kind, region.range, false);
}

async function openMappedPreview(
  sourceEditor: vscode.TextEditor,
  kind: PreviewKind,
  sourceRange: TxtJetRange,
  forceBeside: boolean
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, sourceEditor.document.uri);
  if (!config.get<boolean>("previews.enabled", true)) {
    return;
  }
  if (kind === "java" && !config.get<boolean>("previews.generatedJava.enabled", true)) {
    return;
  }

  const selectedLanguage = selectedTargetLanguage(sourceEditor.document);
  const preview = buildPreviewForDocument(sourceEditor.document, kind);
  const mappedPreviewRange = mapSourceRangeToPreview(preview.mappings, sourceRange);
  const previewUri = buildPreviewUri(sourceEditor.document, kind);
  const previewDocument = await vscode.workspace.openTextDocument(previewUri);
  const targetLanguage = kind === "java" ? "java" : targetPreviewLanguage(selectedLanguage);
  const updatedDocument = await vscode.languages.setTextDocumentLanguage(previewDocument, targetLanguage);
  const viewColumn = forceBeside || config.get<boolean>("previews.openBeside", true)
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.Active;
  const previewEditor = await vscode.window.showTextDocument(updatedDocument, { preview: true, viewColumn });
  revealMappedPreviewRange(previewEditor, mappedPreviewRange);
}

function regionPreviewMessage(kind: PreviewKind): string {
  return kind === "java"
    ? "Place the cursor inside a TxtJet scriptlet, expression, declaration, or its marker to open that region in the generated Java preview."
    : "Place the cursor inside generated-output text to open that region in the generated output preview.";
}

function buildPreviewUri(document: vscode.TextDocument, kind: PreviewKind): vscode.Uri {
  const scheme = kind === "java" ? JAVA_PREVIEW_SCHEME : OUTPUT_PREVIEW_SCHEME;
  const targetLanguage = selectedTargetLanguage(document);
  const suffix = kind === "java" ? ".java" : `.preview.${targetPreviewLanguage(targetLanguage)}`;
  return vscode.Uri.from({
    scheme,
    path: `${document.uri.path}${suffix}`,
    query: kind === "java"
      ? `source=${encodeURIComponent(document.uri.toString())}`
      : `source=${encodeURIComponent(document.uri.toString())}&target=${encodeURIComponent(targetLanguage)}`
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

function buildPreviewForDocument(document: vscode.TextDocument, kind: PreviewKind): TxtJetGeneratedPreview {
  const targetLanguage = selectedTargetLanguage(document);
  return kind === "java"
    ? buildGeneratedJavaPreview(document.getText(), document.fileName, javaPreviewOptions(document))
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
    includePaths: configuredReferencePaths(document, "resolution.includePaths"),
    readInclude(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    }
  };
}

function javaPreviewOptions(document: vscode.TextDocument) {
  return {
    sourceFileName: document.fileName,
    skeletonPaths: configuredReferencePaths(document, "resolution.skeletonPaths"),
    readSkeleton(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    }
  };
}

function configuredReferencePaths(document: vscode.TextDocument, setting: string): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  const paths = config.get<string[]>(setting, []);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  return paths
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => entry.replace("${workspaceFolder}", workspaceFolder?.uri.fsPath ?? dirname(document.fileName)))
    .map((entry) => isAbsolutePath(entry) ? entry : join(workspaceFolder?.uri.fsPath ?? dirname(document.fileName), entry));
}

function selectionToRange(document: vscode.TextDocument, selection: vscode.Selection): TxtJetRange {
  return {
    start: document.offsetAt(selection.start),
    end: document.offsetAt(selection.end)
  };
}

function vscodeRangeFor(document: vscode.TextDocument, range: TxtJetRange): vscode.Range {
  return new vscode.Range(
    document.positionAt(range.start),
    document.positionAt(Math.max(range.start, range.end))
  );
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

async function generateOutput(
  context: vscode.ExtensionContext,
  diffProvider: TxtJetGeneratedDiffProvider,
  showDiffOnly: boolean
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document)) {
    return;
  }

  const generated = buildGeneratedOutputPreview(
    editor.document.getText(),
    selectedTargetLanguage(editor.document),
    outputPreviewOptions(editor.document)
  ).text;
  const outputUri = generationOutputUri(editor.document);
  const previousUri = generationPreviousUri(editor.document);
  const previous = context.workspaceState.get<Record<string, string>>(GENERATION_STORAGE_KEY, {})[editor.document.uri.toString()];
  if (!showDiffOnly) {
    mkdirSync(dirname(outputUri.fsPath), { recursive: true });
    writeFileSync(outputUri.fsPath, generated, "utf8");
    await rememberGeneratedOutput(context, editor.document, generated);
    diffProvider.refresh(previousUri);
    await vscode.window.showTextDocument(outputUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    vscode.window.setStatusBarMessage(`TxtJet generated ${relative(vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath ?? dirname(outputUri.fsPath), outputUri.fsPath)}`, 5000);
    return;
  }

  if (previous === undefined) {
    vscode.window.showInformationMessage("TxtJet has no previous generated output snapshot for this template yet.");
    return;
  }
  const currentDocument = await vscode.workspace.openTextDocument({ content: generated, language: targetPreviewLanguage(selectedTargetLanguage(editor.document)) });
  await vscode.commands.executeCommand(
    "vscode.diff",
    previousUri,
    currentDocument.uri,
    `TxtJet generated diff: ${basename(editor.document.fileName)}`
  );
}

async function compileTemplateWithExternalTool(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document)) {
    return;
  }
  if (editor.document.isDirty) {
    const choice = await vscode.window.showWarningMessage(
      "Save the current template before compiling it.",
      "Save and Compile",
      "Cancel"
    );
    if (choice !== "Save and Compile") {
      return;
    }
    await editor.document.save();
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, editor.document.uri);
  const compileCommand = config.get<string>("compiler.command", "").trim();
  if (compileCommand.length === 0) {
    vscode.window.showErrorMessage("TxtJet compile command is not configured. Set txtjet.compiler.command in settings.");
    return;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath ?? dirname(editor.document.fileName);
  const outputPath = generationOutputUri(editor.document).fsPath;
  mkdirSync(dirname(outputPath), { recursive: true });
  const fullCommand = compileCommand
    .split("${file}").join(shellEscape(editor.document.fileName))
    .split("${workspaceFolder}").join(shellEscape(workspaceFolder))
    .split("${outputFile}").join(shellEscape(outputPath));

  try {
    const { stdout, stderr } = await execAsync(fullCommand, { cwd: workspaceFolder, maxBuffer: 10 * 1024 * 1024 });
    if (stdout.trim().length > 0 || stderr.trim().length > 0) {
      void vscode.window.showInformationMessage("TxtJet compile finished. Open the TxtJet output channel for logs.");
    }
    if (stdout.trim().length > 0) {
      appendOutputLog("stdout", stdout);
    }
    if (stderr.trim().length > 0) {
      appendOutputLog("stderr", stderr);
    }
    if (existsSync(outputPath)) {
      await vscode.window.showTextDocument(vscode.Uri.file(outputPath), { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } else {
      vscode.window.showWarningMessage("Compile command finished, but no output file was found at txtjet.generation.outputDirectory.");
    }
  } catch (error) {
    appendOutputLog("error", String(error));
    vscode.window.showErrorMessage("TxtJet compile failed. Open the TxtJet output channel for details.");
  }
}

async function validateTemplateWithCompiler(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  compilerDiagnosticsBySource: Map<string, vscode.Diagnostic[]>,
  interactive: boolean
): Promise<void> {
  if (!isTxtJetFile(document)) {
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.enabled", true) || !config.get<boolean>("diagnostics.compiler.enabled", true)) {
    compilerDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource);
    return;
  }

  if (document.isDirty) {
    if (!interactive) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "Save the current template before validating it with the external compiler.",
      "Save and Validate",
      "Cancel"
    );
    if (choice !== "Save and Validate") {
      return;
    }
    await document.save();
  }

  const compileCommand = config.get<string>("compiler.command", "").trim();
  if (compileCommand.length === 0) {
    compilerDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource);
    if (interactive) {
      vscode.window.showErrorMessage("TxtJet compile command is not configured. Set txtjet.compiler.command in settings.");
    }
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? dirname(document.fileName);
  const outputPath = generationOutputUri(document).fsPath;
  mkdirSync(dirname(outputPath), { recursive: true });
  const fullCommand = compilerCommandFor(compileCommand, document.fileName, workspaceFolder, outputPath);

  const result = await runCompilerCommand(fullCommand, workspaceFolder);
  if (result.stdout.trim().length > 0) {
    appendOutputLog("stdout", result.stdout);
  }
  if (result.stderr.trim().length > 0) {
    appendOutputLog("stderr", result.stderr);
  }
  if (result.error.trim().length > 0) {
    appendOutputLog("error", result.error);
  }

  const matcher = config.get<string>("diagnostics.compiler.problemMatcher", "");
  const problems = parseCompilerProblems([result.stdout, result.stderr].filter(Boolean).join("\n"), matcher);
  const preview = buildGeneratedJavaPreview(document.getText(), document.fileName, javaPreviewOptions(document));
  const mappedProblems = mapCompilerProblemsToSource(
    problems,
    document.fileName,
    document.getText(),
    preview,
    outputPath,
    workspaceFolder
  );
  const mappedDiagnostics = mappedProblems.map((problem) => compilerProblemToDiagnostic(document, problem.message, problem.severity, problem.sourceRange));

  if (mappedDiagnostics.length > 0) {
    compilerDiagnosticsBySource.set(document.uri.toString(), mappedDiagnostics);
  } else {
    compilerDiagnosticsBySource.delete(document.uri.toString());
  }
  updateDiagnostics(collection, document, compilerDiagnosticsBySource);

  if (!interactive) {
    return;
  }
  if (mappedDiagnostics.length > 0) {
    vscode.window.showWarningMessage(`TxtJet compiler validation found ${mappedDiagnostics.length} mapped diagnostic${mappedDiagnostics.length === 1 ? "" : "s"}.`);
  } else if (problems.length > 0) {
    vscode.window.showWarningMessage("TxtJet compiler validation finished, but no compiler diagnostics could be mapped to this template.");
  } else if (result.failed) {
    vscode.window.showErrorMessage("TxtJet compiler validation failed. Open the TxtJet output channel for details.");
  } else {
    vscode.window.showInformationMessage("TxtJet compiler validation finished without mapped diagnostics.");
  }
}

async function runCompilerCommand(
  command: string,
  cwd: string
): Promise<{ stdout: string; stderr: string; error: string; failed: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr, error: "", failed: false };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
      error: failed.message ?? String(error),
      failed: true
    };
  }
}

function compilerCommandFor(command: string, fileName: string, workspaceFolder: string, outputPath: string): string {
  return command
    .split("${file}").join(shellEscape(fileName))
    .split("${workspaceFolder}").join(shellEscape(workspaceFolder))
    .split("${outputFile}").join(shellEscape(outputPath));
}

function compilerProblemToDiagnostic(
  document: vscode.TextDocument,
  message: string,
  severity: TxtJetCompilerDiagnosticSeverity,
  sourceRange: TxtJetRange
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    vscodeRangeFor(document, sourceRange),
    `Compiler: ${message}`,
    compilerDiagnosticSeverity(severity)
  );
  diagnostic.source = `${DIAGNOSTIC_SOURCE}.compiler`;
  diagnostic.code = "compiler";
  return diagnostic;
}

function compilerDiagnosticSeverity(severity: TxtJetCompilerDiagnosticSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
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

const outputChannel = vscode.window.createOutputChannel("TxtJet");

function appendOutputLog(stream: "stdout" | "stderr" | "error", content: string): void {
  outputChannel.appendLine(`[${new Date().toISOString()}] ${stream}`);
  outputChannel.appendLine(content.trimEnd());
}

function shellEscape(value: string): string {
  return shellSingleQuote(value);
}

function generationOutputUri(document: vscode.TextDocument): vscode.Uri {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const configuredRoot = config.get<string>("generation.outputDirectory", "${workspaceFolder}/generated")
    .replace("${workspaceFolder}", workspaceFolder?.uri.fsPath ?? dirname(document.fileName));
  const root = isAbsolutePath(configuredRoot)
    ? configuredRoot
    : join(workspaceFolder?.uri.fsPath ?? dirname(document.fileName), configuredRoot);
  const target = targetPreviewLanguage(selectedTargetLanguage(document));
  const extension = target === "plaintext" ? "txt" : target;
  return vscode.Uri.file(join(root, `${basename(document.fileName)}.${extension}`));
}

function generationPreviousUri(document: vscode.TextDocument): vscode.Uri {
  return vscode.Uri.from({
    scheme: GENERATED_DIFF_SCHEME,
    path: `${document.uri.path}.previous`,
    query: `source=${encodeURIComponent(document.uri.toString())}`
  });
}

async function rememberGeneratedOutput(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  generated: string
): Promise<void> {
  const snapshots = context.workspaceState.get<Record<string, string>>(GENERATION_STORAGE_KEY, {});
  await context.workspaceState.update(GENERATION_STORAGE_KEY, {
    ...snapshots,
    [document.uri.toString()]: generated
  });
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
  const updatedDocument = await vscode.languages.setTextDocumentLanguage(previewDocument, targetPreviewLanguage(selectedTargetLanguage(editor.document)));
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
  statusBar: vscode.StatusBarItem,
  visualDifferentiator?: TxtJetVisualDifferentiator
): Promise<void> {
  if (!isTxtJetDocument(document)) {
    return;
  }

  const storedLanguage = getStoredLanguage(context, document);
  if (storedLanguage && !allowManualModes) {
    await setLanguage(context, document, storedLanguage, statusBar, false, visualDifferentiator);
    return;
  }

  if (!allowManualModes && document.languageId !== "txtjet") {
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!allowManualModes && !config.get<boolean>("autoDetect.enabled", true)) {
    const preferred = config.get<TxtJetTargetLanguage>("defaultTargetLanguage", "txtjet");
    if (preferred !== "txtjet") {
      await setLanguage(context, document, preferred, statusBar, false, visualDifferentiator);
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

  await setLanguage(context, document, target, statusBar, false, visualDifferentiator);
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
  persist: boolean,
  visualDifferentiator?: TxtJetVisualDifferentiator
): Promise<void> {
  if (persist) {
    await storeLanguage(context, document, languageId);
  }

  if (document.languageId === languageId) {
    updateStatusBar(statusBar, document, context);
    visualDifferentiator?.refreshDocument(document);
    return;
  }

  const updatedDocument = await vscode.languages.setTextDocumentLanguage(document, languageId);
  updateStatusBar(statusBar, updatedDocument, context);
  visualDifferentiator?.refreshDocument(updatedDocument);
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

function updateDiagnostics(
  collection: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
  compilerDiagnosticsBySource?: Map<string, vscode.Diagnostic[]>
): void {
  if (!isTxtJetFile(document)) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
    collection.delete(document.uri);
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.enabled", true)) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
    collection.delete(document.uri);
    return;
  }

  const maxFileSizeKb = config.get<number>("diagnostics.maxFileSizeKb", DEFAULT_MAX_DIAGNOSTIC_FILE_SIZE_KB);
  if (maxFileSizeKb > 0 && Buffer.byteLength(document.getText(), "utf8") > maxFileSizeKb * 1024) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
    collection.delete(document.uri);
    return;
  }

  const severity = diagnosticSeverityFromSetting(config.get<string>("diagnostics.severity", "warning"));
  const text = document.getText();
  const diagnostics = [
    ...scanTxtJetIssues(text),
    ...scanTxtJetDirectiveIssues(text, {
      includeExists: (includeFile) => fileReferenceExists(document, includeFile, "resolution.includePaths"),
      skeletonExists: (skeletonFile) => fileReferenceExists(document, skeletonFile, "resolution.skeletonPaths")
    })
  ].map((issue) => issueToDiagnostic(document, issue, severity));
  const compilerDiagnostics = config.get<boolean>("diagnostics.compiler.enabled", true)
    ? compilerDiagnosticsBySource?.get(document.uri.toString()) ?? []
    : [];
  if (!config.get<boolean>("diagnostics.compiler.enabled", true)) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
  }
  collection.set(document.uri, diagnostics.concat(compilerDiagnostics, mappedGeneratedJavaDiagnostics(document)));
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

  const preview = buildGeneratedJavaPreview(document.getText(), document.fileName, javaPreviewOptions(document));
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
      async provideDefinition(document, position) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
        if (!config.get<boolean>("navigation.includeDefinitions.enabled", true)) {
          return javaDefinitions(document, position);
        }

        const offset = document.offsetAt(position);
        const model = parseTxtJetTemplate(document.getText());
        const reference = referenceDirectiveAtOffset(model, offset);
        if (!reference) {
          return javaDefinitions(document, position);
        }

        const resolved = resolveExistingReferencePath(document, reference.file, reference.kind === "include" ? "resolution.includePaths" : "resolution.skeletonPaths");
        if (!resolved || !existsSync(resolved)) {
          return undefined;
        }
        return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0));
      }
    }
  );
}

async function javaDefinitions(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
  if (!javaBridgeEnabled(document)) {
    return undefined;
  }
  return await javaBridgeDefinitions(document, position) ?? localJavaDefinition(document, position);
}

function localJavaDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
  const ranges = localJavaDefinitionRangesAt(document.getText(), document.offsetAt(position));
  const locations = ranges.map((range) => new vscode.Location(document.uri, vscodeRangeFor(document, range)));
  return locations.length > 0 ? locations : undefined;
}

function registerHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      async provideHover(document, position) {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const model = parseTxtJetTemplate(text);
        const reference = referenceDirectiveAtOffset(model, offset);
        if (!reference) {
          const javaHover = javaBridgeEnabled(document)
            ? await javaBridgeHover(document, position) ?? localJavaHover(document, position)
            : undefined;
          return javaHover ?? regionHover(document, text, offset);
        }

        const resolved = resolveExistingReferencePath(document, reference.file, reference.kind === "include" ? "resolution.includePaths" : "resolution.skeletonPaths")
          ?? resolveIncludePath(document.fileName, reference.file);
        const status = resolved && existsSync(resolved) ? "resolved" : "unresolved";
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**TxtJet ${reference.kind} reference**\n\n`);
        markdown.appendCodeblock(reference.file, "text");
        markdown.appendMarkdown(`\nStatus: ${status}`);
        if (resolved) {
          markdown.appendMarkdown(`\n\nResolved path:\n`);
          markdown.appendCodeblock(resolved, "text");
        }
        return new vscode.Hover(markdown, reference.range ? new vscode.Range(document.positionAt(reference.range.start), document.positionAt(reference.range.end)) : undefined);
      }
    }
  );
}

function localJavaHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const signatures = localJavaHoverSignaturesAt(document.getText(), document.offsetAt(position));
  if (signatures.length === 0) {
    return undefined;
  }

  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(signatures.length === 1 ? "**TxtJet local helper**\n\n" : "**TxtJet local helper overloads**\n\n");
  for (const signature of signatures) {
    markdown.appendCodeblock(signature, "java");
  }
  return new vscode.Hover(markdown, document.getWordRangeAtPosition(position));
}

function registerReferenceProvider(): vscode.Disposable {
  return vscode.languages.registerReferenceProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideReferences(document, position) {
        if (!javaBridgeEnabled(document)) {
          return [];
        }
        const ranges = localJavaDefinitionAndReferenceRangesAt(document.getText(), document.offsetAt(position));
        return ranges.map((range) => new vscode.Location(document.uri, vscodeRangeFor(document, range)));
      }
    }
  );
}

function registerRenameProvider(): vscode.Disposable {
  return vscode.languages.registerRenameProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      prepareRename(document, position) {
        if (!javaBridgeEnabled(document)) {
          return undefined;
        }
        const ranges = localJavaDefinitionAndReferenceRangesAt(document.getText(), document.offsetAt(position));
        if (ranges.length === 0) {
          throw new Error("TxtJet rename is available for local declaration helper methods and their call sites.");
        }
        const target = ranges.find((range) => vscodeRangeFor(document, range).contains(position)) ?? ranges[0];
        return vscodeRangeFor(document, target);
      },
      provideRenameEdits(document, position, newName) {
        if (!javaBridgeEnabled(document)) {
          return undefined;
        }
        if (!/^[A-Za-z_$][\w$]*$/.test(newName)) {
          throw new Error("TxtJet helper method names must be valid Java identifiers.");
        }
        const ranges = localJavaDefinitionAndReferenceRangesAt(document.getText(), document.offsetAt(position));
        const edit = new vscode.WorkspaceEdit();
        for (const range of ranges) {
          edit.replace(document.uri, vscodeRangeFor(document, range), newName);
        }
        return edit;
      }
    }
  );
}

function registerSignatureHelpProvider(): vscode.Disposable {
  return vscode.languages.registerSignatureHelpProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      provideSignatureHelp(document, position) {
        if (!javaBridgeEnabled(document)) {
          return undefined;
        }
        const signatureHelp = localJavaSignatureHelpAt(document.getText(), document.offsetAt(position));
        if (!signatureHelp) {
          return undefined;
        }
        const help = new vscode.SignatureHelp();
        help.activeParameter = signatureHelp.activeParameter;
        help.activeSignature = 0;
        help.signatures = signatureHelp.signatures.map((signature) => {
          const info = new vscode.SignatureInformation(signature);
          const params = signature.match(/\((.*)\)/)?.[1].split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
          info.parameters = params.map((param) => new vscode.ParameterInformation(param));
          return info;
        });
        return help;
      }
    },
    "(",
    ","
  );
}

function regionHover(document: vscode.TextDocument, text: string, offset: number): vscode.Hover | undefined {
  const region = classifyTxtJetRegionAt(text, offset, selectedTargetLanguage(document));
  if (!region) {
    return undefined;
  }

  const markdown = new vscode.MarkdownString();
  const language = labelForLanguage(region.targetLanguage);
  switch (region.kind) {
    case "marker":
      markdown.appendMarkdown("**TxtJet template marker**\n\nDelimits a TxtJet directive, expression, declaration, or scriptlet block.");
      break;
    case "directive":
      markdown.appendMarkdown("**TxtJet directive region**\n\nTemplate metadata or include/skeleton routing. This is parsed as TxtJet syntax, not generated output.");
      break;
    case "template-java":
      markdown.appendMarkdown("**TxtJet template Java region**\n\nJava executed by the template while generating output. IntelliSense is routed through the generated Java preview when installed Java tooling can answer it.");
      break;
    case "generated-output":
      markdown.appendMarkdown(`**${language} region**\n\nGenerated-output text for the selected or detected TxtJet target mode.`);
      break;
  }

  return new vscode.Hover(markdown, vscodeRangeFor(document, region.range));
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
  const createFileAction = missingReferenceCodeAction(document, text, issue);
  if (createFileAction) {
    createFileAction.diagnostics = [diagnostic];
    createFileAction.isPreferred = true;
    return createFileAction;
  }

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

function missingReferenceCodeAction(
  document: vscode.TextDocument,
  text: string,
  issue: { code: TxtJetIssue["code"]; start: number; end: number }
): vscode.CodeAction | undefined {
  if (issue.code !== "unresolved-include-file" && issue.code !== "unresolved-skeleton-file") {
    return undefined;
  }

  const referenceFile = quotedAttributeValue(text.slice(issue.start, issue.end));
  if (!referenceFile) {
    return undefined;
  }

  const kind = issue.code === "unresolved-skeleton-file" ? "skeleton" : "include";
  const resolved = resolveReferenceCandidates(document.fileName, referenceFile, {
    searchPaths: configuredReferencePaths(document, kind === "include" ? "resolution.includePaths" : "resolution.skeletonPaths")
  })[0];
  if (!resolved) {
    return undefined;
  }

  const action = new vscode.CodeAction(`Create missing TxtJet ${kind} file`, vscode.CodeActionKind.QuickFix);
  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(resolved);
  edit.createFile(uri, { ignoreIfExists: true });
  edit.insert(uri, new vscode.Position(0, 0), defaultReferenceFileText(kind));
  action.edit = edit;
  return action;
}

function quotedAttributeValue(text: string): string | undefined {
  const match = text.match(/=\s*(?:"([^"]*)"|'([^']*)')/);
  return match?.[1] ?? match?.[2];
}

function defaultReferenceFileText(kind: "include" | "skeleton"): string {
  return kind === "skeleton"
    ? "${packageDeclaration}\n\n${imports}\n\npublic class ${class} {\n${members}\n${generateMethod}\n}\n"
    : "";
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

function referenceDirectiveAtOffset(
  model: ReturnType<typeof parseTxtJetTemplate>,
  offset: number
): { kind: "include" | "skeleton"; file: string; range?: TxtJetRange } | undefined {
  const include = includeDirectiveAtOffset(model.includes, offset);
  if (include?.attributes.file) {
    return { kind: "include", file: include.attributes.file, range: include.attributeRanges.file };
  }

  const jet = model.jetDirective;
  const skeletonRange = jet?.attributeRanges.skeleton;
  const skeletonFile = jet?.attributes.skeleton;
  if (jet && skeletonRange && skeletonFile && skeletonRange.start <= offset && offset <= skeletonRange.end) {
    return { kind: "skeleton", file: skeletonFile, range: skeletonRange };
  }

  return undefined;
}

function fileReferenceExists(document: vscode.TextDocument, referenceFile: string, setting: string): boolean {
  return Boolean(resolveExistingReferencePath(document, referenceFile, setting));
}

function resolveExistingReferencePath(document: vscode.TextDocument, referenceFile: string, setting: string): string | undefined {
  return resolveReferenceCandidates(document.fileName, referenceFile, {
    searchPaths: configuredReferencePaths(document, setting)
  }).find((candidate) => existsSync(candidate));
}

function registerCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      async provideCompletionItems(document, position, _token, context) {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
        if (!config.get<boolean>("completions.enabled", true)) {
          return [];
        }

        if (isInsideDirective(document, position)) {
          const valueCompletions = directiveValueCompletions(document, position);
          if (valueCompletions) {
            return valueCompletions;
          }
          return directiveCompletions();
        }

        const javaContext = javaCompletionContextAt(
          document.getText(),
          document.offsetAt(position),
          completionTarget(document)
        );
        if (javaContext?.kind === "template-java") {
          return javaBridgeCompletions(document, position, context.triggerCharacter);
        }
        if (javaContext?.kind === "generated-java" || javaContext?.kind === "generated-python" || javaContext?.kind === "generated-c") {
          return fallbackTargetCompletions(document, position);
        }

        const range = markerCompletionRange(document, position);
        return range ? markerCompletions(range) : [];
      }
    },
    ...COMPLETION_TRIGGER_CHARACTERS,
    ...DIRECTIVE_VALUE_TRIGGER_CHARACTERS,
    ...JAVA_COMPLETION_TRIGGER_CHARACTERS
  );
}

async function javaBridgeCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  triggerCharacter: string | undefined
): Promise<vscode.CompletionList | vscode.CompletionItem[]> {
  if (!javaBridgeEnabled(document)) {
    return [];
  }

  const projection = await openJavaBridgeProjection(document, position);
  if (!projection) {
    return fallbackTargetCompletions(document, position);
  }

  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    projection.previewDocument.uri,
    projection.previewPosition,
    triggerCharacter
  );
  if (!completions) {
    return fallbackTargetCompletions(document, position);
  }

  const items = completions.items
    .map((item) => remapJavaCompletionItem(document, projection.previewDocument, position, item))
    .filter((item): item is vscode.CompletionItem => Boolean(item));
  if (items.length === 0) {
    return fallbackTargetCompletions(document, position);
  }
  return new vscode.CompletionList(items, completions.isIncomplete);
}

async function javaBridgeHover(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Hover | undefined> {
  if (!javaBridgeEnabled(document)) {
    return undefined;
  }

  const projection = await openJavaBridgeProjection(document, position);
  if (!projection) {
    return undefined;
  }

  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    projection.previewDocument.uri,
    projection.previewPosition
  );
  if (!hovers || hovers.length === 0) {
    return undefined;
  }

  const contents = hovers.flatMap((hover) => hover.contents);
  const hoverRange = hovers.map((hover) => hover.range).find((range): range is vscode.Range => Boolean(range));
  const mappedRange = hoverRange
    ? mapPreviewRangeToSourceVscodeRange(document, projection.previewDocument, hoverRange)
    : undefined;
  return new vscode.Hover(contents, mappedRange);
}

async function javaBridgeDefinitions(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Definition | undefined> {
  if (!javaBridgeEnabled(document)) {
    return undefined;
  }

  const projection = await openJavaBridgeProjection(document, position);
  if (!projection) {
    return undefined;
  }

  const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeDefinitionProvider",
    projection.previewDocument.uri,
    projection.previewPosition
  );
  if (!definitions || definitions.length === 0) {
    return undefined;
  }

  const mapped = definitions
    .map((definition) => remapJavaDefinitionLocation(document, projection.previewDocument, definition))
    .filter((definition): definition is vscode.Location => Boolean(definition));
  return mapped.length > 0 ? mapped : undefined;
}

async function openJavaBridgeProjection(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<{ previewDocument: vscode.TextDocument; previewPosition: vscode.Position } | undefined> {
  const projection = projectSourceOffsetToJavaPreview(
    document.getText(),
    document.fileName,
    document.offsetAt(position),
    javaPreviewOptions(document)
  );
  if (!projection) {
    return undefined;
  }

  const previewDocument = await openJavaBridgePreviewDocument(document);
  return {
    previewDocument,
    previewPosition: previewDocument.positionAt(projection.previewOffset)
  };
}

async function openJavaBridgePreviewDocument(document: vscode.TextDocument): Promise<vscode.TextDocument> {
  const previewUri = buildPreviewUri(document, "java");
  const previewDocument = await vscode.workspace.openTextDocument(previewUri);
  return vscode.languages.setTextDocumentLanguage(previewDocument, "java");
}

function javaBridgeEnabled(document: vscode.TextDocument): boolean {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  return config.get<boolean>("javaIntelliSense.enabled", true);
}

function fallbackTargetCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionList {
  const text = document.getText();
  const range = javaWordRange(document, position);
  const receiver = javaCompletionReceiver(document, position);
  const target = completionTarget(document);
  const items = targetFallbackCompletionLabels(text, document.offsetAt(position), target)
    .map((label) => javaFallbackItem(
      label,
      receiver ? vscode.CompletionItemKind.Method : fallbackKindForTargetName(label, target),
      range,
      target
    ));
  return new vscode.CompletionList(items, false);
}

function completionTarget(document: vscode.TextDocument): TxtJetTargetLanguage {
  return effectiveCompletionTarget(selectedTargetLanguage(document), detectLanguage(document));
}

function javaFallbackItem(
  label: string,
  kind: vscode.CompletionItemKind,
  range: vscode.Range,
  target: TxtJetTargetLanguage
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, kind);
  item.detail = fallbackDetailForTarget(target);
  item.range = range;
  return item;
}

function fallbackDetailForTarget(target: TxtJetTargetLanguage): string {
  switch (target) {
    case "txtjet-python":
      return "TxtJet Python fallback";
    case "txtjet-c":
      return "TxtJet C/C++ fallback";
    case "txtjet-java":
    case "txtjet":
    case "txtjet-html":
    case "txtjet-xml":
    default:
      return "TxtJet Java fallback";
  }
}

function javaWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const line = document.lineAt(position.line).text;
  let start = position.character;
  while (start > 0 && /[A-Za-z0-9_$]/.test(line[start - 1])) {
    start -= 1;
  }
  return new vscode.Range(new vscode.Position(position.line, start), position);
}

function javaCompletionReceiver(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const line = document.lineAt(position.line).text.slice(0, position.character);
  const match = line.match(/([A-Za-z_$][\w$]*)\.\w*$/);
  return match?.[1];
}

function fallbackKindForTargetName(name: string, target: TxtJetTargetLanguage): vscode.CompletionItemKind {
  if (target === "txtjet-python") {
    if (/^[A-Z]/.test(name)) {
      return vscode.CompletionItemKind.Class;
    }
    return ["print", "len", "range", "str", "int", "list", "dict", "set"].includes(name)
      ? vscode.CompletionItemKind.Function
      : vscode.CompletionItemKind.Keyword;
  }
  if (target === "txtjet-c") {
    if (/^[A-Z]/.test(name)) {
      return vscode.CompletionItemKind.Struct;
    }
    return ["std", "string", "vector", "size_t"].includes(name)
      ? vscode.CompletionItemKind.Class
      : vscode.CompletionItemKind.Keyword;
  }
  if (isJavaKeywordCompletionName(name)) {
    return /^[A-Z]/.test(name) ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Keyword;
  }
  return /^[A-Z]/.test(name) ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Variable;
}

function remapJavaCompletionItem(
  document: vscode.TextDocument,
  previewDocument: vscode.TextDocument,
  position: vscode.Position,
  item: vscode.CompletionItem
): vscode.CompletionItem | undefined {
  const mapped = new vscode.CompletionItem(item.label, item.kind);
  mapped.detail = item.detail;
  mapped.documentation = item.documentation;
  mapped.sortText = item.sortText;
  mapped.filterText = item.filterText;
  mapped.commitCharacters = item.commitCharacters;
  mapped.preselect = item.preselect;
  mapped.tags = item.tags;
  mapped.keepWhitespace = item.keepWhitespace;

  const textEdit = item.textEdit;
  if (textEdit) {
    const range = completionTextEditRange(textEdit);
    const mappedRange = mapPreviewCompletionRange(document, previewDocument, range);
    if (!mappedRange) {
      return undefined;
    }
    mapped.insertText = textEdit.newText;
    mapped.range = mappedRange;
    return mapped;
  }

  if (item.range) {
    const mappedRange = mapPreviewCompletionRange(document, previewDocument, item.range);
    if (!mappedRange) {
      return undefined;
    }
    mapped.range = mappedRange;
  } else {
    mapped.range = new vscode.Range(position, position);
  }
  mapped.insertText = item.insertText;
  return mapped;
}

function remapJavaDefinitionLocation(
  document: vscode.TextDocument,
  previewDocument: vscode.TextDocument,
  definition: vscode.Location
): vscode.Location | undefined {
  if (definition.uri.toString() !== previewDocument.uri.toString()) {
    return definition;
  }

  const range = mapPreviewRangeToSourceVscodeRange(document, previewDocument, definition.range);
  return range ? new vscode.Location(document.uri, range) : undefined;
}

function mapPreviewCompletionRange(
  document: vscode.TextDocument,
  previewDocument: vscode.TextDocument,
  range: vscode.Range | CompletionInsertReplaceRange
): vscode.Range | CompletionInsertReplaceRange | undefined {
  if (isVscodeRange(range)) {
    return mapPreviewRangeToSourceVscodeRange(document, previewDocument, range);
  }

  const inserting = mapPreviewRangeToSourceVscodeRange(document, previewDocument, range.inserting);
  const replacing = mapPreviewRangeToSourceVscodeRange(document, previewDocument, range.replacing);
  return inserting && replacing ? { inserting, replacing } : undefined;
}

function mapPreviewRangeToSourceVscodeRange(
  document: vscode.TextDocument,
  previewDocument: vscode.TextDocument,
  range: vscode.Range
): vscode.Range | undefined {
  const previewText = previewDocument.getText();
  const mapped = mapJavaPreviewRangeToSource(
    document.getText(),
    document.fileName,
    {
      start: offsetAt(previewText, range.start),
      end: offsetAt(previewText, range.end)
    },
    javaPreviewOptions(document)
  );
  return mapped
    ? new vscode.Range(document.positionAt(mapped.start), document.positionAt(mapped.end))
    : undefined;
}

function completionTextEditRange(
  textEdit: vscode.TextEdit
): vscode.Range {
  return textEdit.range;
}

function isVscodeRange(value: vscode.Range | CompletionInsertReplaceRange): value is vscode.Range {
  return "start" in value && "end" in value;
}

function registerFormattingProvider(): vscode.Disposable {
  const selector = Array.from(TXTJET_LANGUAGES).map((language) => ({ language }));
  return vscode.Disposable.from(
    vscode.languages.registerDocumentFormattingEditProvider(
      selector,
      {
        provideDocumentFormattingEdits(document) {
          const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
          if (!config.get<boolean>("formatting.enabled", true)) {
            return [];
          }
          return formatTemplateRange(document, fullDocumentRange(document));
        }
      }
    ),
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector,
      {
        provideDocumentRangeFormattingEdits(document, range) {
          const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
          if (!config.get<boolean>("formatting.enabled", true)) {
            return [];
          }
          return formatTemplateRange(document, range);
        }
      }
    )
  );
}

function formatTemplateRange(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
  const text = document.getText();
  const startOffset = document.offsetAt(range.start);
  const endOffset = document.offsetAt(range.end);
  const model = parseTxtJetTemplate(text);
  const edits: vscode.TextEdit[] = [];

  for (const block of model.blocks) {
    if (block.range.end < startOffset || block.range.start > endOffset || block.kind === "outer") {
      continue;
    }
    const formatted = formatTxtJetBlock(block);
    if (formatted !== undefined && formatted !== block.content) {
      edits.push(vscode.TextEdit.replace(
        new vscode.Range(document.positionAt(block.contentRange.start), document.positionAt(block.contentRange.end)),
        formatted
      ));
    }
  }

  return edits;
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
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

function directiveValueCompletions(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionList | undefined {
  const context = directiveValueContextAt(document.getText(), document.offsetAt(position));
  if (!context) {
    return undefined;
  }

  if (context.directiveName === "include" && context.attributeName === "file") {
    return referencePathCompletions(document, position, context, "resolution.includePaths", [
      ".txtjet",
      ".jet",
      ".javajet",
      ".htmljet",
      ".xmljet",
      ".cjet",
      ".pythonjet",
      ".jetinc"
    ], "TxtJet include file");
  }

  if (context.directiveName === "jet" && context.attributeName === "skeleton") {
    return referencePathCompletions(document, position, context, "resolution.skeletonPaths", [".skeleton"], "TxtJet skeleton file");
  }

  if (context.directiveName === "jet" && context.attributeName === "imports") {
    return staticValueCompletions(
      [
        "java.util.List",
        "java.util.Map",
        "java.util.Set",
        "java.util.ArrayList",
        "java.util.HashMap",
        "java.io.File",
        "java.time.Instant",
        "java.time.LocalDate"
      ],
      "TxtJet Java import",
      vscode.CompletionItemKind.Module,
      directiveValueSegmentRange(document, position, context, /[;,]/)
    );
  }

  if (context.directiveName === "jet" && context.attributeName === "package") {
    return staticValueCompletions(
      packageNameCandidates(document),
      "TxtJet Java package",
      vscode.CompletionItemKind.Module,
      new vscode.Range(document.positionAt(context.valueRange.start), position)
    );
  }

  if (context.directiveName === "jet" && context.attributeName === "class") {
    return staticValueCompletions(
      classNameCandidates(document),
      "TxtJet Java class",
      vscode.CompletionItemKind.Class,
      new vscode.Range(document.positionAt(context.valueRange.start), position)
    );
  }

  return new vscode.CompletionList([], false);
}

function referencePathCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: NonNullable<ReturnType<typeof directiveValueContextAt>>,
  setting: string,
  allowedSuffixes: string[],
  detail: string
): vscode.CompletionList {
  const prefix = context.prefix.replace(/\\/g, "/");
  if (isAbsolutePath(prefix) || prefix.split("/").includes("..")) {
    return new vscode.CompletionList([], false);
  }

  const separator = prefix.lastIndexOf("/");
  const directoryPrefix = separator === -1 ? "" : prefix.slice(0, separator + 1);
  const filterPrefix = (separator === -1 ? prefix : prefix.slice(separator + 1)).toLowerCase();
  const replaceStart = context.valueRange.start + (separator === -1 ? 0 : separator + 1);
  const range = new vscode.Range(document.positionAt(replaceStart), position);
  const roots = uniqueStrings([dirname(document.fileName), ...configuredReferencePaths(document, setting)]);
  const items: vscode.CompletionItem[] = [];

  for (const root of roots) {
    const directory = join(root, directoryPrefix);
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(directory, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      const isAllowedFile = entry.isFile() && allowedSuffixes.some((suffix) => lower.endsWith(suffix));
      if (!entry.isDirectory() && !isAllowedFile) {
        continue;
      }
      if (filterPrefix && !lower.startsWith(filterPrefix)) {
        continue;
      }

      const label = entry.isDirectory() ? `${entry.name}/` : entry.name;
      if (items.some((item) => item.label === label)) {
        continue;
      }
      const item = new vscode.CompletionItem(label, entry.isDirectory() ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
      item.detail = entry.isDirectory() ? "TxtJet reference folder" : detail;
      item.insertText = label;
      item.range = range;
      item.sortText = `${entry.isDirectory() ? "0" : "1"}_${label}`;
      items.push(item);
    }
  }

  return new vscode.CompletionList(items, false);
}

function staticValueCompletions(
  labels: string[],
  detail: string,
  kind: vscode.CompletionItemKind,
  range: vscode.Range
): vscode.CompletionList {
  const items = uniqueStrings(labels).map((label) => {
    const item = new vscode.CompletionItem(label, kind);
    item.detail = detail;
    item.range = range;
    return item;
  });
  return new vscode.CompletionList(items, false);
}

function directiveValueSegmentRange(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: NonNullable<ReturnType<typeof directiveValueContextAt>>,
  separator: RegExp
): vscode.Range {
  let start = context.valueRange.start;
  for (let index = context.prefix.length - 1; index >= 0; index -= 1) {
    if (separator.test(context.prefix[index])) {
      start = context.valueRange.start + index + 1;
      break;
    }
  }
  while (start < document.offsetAt(position) && /\s/.test(document.getText()[start])) {
    start += 1;
  }
  return new vscode.Range(document.positionAt(start), position);
}

function packageNameCandidates(document: vscode.TextDocument): string[] {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const relativeDirectory = workspaceFolder ? relative(workspaceFolder.uri.fsPath, dirname(document.fileName)) : "";
  const packageFromPath = relativeDirectory
    .split(/[\\/]+/)
    .filter((part) => /^[A-Za-z_][\w]*$/.test(part))
    .join(".");
  return ["txtjet.generated", "generated", packageFromPath].filter((entry) => entry.length > 0);
}

function classNameCandidates(document: vscode.TextDocument): string[] {
  const baseName = stripTxtJetSuffix(basename(document.fileName));
  const className = baseName
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return [className ? `${className}Template` : "", "GeneratedTxtJetTemplate"].filter((entry) => /^[A-Za-z_$][\w$]*$/.test(entry));
}

function stripTxtJetSuffix(fileName: string): string {
  return fileName.replace(/\.(?:txtjet|jet|javajet|htmljet|xmljet|cjet|pythonjet)$/i, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
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

function selectedTargetLanguage(document: vscode.TextDocument): TxtJetTargetLanguage {
  return selectedTargetLanguageId(document.languageId, detectLanguage(document));
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
