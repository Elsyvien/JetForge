import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute as isAbsolutePath, join, normalize, relative } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { CoalescingAsyncRefresh } from "./asyncRefresh";
import { buildTxtJetCodeActionEdit } from "./codeActions";
import {
  mapCompilerProblemsToSource,
  parseCompilerProblems,
  TxtJetCompilerDiagnosticSeverity
} from "./compilerDiagnostics";
import {
  compilerCommandGuidance,
  CompilerToolchainReport,
  CompilerValidationResult,
  formatCompilerToolchainReport,
  formatWorkspaceValidationReport,
  summarizeWorkspaceValidation
} from "./compilerToolchain";
import { detectTargetLanguage, detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import {
  COMPLETION_TRIGGER_CHARACTERS,
  compilerTimeoutMs,
  DIRECTIVE_VALUE_TRIGGER_CHARACTERS,
  directiveValueContextAt,
  isPathInsideAnyRoot,
  isTxtJetPath,
  resolveWorkspaceConfiguredPath,
  selectedTargetLanguageId,
  shellArgumentQuote,
  stripTxtJetSuffix,
  shouldOfferMarkerCompletions
} from "./extensionSupport";
import { formatTxtJetBlock } from "./formatter";
import {
  DEFAULT_IPXACT_PROBLEM_MATCHER,
  IPXACT_NODE_COMPLETIONS,
  isIpxactTemplate,
  mapIpxactProblemsToSource,
  TxtJetMappedIpxactProblem
} from "./ipxact";
import {
  buildIpxactSchemaIndex,
  ipxactGeneratedStructures,
  ipxactXmlContextAt,
  ipxactXmlNameAt,
  schemaAttributesFor,
  schemaChildrenFor,
  schemaElementsNamed,
  TxtJetIpxactSchemaAttribute,
  TxtJetIpxactSchemaElement,
  TxtJetIpxactSchemaIndex,
  TxtJetIpxactStructure
} from "./ipxactSchema";
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
  createJavaWorkspaceIndex,
  referencedWorkspaceJavaClasses,
  workspaceJavaClassDependencies,
  TxtJetJavaWorkspaceDependency,
  TxtJetJavaWorkspaceIndex,
  workspaceJavaCompletionsAt,
  workspaceJavaDefinitionsAt,
  workspaceJavaHoverAt,
  workspaceJavaSignatureHelpAt
} from "./javaWorkspaceIntelligence";
import { synchronizedPreviewRange } from "./previewSync";
import { VersionedPreviewCache } from "./previewCache";
import {
  buildCompilerOutputProvenance,
  previewLineProvenance,
  primaryProvenance,
  provenanceAtPreviewOffset
} from "./provenance";
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
  targetOutputExtension,
  targetPreviewLanguage,
  TxtJetBlock,
  TxtJetDirective,
  TxtJetGeneratedPreview,
  TxtJetProvenance,
  TxtJetProvenanceKind,
  TxtJetRange
} from "./templateModel";
import {
  createTxtJetWorkspaceModel,
  isExcludedTxtJetWorkspacePath,
  TXTJET_WORKSPACE_EXCLUDE_GLOB,
  TXTJET_WORKSPACE_GLOB,
  TxtJetWorkspaceEntry,
  TxtJetWorkspaceModel,
  TxtJetWorkspaceReference,
  TxtJetWorkspaceReferenceKind,
  workspaceModelTopologyChanged,
  workspaceEntryKind
} from "./workspaceModel";
import { generatedOutputPath, isolatedValidationOutputPath } from "./generationPaths";
import { ValidationRunCoordinator } from "./validationRuns";

const TXTJET_LANGUAGES = new Set<TxtJetTargetLanguage>([
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python",
  "txtjet-latex"
]);

const LANGUAGE_OPTIONS: Array<{ label: string; shortLabel: string; description: string; languageId: TxtJetTargetLanguage; command: string }> = [
  { label: "Generic TxtJet Template", shortLabel: "Generic", description: "Outer content is plain template text; embedded Java is still highlighted.", languageId: "txtjet", command: "txtjet.setLanguage.default" },
  { label: "Generated Java Output", shortLabel: "Java output", description: "Use only when the generated outer content is Java.", languageId: "txtjet-java", command: "txtjet.setLanguage.java" },
  { label: "Generated HTML Output", shortLabel: "HTML output", description: "Use only when the generated outer content is HTML.", languageId: "txtjet-html", command: "txtjet.setLanguage.html" },
  { label: "Generated XML Output", shortLabel: "XML output", description: "Use only when the generated outer content is XML.", languageId: "txtjet-xml", command: "txtjet.setLanguage.xml" },
  { label: "Generated C Output", shortLabel: "C output", description: "Use only when the generated outer content is C/C header code.", languageId: "txtjet-c", command: "txtjet.setLanguage.c" },
  { label: "Generated Python Output", shortLabel: "Python output", description: "Use only when the generated outer content is Python.", languageId: "txtjet-python", command: "txtjet.setLanguage.python" },
  { label: "Generated LaTeX Output", shortLabel: "LaTeX output", description: "Use only when the generated outer content is LaTeX.", languageId: "txtjet-latex", command: "txtjet.setLanguage.latex" }
];

const MODE_STORAGE_KEY = "txtjet.documentLanguageModes.v2";
const CONFIG_SECTION = "txtjet";
const DIAGNOSTIC_SOURCE = "txtjet";
const DEFAULT_MAX_DIAGNOSTIC_FILE_SIZE_KB = 1024;
const OUTPUT_PREVIEW_SCHEME = "txtjet-preview-output";
const JAVA_PREVIEW_SCHEME = "txtjet-preview-java";
const IPXACT_PREVIEW_SCHEME = "txtjet-preview-ipxact";
const GENERATED_DIFF_SCHEME = "txtjet-generated-diff";
const GENERATION_STORAGE_KEY = "txtjet.lastGeneratedOutput.v1";
const IPXACT_GENERATION_STORAGE_KEY = "txtjet.lastGeneratedIpxactOutput.v1";
const MAX_GENERATED_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_GENERATED_SNAPSHOT_COUNT = 20;
const execAsync = promisify(exec);
let activeWorkspaceModel: TxtJetWorkspaceModel | undefined;
let requestWorkspaceModelRefresh: ((invalidate?: boolean, immediate?: boolean) => Promise<boolean>) | undefined;
let workspaceModelGeneration = 0;
let javaWorkspaceIndexCache: { key: string; index: TxtJetJavaWorkspaceIndex } | undefined;
const ipxactSchemaIndexCache = new Map<string, TxtJetIpxactSchemaIndex>();
const ipxactSchemaDiscoveryCache = new Map<string, string[]>();
const ipxactSchemaWatchers = new Map<string, vscode.Disposable>();
const compilerOutputSources = new Map<string, string>();

export function activate(context: vscode.ExtensionContext): void {
  activeWorkspaceModel = undefined;
  invalidateIpxactSchemaCaches();
  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose() {
      for (const watcher of ipxactSchemaWatchers.values()) {
        watcher.dispose();
      }
      ipxactSchemaWatchers.clear();
      invalidateIpxactSchemaCaches();
    }
  });
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "txtjet.selectTargetLanguage";
  context.subscriptions.push(statusBar);
  const diagnostics = vscode.languages.createDiagnosticCollection("txtjet");
  context.subscriptions.push(diagnostics);
  const compilerDiagnosticsBySource = new Map<string, vscode.Diagnostic[]>();
  const ipxactDiagnosticsBySource = new Map<string, vscode.Diagnostic[]>();
  const compilerValidationRuns = new ValidationRunCoordinator();
  const ipxactValidationRuns = new ValidationRunCoordinator();
  context.subscriptions.push(compilerValidationRuns, ipxactValidationRuns);
  const previewProvider = new TxtJetPreviewProvider();
  const generatedDiffProvider = new TxtJetGeneratedDiffProvider(context);
  const visualDifferentiator = new TxtJetVisualDifferentiator();
  const provenanceLens = new TxtJetProvenanceLens();
  const previewSynchronizer = new TxtJetPreviewSynchronizer();
  const workspaceTreeProvider = new TxtJetWorkspaceTreeProvider();
  const workspaceTreeView = vscode.window.createTreeView("txtjetWorkspace", {
    treeDataProvider: workspaceTreeProvider,
    showCollapseAll: true
  });
  workspaceTreeView.message = "Indexing TxtJet workspace files…";
  context.subscriptions.push(
    visualDifferentiator,
    provenanceLens,
    previewSynchronizer,
    previewProvider,
    generatedDiffProvider,
    workspaceTreeProvider,
    workspaceTreeView,
    vscode.workspace.registerTextDocumentContentProvider(OUTPUT_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(JAVA_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(IPXACT_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(GENERATED_DIFF_SCHEME, generatedDiffProvider)
  );
  let workspaceRefreshGeneration = 0;
  const refreshWorkspaceModel = async (invalidateCompilerDiagnostics: boolean): Promise<boolean> => {
    const refreshGeneration = ++workspaceRefreshGeneration;
    try {
      const model = await buildTxtJetWorkspaceModel();
      if (refreshGeneration !== workspaceRefreshGeneration) {
        return false;
      }
      const previousModel = activeWorkspaceModel;
      activeWorkspaceModel = model;
      workspaceModelGeneration += 1;
      javaWorkspaceIndexCache = undefined;
      workspaceTreeProvider.setModel(model);
      updateWorkspaceTreeView(workspaceTreeView, model);
      if (previousModel && workspaceModelTopologyChanged(previousModel, model)) {
        previewProvider.refreshAll();
      }
      if (invalidateCompilerDiagnostics) {
        compilerDiagnosticsBySource.clear();
        ipxactDiagnosticsBySource.clear();
        compilerValidationRuns.dispose();
        ipxactValidationRuns.dispose();
      }
      for (const document of vscode.workspace.textDocuments) {
        updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
      }
      return true;
    } catch (error) {
      appendOutputLog("error", `Workspace model refresh failed: ${String(error)}`);
      workspaceTreeView.description = undefined;
      workspaceTreeView.message = "TxtJet workspace indexing failed. Run Refresh Workspace Model and open the TxtJet output for details.";
      return false;
    }
  };
  const workspaceRefresh = new CoalescingAsyncRefresh(refreshWorkspaceModel, 150);
  const refreshRequester = (invalidate = false, immediate = false): Promise<boolean> =>
    workspaceRefresh.request(invalidate, immediate);
  requestWorkspaceModelRefresh = refreshRequester;
  context.subscriptions.push(workspaceRefresh);
  context.subscriptions.push({
    dispose(): void {
      if (requestWorkspaceModelRefresh === refreshRequester) {
        requestWorkspaceModelRefresh = undefined;
        activeWorkspaceModel = undefined;
        javaWorkspaceIndexCache = undefined;
      }
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openGettingStarted", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        { category: "elsyvien.txtjet-syntax#jetforge.gettingStarted" },
        false
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.setupCompilerToolchain", async (resource?: vscode.Uri | TxtJetWorkspaceTreeNode) => {
      await setupCompilerToolchain(resource);
    })
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
    vscode.commands.registerCommand("txtjet.clearGeneratedSnapshots", async () => {
      await Promise.all([
        context.workspaceState.update(GENERATION_STORAGE_KEY, undefined),
        context.workspaceState.update(IPXACT_GENERATION_STORAGE_KEY, undefined)
      ]);
      vscode.window.setStatusBarMessage("TxtJet generated-output snapshots cleared.", 4000);
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
    vscode.commands.registerCommand("txtjet.togglePreviewProvenanceLens", async () => {
      const activeDocument = vscode.window.activeTextEditor?.document;
      const provenance = activeDocument ? provenanceContext(activeDocument) : undefined;
      const resource = provenance?.sourceDocument.uri ?? activeDocument?.uri;
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
      const nextEnabled = !config.get<boolean>("previews.provenanceLens.enabled", true);
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await config.update("previews.provenanceLens.enabled", nextEnabled, target);
      provenanceLens.refreshAll();
      vscode.window.setStatusBarMessage(`TxtJet generated preview provenance lens ${nextEnabled ? "enabled" : "disabled"}.`, 4000);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.showPreviewLineSource", async () => {
      await showPreviewLineSource();
    }),
    vscode.commands.registerCommand("txtjet.showPreviewLineContributions", async () => {
      await showPreviewLineContributions();
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
      await validateTemplateWithCompiler(
        editor.document,
        diagnostics,
        compilerDiagnosticsBySource,
        true,
        ipxactDiagnosticsBySource,
        compilerValidationRuns
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.refreshWorkspaceModel", async () => {
      if (await workspaceRefresh.request(false, true)) {
        vscode.window.setStatusBarMessage("TxtJet workspace model refreshed.", 4000);
      } else {
        vscode.window.showErrorMessage("TxtJet could not refresh the workspace model. Open the TxtJet output channel for details.");
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openWorkspaceReference", async (item?: TxtJetWorkspaceTreeNode) => {
      if (item?.kind === "reference") {
        await openWorkspaceReference(item.reference);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openIncludingTemplate", async (item?: TxtJetWorkspaceTreeNode) => {
      await openIncludingTemplate(item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openGeneratedJavaForTemplate", async (item?: TxtJetWorkspaceTreeNode) => {
      await openGeneratedJavaForTemplate(item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openGeneratedOutputForTemplate", async (item?: TxtJetWorkspaceTreeNode) => {
      await openGeneratedOutputForTemplate(item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.validateWorkspaceTemplates", async () => {
      await validateWorkspaceTemplates(
        diagnostics,
        compilerDiagnosticsBySource,
        ipxactDiagnosticsBySource,
        compilerValidationRuns
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.showImpactGraph", async (item?: TxtJetWorkspaceTreeNode) => {
      await showImpactGraph(item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.showReferencedJavaClasses", async (resource?: vscode.Uri) => {
      await showReferencedJavaClasses(resource);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.extractSelectionToInclude", async () => {
      await extractSelectionToInclude();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.renameWorkspaceReference", async (item?: TxtJetWorkspaceTreeNode) => {
      await renameWorkspaceReference(item);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openIpxactPreview", async () => {
      await openIpxactPreview();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.generateIpxactOutput", async () => {
      await generateIpxactOutput(context, generatedDiffProvider, false);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.diffIpxactOutput", async () => {
      await generateIpxactOutput(context, generatedDiffProvider, true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.validateIpxact", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isTxtJetFile(editor.document)) {
        return;
      }
      await validateIpxactTemplate(
        editor.document,
        diagnostics,
        ipxactDiagnosticsBySource,
        true,
        compilerDiagnosticsBySource,
        ipxactValidationRuns
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openIpxactTemplate", async () => {
      await openIpxactTemplate();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.openSynchronizedPreview", async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || !isTxtJetFile(document)) {
        return;
      }
      await setSynchronizedRevealEnabled(document, true);
      await openPreview("output", true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.togglePreviewSynchronization", async () => {
      await togglePreviewSynchronization();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void applyDetectedLanguage(context, document, false, statusBar, visualDifferentiator);
      updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
      visualDifferentiator.refreshDocument(document);
      if (workspaceEntryKind(document.fileName) && !activeWorkspaceModel?.entry(document.fileName)) {
        void workspaceRefresh.request();
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const affectedDocuments = invalidateAffectedExternalDiagnostics(
        event.document,
        compilerDiagnosticsBySource,
        ipxactDiagnosticsBySource,
        compilerValidationRuns,
        ipxactValidationRuns
      );
      for (const document of affectedDocuments) {
        updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
      }
      previewProvider.refreshAffected(event.document.uri, activeWorkspaceModel);
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
        void validateTemplateWithCompiler(
          document,
          diagnostics,
          compilerDiagnosticsBySource,
          false,
          ipxactDiagnosticsBySource,
          compilerValidationRuns
        );
      }
      if (
        isTxtJetFile(document)
        && config.get<boolean>("ipxact.enabled", false)
        && config.get<boolean>("ipxact.validation.runOnSave", false)
      ) {
        void validateIpxactTemplate(
          document,
          diagnostics,
          ipxactDiagnosticsBySource,
          false,
          compilerDiagnosticsBySource,
          ipxactValidationRuns
        );
      }
      void workspaceRefresh.request();
    })
  );
  const workspaceWatcher = vscode.workspace.createFileSystemWatcher(TXTJET_WORKSPACE_GLOB);
  const handleWorkspaceFileChange = (uri: vscode.Uri): void => {
    previewSynchronizer.invalidate();
    previewProvider.refreshAffected(uri, activeWorkspaceModel);
    void workspaceRefresh.request();
  };
  context.subscriptions.push(
    workspaceWatcher,
    workspaceWatcher.onDidCreate(handleWorkspaceFileChange),
    workspaceWatcher.onDidChange(handleWorkspaceFileChange),
    workspaceWatcher.onDidDelete(handleWorkspaceFileChange)
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
          updateDiagnostics(diagnostics, sourceDocument, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
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
        updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
      }
      visualDifferentiator.refreshAll();
      previewSynchronizer.invalidate();
      if (event.affectsConfiguration(`${CONFIG_SECTION}.ipxact.schemaPaths`)) {
        invalidateIpxactSchemaCaches();
      }
      void workspaceRefresh.request(true);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      compilerDiagnosticsBySource.delete(document.uri.toString());
      ipxactDiagnosticsBySource.delete(document.uri.toString());
      compilerValidationRuns.invalidate(document.uri.toString());
      ipxactValidationRuns.invalidate(document.uri.toString());
      diagnostics.delete(document.uri);
      previewProvider.forget(document.uri);
      visualDifferentiator.clearDocument(document);
    })
  );

  context.subscriptions.push(registerCompletionProvider());
  context.subscriptions.push(registerCodeActionProvider());
  context.subscriptions.push(registerDocumentSymbolProvider());
  context.subscriptions.push(registerCodeLensProvider());
  context.subscriptions.push(registerDefinitionProvider());
  context.subscriptions.push(registerHoverProvider());
  context.subscriptions.push(registerPreviewProvenanceProviders());
  context.subscriptions.push(registerIpxactPreviewSchemaProviders());
  context.subscriptions.push(registerReferenceProvider());
  context.subscriptions.push(registerRenameProvider());
  context.subscriptions.push(registerSignatureHelpProvider());
  context.subscriptions.push(registerFormattingProvider());

  for (const document of vscode.workspace.textDocuments) {
    void applyDetectedLanguage(context, document, false, statusBar, visualDifferentiator);
    updateDiagnostics(diagnostics, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    visualDifferentiator.refreshDocument(document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateStatusBar(statusBar, editor?.document, context);
      visualDifferentiator.refreshEditor(editor);
      provenanceLens.refreshEditor(editor);
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        visualDifferentiator.refreshEditor(editor);
        provenanceLens.refreshEditor(editor);
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(() => updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context))
  );
  updateStatusBar(statusBar, vscode.window.activeTextEditor?.document, context);
  void workspaceRefresh.request(false, true);
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

class TxtJetPreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
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
    if (uri.scheme === IPXACT_PREVIEW_SCHEME) {
      return buildIpxactPreviewForDocument(document).text;
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

  refreshAffected(changed: vscode.Uri, model: TxtJetWorkspaceModel | undefined): void {
    if (!model) {
      this.refresh(changed);
      return;
    }
    if (this.trackedSourcesHaveChangedReferenceTopology(model)) {
      this.refreshAll();
      return;
    }
    const affectedFileNames = new Set(
      model.impactedBy(changed.fsPath).affectedEntries.map((entry) => normalize(entry.fileName))
    );
    if (affectedFileNames.size === 0) {
      this.refresh(changed);
      return;
    }
    for (const [source, previews] of this.previewsBySource) {
      try {
        if (!affectedFileNames.has(normalize(vscode.Uri.parse(source).fsPath))) {
          continue;
        }
      } catch {
        continue;
      }
      for (const preview of previews) {
        this.changed.fire(vscode.Uri.parse(preview));
      }
    }
  }

  refreshAll(): void {
    for (const previews of this.previewsBySource.values()) {
      for (const preview of previews) {
        this.changed.fire(vscode.Uri.parse(preview));
      }
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

  dispose(): void {
    this.previewsBySource.clear();
    this.changed.dispose();
  }

  private trackedSourcesHaveChangedReferenceTopology(model: TxtJetWorkspaceModel): boolean {
    for (const source of this.previewsBySource.keys()) {
      let sourceUri: vscode.Uri;
      try {
        sourceUri = vscode.Uri.parse(source);
      } catch {
        continue;
      }
      const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === source);
      if (!document || !isTxtJetFile(document)) {
        continue;
      }
      const entry = model.entry(sourceUri.fsPath);
      if (!entry || !sameStrings(currentDocumentReferenceTopology(document), entryReferenceTopology(entry))) {
        return true;
      }
    }
    return false;
  }

  private track(source: vscode.Uri, preview: vscode.Uri): void {
    const key = source.toString();
    const previews = this.previewsBySource.get(key) ?? new Set<string>();
    previews.add(preview.toString());
    this.previewsBySource.set(key, previews);
  }
}

function currentDocumentReferenceTopology(document: vscode.TextDocument): string[] {
  const template = parseTxtJetTemplate(document.getText());
  const references = template.includes.map((directive) =>
    ["include", directive.attributes.file ?? ""].join("\0")
  );
  const skeleton = template.jetDirective?.attributes.skeleton;
  if (skeleton) {
    references.push(["skeleton", skeleton].join("\0"));
  }
  return references.sort();
}

function entryReferenceTopology(entry: TxtJetWorkspaceEntry): string[] {
  return entry.references
    .map((reference) => [reference.kind, reference.referenceFile].join("\0"))
    .sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidateAffectedExternalDiagnostics(
  changedDocument: vscode.TextDocument,
  compilerDiagnosticsBySource: Map<string, vscode.Diagnostic[]>,
  ipxactDiagnosticsBySource: Map<string, vscode.Diagnostic[]>,
  compilerValidationRuns: ValidationRunCoordinator,
  ipxactValidationRuns: ValidationRunCoordinator
): vscode.TextDocument[] {
  const affectedFileNames = new Set<string>([normalize(changedDocument.fileName)]);
  if (activeWorkspaceModel) {
    for (const entry of activeWorkspaceModel.impactedBy(changedDocument.fileName).affectedEntries) {
      affectedFileNames.add(normalize(entry.fileName));
    }
  }

  const affectedDocuments = vscode.workspace.textDocuments.filter((document) =>
    affectedFileNames.has(normalize(document.fileName))
  );
  for (const document of affectedDocuments) {
    const source = document.uri.toString();
    compilerDiagnosticsBySource.delete(source);
    ipxactDiagnosticsBySource.delete(source);
    compilerValidationRuns.invalidate(source);
    ipxactValidationRuns.invalidate(source);
  }
  return affectedDocuments;
}

class TxtJetGeneratedDiffProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const source = queryValue(uri, "source");
    const requestedStorageKey = queryValue(uri, "storage");
    const storageKey = requestedStorageKey === IPXACT_GENERATION_STORAGE_KEY
      ? IPXACT_GENERATION_STORAGE_KEY
      : GENERATION_STORAGE_KEY;
    return source ? this.context.workspaceState.get<Record<string, string>>(storageKey, {})[source] ?? "" : "";
  }

  refresh(uri: vscode.Uri): void {
    this.changed.fire(uri);
  }

  dispose(): void {
    this.changed.dispose();
  }
}

type TxtJetWorkspaceTreeNode =
  | { kind: "group"; id: "templates" | "includes" | "skeletons" | "unresolved" | "generated" | "ipxact"; label: string }
  | { kind: "entry"; entry: TxtJetWorkspaceEntry }
  | { kind: "reference"; reference: TxtJetWorkspaceReference }
  | { kind: "generated"; entry: TxtJetWorkspaceEntry };
type TxtJetWorkspaceGroupId = Extract<TxtJetWorkspaceTreeNode, { kind: "group" }>["id"];

class TxtJetWorkspaceTreeProvider implements vscode.TreeDataProvider<TxtJetWorkspaceTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<TxtJetWorkspaceTreeNode | undefined>();
  private model: TxtJetWorkspaceModel | undefined;

  readonly onDidChangeTreeData = this.changed.event;

  setModel(model: TxtJetWorkspaceModel): void {
    this.model = model;
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.changed.dispose();
  }

  getTreeItem(element: TxtJetWorkspaceTreeNode): vscode.TreeItem {
    if (element.kind === "group") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = `txtjetWorkspace.${element.id}`;
      item.iconPath = groupIcon(element.id);
      return item;
    }

    if (element.kind === "reference") {
      const item = new vscode.TreeItem(
        `${basename(element.reference.sourceFileName)} -> ${element.reference.referenceFile}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = element.reference.kind;
      item.tooltip = `Unresolved ${element.reference.kind} reference in ${element.reference.sourceFileName}`;
      item.contextValue = "txtjetWorkspace.unresolvedReference";
      item.iconPath = new vscode.ThemeIcon("warning");
      item.command = {
        command: "txtjet.openWorkspaceReference",
        title: "Open TxtJet reference source",
        arguments: [element]
      };
      return item;
    }

    if (element.kind === "generated") {
      const item = new vscode.TreeItem(
        `${basename(element.entry.fileName)} -> ${targetPreviewLanguage(element.entry.targetLanguage)}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = workspaceRelativeLabel(element.entry.fileName);
      item.contextValue = "txtjetWorkspace.generated";
      item.iconPath = new vscode.ThemeIcon("symbol-file");
      item.command = {
        command: "txtjet.openGeneratedOutputForTemplate",
        title: "Open Generated Output For Template",
        arguments: [element]
      };
      return item;
    }

    const item = new vscode.TreeItem(basename(element.entry.fileName), vscode.TreeItemCollapsibleState.None);
    item.description = workspaceRelativeLabel(element.entry.fileName);
    item.tooltip = element.entry.fileName;
    item.contextValue = `txtjetWorkspace.${element.entry.kind}`;
    item.iconPath = entryIcon(element.entry.kind);
    item.command = {
      command: "vscode.open",
      title: "Open TxtJet workspace file",
      arguments: [vscode.Uri.file(element.entry.fileName)]
    };
    return item;
  }

  getChildren(element?: TxtJetWorkspaceTreeNode): TxtJetWorkspaceTreeNode[] {
    if (!this.model || this.model.entries.length === 0) {
      return [];
    }
    if (!element) {
      const groups: TxtJetWorkspaceTreeNode[] = [
        { kind: "group", id: "templates", label: `Templates (${this.model.templates.length})` },
        { kind: "group", id: "includes", label: `Includes (${this.model.includes.length})` },
        { kind: "group", id: "skeletons", label: `Skeletons (${this.model.skeletons.length})` },
        { kind: "group", id: "unresolved", label: `Unresolved References (${this.model.unresolvedReferences.length})` },
        { kind: "group", id: "generated", label: `Generated Output Targets (${this.model.templates.length})` }
      ];
      if (this.model.ipxactTemplates.length > 0) {
        groups.splice(3, 0, {
          kind: "group",
          id: "ipxact",
          label: `IP-XACT Templates (${this.model.ipxactTemplates.length})`
        });
      }
      return groups;
    }
    if (element.kind !== "group") {
      return [];
    }
    switch (element.id) {
      case "templates":
        return this.model.templates.map((entry) => ({ kind: "entry", entry }));
      case "includes":
        return this.model.includes.map((entry) => ({ kind: "entry", entry }));
      case "skeletons":
        return this.model.skeletons.map((entry) => ({ kind: "entry", entry }));
      case "ipxact":
        return this.model.ipxactTemplates.map((entry) => ({ kind: "entry", entry }));
      case "unresolved":
        return this.model.unresolvedReferences.map((reference) => ({ kind: "reference", reference }));
      case "generated":
        return this.model.templates.map((entry) => ({ kind: "generated", entry }));
      default:
        return [];
    }
  }
}

function updateWorkspaceTreeView(
  view: vscode.TreeView<TxtJetWorkspaceTreeNode>,
  model: TxtJetWorkspaceModel
): void {
  const workspaceCount = vscode.workspace.workspaceFolders?.length ?? 0;
  if (model.entries.length === 0) {
    view.description = undefined;
    view.message = workspaceCount === 0
      ? "Open a folder or a TxtJet file to get started."
      : "No TxtJet files found. Run “TxtJet: Open Getting Started” for setup and examples.";
    return;
  }
  view.message = undefined;
  view.description = `${model.templates.length} template${model.templates.length === 1 ? "" : "s"}`;
}

function groupIcon(id: TxtJetWorkspaceGroupId): vscode.ThemeIcon {
  switch (id) {
    case "templates":
      return new vscode.ThemeIcon("files");
    case "includes":
      return new vscode.ThemeIcon("references");
    case "skeletons":
      return new vscode.ThemeIcon("symbol-class");
    case "ipxact":
      return new vscode.ThemeIcon("symbol-namespace");
    case "unresolved":
      return new vscode.ThemeIcon("warning");
    case "generated":
    default:
      return new vscode.ThemeIcon("output");
  }
}

function entryIcon(kind: TxtJetWorkspaceEntry["kind"]): vscode.ThemeIcon {
  switch (kind) {
    case "include":
      return new vscode.ThemeIcon("file-submodule");
    case "skeleton":
      return new vscode.ThemeIcon("symbol-class");
    case "template":
    default:
      return new vscode.ThemeIcon("file-code");
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
    "txtjet-python": outputDecoration("rgba(152, 195, 121, 0.10)", "rgba(152, 195, 121, 0.24)"),
    "txtjet-latex": outputDecoration("rgba(198, 120, 221, 0.10)", "rgba(198, 120, 221, 0.24)")
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

class TxtJetProvenanceLens implements vscode.Disposable {
  private readonly decorations: Record<TxtJetProvenanceKind, vscode.TextEditorDecorationType> = {
    root: provenanceDecoration("R", new vscode.ThemeColor("editorCodeLens.foreground"), "rgba(86, 156, 214, 0.38)"),
    include: provenanceDecoration("I", new vscode.ThemeColor("charts.orange"), "rgba(206, 145, 120, 0.55)"),
    expression: provenanceDecoration("E", new vscode.ThemeColor("charts.green"), "rgba(78, 201, 176, 0.55)"),
    skeleton: provenanceDecoration("S", new vscode.ThemeColor("charts.purple"), "rgba(197, 134, 192, 0.55)"),
    unmapped: provenanceDecoration("?", new vscode.ThemeColor("disabledForeground"), "rgba(128, 128, 128, 0.35)")
  };
  private readonly disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.Disposable.from(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isPreviewDocument(event.document) || isCompilerOutputDocument(event.document) || isTxtJetFile(event.document)) {
          this.refreshAll();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIG_SECTION}.previews.provenanceLens.enabled`)) {
          this.refreshAll();
        }
      })
    );
  }

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.refreshEditor(editor);
    }
  }

  refreshEditor(editor?: vscode.TextEditor): void {
    if (!editor) {
      return;
    }
    const context = provenanceContext(editor.document);
    if (!context) {
      return;
    }
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, context?.sourceDocument.uri);
    if (!context || !config.get<boolean>("previews.provenanceLens.enabled", true)) {
      this.clearEditor(editor);
      return;
    }

    const grouped: Record<TxtJetProvenanceKind, vscode.DecorationOptions[]> = {
      root: [],
      include: [],
      expression: [],
      skeleton: [],
      unmapped: []
    };
    for (const line of previewLineProvenance(context.preview)) {
      const primary = primaryProvenance(line.origins) ?? line.origins[0];
      grouped[primary.kind].push({
        range: new vscode.Range(new vscode.Position(line.line, 0), new vscode.Position(line.line, 0)),
        hoverMessage: provenanceMarkdown(line.origins)
      });
    }
    for (const kind of Object.keys(grouped) as TxtJetProvenanceKind[]) {
      editor.setDecorations(this.decorations[kind], grouped[kind]);
    }
  }

  dispose(): void {
    this.disposable.dispose();
    for (const decoration of Object.values(this.decorations)) {
      decoration.dispose();
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const decoration of Object.values(this.decorations)) {
      editor.setDecorations(decoration, []);
    }
  }
}

function provenanceDecoration(
  marker: string,
  color: vscode.ThemeColor,
  overviewRulerColor: string
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    before: {
      contentText: `${marker}  `,
      color,
      fontStyle: "normal",
      fontWeight: "600",
      margin: "0 0.7rem 0 0"
    },
    overviewRulerColor,
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });
}

class TxtJetPreviewSynchronizer implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  private readonly previews = new VersionedPreviewCache<TxtJetGeneratedPreview>();
  private syncing = false;

  constructor() {
    this.disposable = vscode.Disposable.from(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.syncSelection(event.textEditor);
      }),
      vscode.workspace.onDidChangeTextDocument(() => this.invalidate()),
      vscode.workspace.onDidCloseTextDocument(() => this.invalidate())
    );
  }

  dispose(): void {
    this.previews.invalidate();
    this.disposable.dispose();
  }

  invalidate(): void {
    this.previews.invalidate();
  }

  private syncSelection(editor: vscode.TextEditor): void {
    if (this.syncing) {
      return;
    }

    const source = isPreviewDocument(editor.document)
      ? sourceUriFromPreview(editor.document.uri)
      : editor.document.uri;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, source);
    if (!config.get<boolean>("previews.synchronizedReveal.enabled", false)) {
      return;
    }

    if (isTxtJetFile(editor.document)) {
      const previewEditor = visiblePreviewEditorForSource(editor.document.uri);
      if (!previewEditor) {
        return;
      }
      const preview = this.previewForVisiblePreview(editor.document, previewEditor.document.uri);
      const mapped = synchronizedPreviewRange(preview.mappings, selectionToRange(editor.document, editor.selection), "source-to-preview");
      this.reveal(previewEditor, mapped);
      return;
    }

    if (!isPreviewDocument(editor.document) || !source) {
      return;
    }
    const sourceEditor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === source.toString());
    if (!sourceEditor) {
      return;
    }
    const preview = this.previewForVisiblePreview(sourceEditor.document, editor.document.uri);
    const mapped = synchronizedPreviewRange(preview.mappings, selectionToRange(editor.document, editor.selection), "preview-to-source");
    this.reveal(sourceEditor, mapped);
  }

  private previewForVisiblePreview(
    sourceDocument: vscode.TextDocument,
    previewUri: vscode.Uri
  ): TxtJetGeneratedPreview {
    return this.previews.getOrCreate(
      sourceDocument.uri.toString(),
      sourceDocument.version,
      previewUri.toString(),
      () => buildPreviewForVisiblePreview(sourceDocument, previewUri)
    );
  }

  private reveal(editor: vscode.TextEditor, range: TxtJetRange | undefined): void {
    if (!range) {
      return;
    }
    this.syncing = true;
    revealMappedPreviewRange(editor, range);
    setTimeout(() => {
      this.syncing = false;
    }, 0);
  }
}

function visiblePreviewEditorForSource(source: vscode.Uri): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((candidate) =>
    isPreviewDocument(candidate.document)
    && sourceUriFromPreview(candidate.document.uri)?.toString() === source.toString()
  );
}

function buildPreviewForVisiblePreview(sourceDocument: vscode.TextDocument, previewUri: vscode.Uri): TxtJetGeneratedPreview {
  if (previewUri.scheme === JAVA_PREVIEW_SCHEME) {
    return buildPreviewForDocument(sourceDocument, "java");
  }
  if (previewUri.scheme === IPXACT_PREVIEW_SCHEME) {
    return buildIpxactPreviewForDocument(sourceDocument);
  }
  return buildPreviewForDocument(sourceDocument, "output");
}

function provenanceContext(
  document: vscode.TextDocument
): { sourceDocument: vscode.TextDocument; preview: TxtJetGeneratedPreview } | undefined {
  const source = isPreviewDocument(document)
    ? sourceUriFromPreview(document.uri)
    : compilerOutputSource(document);
  const sourceDocument = source
    ? vscode.workspace.textDocuments.find((document) => document.uri.toString() === source.toString())
    : undefined;
  if (!sourceDocument) {
    return undefined;
  }
  return {
    sourceDocument,
    preview: isPreviewDocument(document)
      ? buildPreviewForVisiblePreview(sourceDocument, document.uri)
      : buildCompilerOutputProvenance(
        document.getText(),
        buildPreviewForDocument(sourceDocument, "output")
      )
  };
}

function rememberCompilerOutput(output: vscode.Uri, source: vscode.Uri): void {
  compilerOutputSources.delete(output.toString());
  compilerOutputSources.set(output.toString(), source.toString());
  while (compilerOutputSources.size > 32) {
    const oldest = compilerOutputSources.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    compilerOutputSources.delete(oldest);
  }
}

function compilerOutputSource(document: vscode.TextDocument): vscode.Uri | undefined {
  const source = compilerOutputSources.get(document.uri.toString());
  if (!source) {
    return undefined;
  }
  try {
    return vscode.Uri.parse(source);
  } catch {
    return undefined;
  }
}

function isCompilerOutputDocument(document: vscode.TextDocument): boolean {
  return compilerOutputSources.has(document.uri.toString());
}

function provenanceMarkdown(origins: TxtJetProvenance[]): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown("**Generated output provenance**\n\n");
  for (const origin of origins) {
    markdown.appendMarkdown(`- **${provenanceKindLabel(origin.kind)}** · ${provenanceConfidenceLabel(origin.confidence)}`);
    if (origin.label) {
      markdown.appendMarkdown(` — ${escapeMarkdownInline(origin.label)}`);
    }
    if (origin.sourceFileName) {
      markdown.appendMarkdown(`\n  \`${escapeMarkdownInline(workspaceRelativeLabel(origin.sourceFileName))}\``);
    }
    markdown.appendMarkdown("\n");
  }
  if (origins.every((origin) => !origin.sourceFileName || !origin.source)) {
    markdown.appendMarkdown("\nNo deterministic source range is available for this preview segment.");
  } else {
    markdown.appendMarkdown("\nUse **Go to Definition** to open the contributing source.");
  }
  return markdown;
}

function provenanceKindLabel(kind: TxtJetProvenanceKind): string {
  switch (kind) {
    case "root":
      return "Root template";
    case "include":
      return "Included template";
    case "expression":
      return "TxtJet expression";
    case "skeleton":
      return "Skeleton token or layout";
    case "unmapped":
    default:
      return "Unmapped generated/compiler output";
  }
}

function provenanceConfidenceLabel(confidence: TxtJetProvenance["confidence"]): string {
  switch (confidence) {
    case "direct":
      return "direct mapping";
    case "include-expanded":
      return "include-expanded mapping";
    case "skeleton-rendered":
      return "skeleton-rendered mapping";
    case "approximate":
      return "approximate generated text";
    case "unmapped":
    default:
      return "unmapped";
  }
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&");
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
      "txtjet-python": [],
      "txtjet-latex": []
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

function buildIpxactPreviewUri(document: vscode.TextDocument): vscode.Uri {
  return vscode.Uri.from({
    scheme: IPXACT_PREVIEW_SCHEME,
    path: `${document.uri.path}.ipxact.xml`,
    query: `source=${encodeURIComponent(document.uri.toString())}`
  });
}

function sourceUriFromPreview(uri: vscode.Uri): vscode.Uri | undefined {
  const source = queryValue(uri, "source");
  if (!source) {
    return undefined;
  }
  try {
    const parsed = vscode.Uri.parse(source);
    return isTxtJetPath(parsed.path) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
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
    })),
    provenance: [
      {
        preview: { start: 0, end: header.length },
        kind: "unmapped",
        confidence: "unmapped",
        label: "JetForge preview header"
      },
      ...preview.provenance.map((entry) => ({
        ...entry,
        preview: {
          start: entry.preview.start + header.length,
          end: entry.preview.end + header.length
        }
      }))
    ]
  };
}

function buildIpxactPreviewForDocument(document: vscode.TextDocument): TxtJetGeneratedPreview {
  const header = headerComment("output", document.fileName, "txtjet-xml");
  const preview = buildIpxactOutputForDocument(document);
  return {
    text: header + preview.text,
    mappings: preview.mappings.map((mapping) => ({
      ...mapping,
      preview: {
        start: mapping.preview.start + header.length,
        end: mapping.preview.end + header.length
      }
    })),
    provenance: [
      {
        preview: { start: 0, end: header.length },
        kind: "unmapped",
        confidence: "unmapped",
        label: "JetForge preview header"
      },
      ...preview.provenance.map((entry) => ({
        ...entry,
        preview: {
          start: entry.preview.start + header.length,
          end: entry.preview.end + header.length
        }
      }))
    ]
  };
}

function buildIpxactOutputForDocument(document: vscode.TextDocument): TxtJetGeneratedPreview {
  return buildGeneratedOutputPreview(document.getText(), "txtjet-xml", outputPreviewOptions(document));
}

function outputPreviewOptions(document: vscode.TextDocument) {
  return {
    sourceFileName: document.fileName,
    expandIncludes: true,
    includePaths: configuredReferencePaths(document, "resolution.includePaths"),
    readInclude(path: string): string | undefined {
      return readContainedReference(document, path, "resolution.includePaths");
    }
  };
}

function javaPreviewOptions(document: vscode.TextDocument) {
  return {
    sourceFileName: document.fileName,
    skeletonPaths: configuredReferencePaths(document, "resolution.skeletonPaths"),
    readSkeleton(path: string): string | undefined {
      return readContainedReference(document, path, "resolution.skeletonPaths");
    }
  };
}

function readContainedReference(document: vscode.TextDocument, fileName: string, setting: string): string | undefined {
  if (!isPathInsideAnyRoot(fileName, referenceReadRoots(document, setting))) {
    return undefined;
  }
  const openText = openDocumentText(fileName);
  if (openText !== undefined) {
    return openText;
  }
  try {
    return readFileSync(fileName, "utf8");
  } catch {
    return undefined;
  }
}

function referenceReadRoots(document: vscode.TextDocument, setting: string): string[] {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  return uniqueStrings([
    workspaceRoot ?? dirname(document.fileName),
    ...configuredReferencePaths(document, setting)
  ]);
}

function openDocumentText(fileName: string): string | undefined {
  const normalizedFileName = normalize(fileName);
  return vscode.workspace.textDocuments
    .find((document) => normalize(document.fileName) === normalizedFileName)
    ?.getText();
}

function configuredReferencePaths(document: vscode.TextDocument, setting: string): string[] {
  return configuredReferencePathsForFileName(document.fileName, document.uri, setting);
}

function configuredReferencePathsForFileName(fileName: string, uri: vscode.Uri, setting: string): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, uri);
  const paths = config.get<string[]>(setting, []);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const baseRoot = workspaceFolder?.uri.fsPath ?? dirname(fileName);
  const resolvedPaths = paths
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => entry.split("${workspaceFolder}").join(baseRoot))
    .map((entry) => isAbsolutePath(entry) ? normalize(entry) : normalize(join(baseRoot, entry)));
  return vscode.workspace.isTrusted
    ? resolvedPaths
    : resolvedPaths.filter((entry) => isPathInsideAnyRoot(entry, [baseRoot]));
}

function configuredIpxactSchemaIndex(document: vscode.TextDocument): TxtJetIpxactSchemaIndex | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  const configured = config.get<string[]>("ipxact.schemaPaths", []);
  if (configured.length === 0) {
    return undefined;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const baseRoot = workspaceFolder?.uri.fsPath ?? dirname(document.fileName);
  const roots = configured
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => resolveWorkspaceConfiguredPath(entry, baseRoot))
    .filter((entry) => vscode.workspace.isTrusted || isPathInsideAnyRoot(entry, [baseRoot]));
  for (const root of roots) {
    ensureIpxactSchemaWatcher(root);
  }
  const discoveryKey = roots.map((root) => normalize(root)).sort().join("\0");
  let files = ipxactSchemaDiscoveryCache.get(discoveryKey);
  if (!files) {
    const discovered: string[] = [];
    const visited = new Set<string>();
    for (const root of roots) {
      collectIpxactSchemaFiles(root, root, discovered, visited);
      if (discovered.length >= 256) {
        break;
      }
    }
    discovered.sort();
    files = discovered;
    ipxactSchemaDiscoveryCache.set(discoveryKey, files);
  }
  if (files.length === 0) {
    return undefined;
  }
  const sources = files.flatMap((fileName) => {
    const openDocument = vscode.workspace.textDocuments.find((candidate) =>
      normalize(candidate.fileName) === normalize(fileName)
    );
    try {
      return [{
        fileName,
        openDocument,
        version: openDocument ? `open:${openDocument.version}` : fileVersion(fileName)
      }];
    } catch {
      return [];
    }
  });
  if (sources.length === 0) {
    return undefined;
  }
  const key = sources.map((entry) => `${entry.fileName}\0${entry.version}`).join("\n");
  const cached = ipxactSchemaIndexCache.get(key);
  if (cached) {
    return cached;
  }
  const documents = sources.flatMap((source) => {
    try {
      return [{
        fileName: source.fileName,
        text: source.openDocument?.getText() ?? readFileSync(source.fileName, "utf8")
      }];
    } catch {
      return [];
    }
  });
  if (documents.length === 0) {
    return undefined;
  }
  const index = buildIpxactSchemaIndex(documents);
  ipxactSchemaIndexCache.set(key, index);
  while (ipxactSchemaIndexCache.size > 8) {
    const oldest = ipxactSchemaIndexCache.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    ipxactSchemaIndexCache.delete(oldest);
  }
  return index;
}

function ensureIpxactSchemaWatcher(root: string): void {
  const normalized = normalize(root);
  if (ipxactSchemaWatchers.has(normalized)) {
    return;
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(normalized);
  } catch {
    return;
  }
  const pattern = stat.isDirectory()
    ? new vscode.RelativePattern(normalized, "**/*.xsd")
    : new vscode.RelativePattern(dirname(normalized), basename(normalized));
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const invalidate = () => invalidateIpxactSchemaCaches();
  ipxactSchemaWatchers.set(normalized, vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(invalidate),
    watcher.onDidChange(invalidate),
    watcher.onDidDelete(invalidate)
  ));
}

function invalidateIpxactSchemaCaches(): void {
  ipxactSchemaDiscoveryCache.clear();
  ipxactSchemaIndexCache.clear();
}

function collectIpxactSchemaFiles(
  candidate: string,
  root: string,
  files: string[],
  visited: Set<string>
): void {
  const normalized = normalize(candidate);
  if (
    files.length >= 256
    || visited.has(normalized)
    || !isPathInsideAnyRoot(normalized, [root])
  ) {
    return;
  }
  visited.add(normalized);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(normalized);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (normalized.toLowerCase().endsWith(".xsd")) {
      files.push(normalized);
    }
    return;
  }
  if (!stat.isDirectory() || isExcludedTxtJetWorkspacePath(normalized)) {
    return;
  }
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = readdirSync(normalized, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }
    collectIpxactSchemaFiles(join(normalized, entry.name), root, files, visited);
    if (files.length >= 256) {
      return;
    }
  }
}

function fileVersion(fileName: string): string {
  const stat = statSync(fileName);
  return `${stat.mtimeMs}:${stat.size}`;
}

async function buildTxtJetWorkspaceModel(): Promise<TxtJetWorkspaceModel> {
  const files = new Map<string, { fileName: string; text?: string }>();
  const uris = await vscode.workspace.findFiles(TXTJET_WORKSPACE_GLOB, TXTJET_WORKSPACE_EXCLUDE_GLOB);
  for (const uri of uris) {
    try {
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      files.set(uri.fsPath, { fileName: uri.fsPath, text });
    } catch {
      files.set(uri.fsPath, { fileName: uri.fsPath });
    }
  }
  for (const document of vscode.workspace.textDocuments) {
    if (workspaceEntryKind(document.fileName) && !isExcludedTxtJetWorkspacePath(document.fileName)) {
      files.set(document.fileName, { fileName: document.fileName, text: document.getText() });
    }
  }
  return createTxtJetWorkspaceModel(Array.from(files.values()), {
    includePathsForFile(fileName) {
      return configuredReferencePathsForFileName(fileName, vscode.Uri.file(fileName), "resolution.includePaths");
    },
    skeletonPathsForFile(fileName) {
      return configuredReferencePathsForFileName(fileName, vscode.Uri.file(fileName), "resolution.skeletonPaths");
    },
    ipxactOptionsForFile(fileName) {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION, vscode.Uri.file(fileName));
      return {
        enabled: config.get<boolean>("ipxact.enabled", false),
        templateGlobs: config.get<string[]>("ipxact.templateGlobs", [])
      };
    }
  });
}

async function openWorkspaceReference(reference: TxtJetWorkspaceReference): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(reference.sourceFileName));
  const selection = vscodeRangeFor(document, reference.range);
  await vscode.window.showTextDocument(document, { preview: false, selection });
}

async function openIncludingTemplate(item?: TxtJetWorkspaceTreeNode): Promise<void> {
  const fileName = workspaceFileNameFromNode(item) ?? vscode.window.activeTextEditor?.document.fileName;
  if (!fileName) {
    return;
  }

  const model = activeWorkspaceModel ?? await ensureWorkspaceModel();

  const includingTemplates = model.includingTemplates(fileName);
  if (includingTemplates.length === 0) {
    vscode.window.showInformationMessage("TxtJet found no including template for this workspace file.");
    return;
  }

  const selected = includingTemplates.length === 1
    ? includingTemplates[0]
    : await pickWorkspaceEntry(includingTemplates, "Open including TxtJet template");
  if (!selected) {
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(selected.fileName), { preview: false });
}

async function openGeneratedJavaForTemplate(item?: TxtJetWorkspaceTreeNode): Promise<void> {
  await openGeneratedPreviewForTemplate(item, "java");
}

async function openGeneratedOutputForTemplate(item?: TxtJetWorkspaceTreeNode): Promise<void> {
  await openGeneratedPreviewForTemplate(item, "output");
}

async function openGeneratedPreviewForTemplate(
  item: TxtJetWorkspaceTreeNode | undefined,
  kind: PreviewKind
): Promise<void> {
  const fileName = workspaceFileNameFromNode(item) ?? vscode.window.activeTextEditor?.document.fileName;
  if (!fileName) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fileName));
  if (!isTxtJetFile(document)) {
    return;
  }
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  await openMappedPreview(editor, kind, { start: 0, end: 0 }, true);
}

async function validateWorkspaceTemplates(
  collection: vscode.DiagnosticCollection,
  compilerDiagnosticsBySource: Map<string, vscode.Diagnostic[]>,
  ipxactDiagnosticsBySource: Map<string, vscode.Diagnostic[]>,
  validationRuns: ValidationRunCoordinator
): Promise<void> {
  const model = activeWorkspaceModel ?? await ensureWorkspaceModel();
  const templates = model.templates;
  if (templates.length === 0) {
    vscode.window.showInformationMessage("TxtJet found no workspace templates to validate.");
    return;
  }

  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Validating TxtJet workspace templates",
      cancellable: true
    },
    async (progress, token): Promise<CompilerValidationResult[]> => {
      const validationResults: CompilerValidationResult[] = [];
      for (let index = 0; index < templates.length; index += 1) {
        if (token.isCancellationRequested) {
          break;
        }
        const template = templates[index];
        progress.report({
          message: `${index + 1}/${templates.length}: ${workspaceRelativeLabel(template.fileName)}`,
          increment: 100 / templates.length
        });
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(template.fileName));
        validationResults.push(await validateTemplateWithCompiler(
          document,
          collection,
          compilerDiagnosticsBySource,
          false,
          ipxactDiagnosticsBySource,
          validationRuns,
          token
        ));
      }
      return validationResults;
    }
  );
  const summary = summarizeWorkspaceValidation(templates.length, results);
  appendOutputLog("report", formatWorkspaceValidationReport(summary));
  if (summary.cancelled > 0 || summary.remaining > 0) {
    const action = await vscode.window.showInformationMessage(
      `TxtJet workspace validation cancelled after ${summary.processed} of ${summary.total} templates.`,
      "Open TxtJet Output"
    );
    if (action === "Open TxtJet Output") {
      outputChannel.show(true);
    }
    return;
  }
  if (summary.completed === 0) {
    const action = await vscode.window.showWarningMessage(
      "TxtJet did not validate any workspace templates. Configure a compiler and confirm Workspace Trust.",
      "Set Up Compiler",
      "Manage Workspace Trust",
      "Open TxtJet Output"
    );
    if (action === "Set Up Compiler") {
      await vscode.commands.executeCommand("txtjet.setupCompilerToolchain", vscode.Uri.file(templates[0].fileName));
    } else if (action === "Manage Workspace Trust") {
      await vscode.commands.executeCommand("workbench.trust.manage");
    } else if (action === "Open TxtJet Output") {
      outputChannel.show(true);
    }
    return;
  }
  if (summary.failed > 0 || summary.mappedDiagnostics > 0 || summary.unmappedProblems > 0) {
    const action = await vscode.window.showWarningMessage(
      `TxtJet validated ${summary.completed} templates: ${summary.failed} failed, ${summary.mappedDiagnostics} mapped diagnostics, ${summary.unmappedProblems} unmapped problems.`,
      "Show Problems",
      "Open TxtJet Output"
    );
    if (action === "Show Problems") {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
    } else if (action === "Open TxtJet Output") {
      outputChannel.show(true);
    }
    return;
  }
  const skippedSuffix = summary.skipped > 0 ? ` ${summary.skipped} skipped.` : "";
  vscode.window.showInformationMessage(
    `TxtJet validated ${summary.completed} workspace template${summary.completed === 1 ? "" : "s"} successfully.${skippedSuffix}`
  );
}

async function showImpactGraph(item?: TxtJetWorkspaceTreeNode): Promise<void> {
  const model = await ensureWorkspaceModel();
  const fileName = await workspaceFileNameForImpact(model, item);
  if (!fileName) {
    return;
  }

  const impact = model.impactedBy(fileName);
  if (!impact.source) {
    vscode.window.showInformationMessage("TxtJet did not find that file in the workspace model.");
    return;
  }

  const sourceDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(fileName));
  const javaIndex = await javaWorkspaceIndex(sourceDocument);
  const classDependencies = workspaceJavaClassDependencies(javaIndex, fileName, sourceDocument.getText());
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: impactGraphMarkdown(model, fileName, classDependencies)
  });
  try {
    await vscode.commands.executeCommand("markdown.showPreview", document.uri);
  } catch {
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }
}

async function showReferencedJavaClasses(resource?: vscode.Uri): Promise<void> {
  const document = resource
    ? await vscode.workspace.openTextDocument(resource)
    : vscode.window.activeTextEditor?.document;
  if (!document || !isTxtJetFile(document)) {
    return;
  }
  const index = await javaWorkspaceIndex(document);
  const referenced = referencedWorkspaceJavaClasses(index, document.fileName, document.getText());
  if (referenced.length === 0) {
    vscode.window.showInformationMessage("JetForge found no references to other workspace @jet classes in this template.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    referenced.map((entry) => ({
      label: entry.className,
      description: entry.packageName,
      detail: `${workspaceRelativeLabel(entry.fileName)} — ${entry.methods.length} indexed method${entry.methods.length === 1 ? "" : "s"}`,
      entry
    })),
    {
      title: `Referenced workspace classes from ${basename(document.fileName)}`,
      placeHolder: "Select a class to open its TxtJet template"
    }
  );
  if (!picked) {
    return;
  }
  const targetDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.entry.fileName));
  await vscode.window.showTextDocument(targetDocument, {
    preview: false,
    selection: vscodeRangeFor(targetDocument, picked.entry.range)
  });
}

async function extractSelectionToInclude(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document)) {
    return;
  }
  if (editor.selection.isEmpty) {
    vscode.window.showInformationMessage("Select template text before extracting it to a TxtJet include.");
    return;
  }

  const document = editor.document;
  const defaultReference = `partials/${stripTxtJetSuffix(basename(document.fileName))}.jetinc`;
  const referenceFile = await vscode.window.showInputBox({
    title: "Extract selection to TxtJet include",
    prompt: "Include path to create, relative to the current template.",
    value: defaultReference,
    validateInput(value) {
      return validateReferenceInput(value, "include");
    }
  });
  if (!referenceFile) {
    return;
  }

  const includeReference = withRequiredReferenceExtension(referenceFile, "include");
  const targetFileName = resolveReferenceCandidates(document.fileName, includeReference, { searchPaths: [] })[0];
  if (!targetFileName || !isSafeWorkspaceRefactorPath(targetFileName, document.uri)) {
    vscode.window.showErrorMessage("TxtJet can only extract includes inside the current workspace or template directory.");
    return;
  }
  if (existsSync(targetFileName)) {
    vscode.window.showErrorMessage(`TxtJet include already exists: ${workspaceRelativeLabel(targetFileName)}`);
    return;
  }
  if (!await createRefactorParentDirectory(targetFileName)) {
    return;
  }

  const selectionText = document.getText(editor.selection);
  const includeDirective = `<%@ include file="${normalizeReferenceForDirective(includeReference)}" %>`;
  const edit = new vscode.WorkspaceEdit();
  const targetUri = vscode.Uri.file(targetFileName);
  edit.createFile(targetUri, { ignoreIfExists: false });
  edit.insert(targetUri, new vscode.Position(0, 0), selectionText);
  edit.replace(document.uri, editor.selection, includeDirective);

  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage("TxtJet could not apply the extract include refactor.");
    return;
  }
  await vscode.window.showTextDocument(targetUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function renameWorkspaceReference(item?: TxtJetWorkspaceTreeNode): Promise<void> {
  const model = await ensureWorkspaceModel();
  const entry = await workspaceReferenceEntryForRefactor(model, item);
  if (!entry || (entry.kind !== "include" && entry.kind !== "skeleton")) {
    vscode.window.showInformationMessage("Select a TxtJet include or skeleton file to rename or move.");
    return;
  }

  const referenceKind: TxtJetWorkspaceReferenceKind = entry.kind === "skeleton" ? "skeleton" : "include";
  const defaultPath = workspaceRelativeLabel(entry.fileName);
  const input = await vscode.window.showInputBox({
    title: `Rename or move TxtJet ${referenceKind}`,
    prompt: "New path. A bare name stays in the same folder; a path is workspace-relative.",
    value: defaultPath,
    validateInput(value) {
      return validateReferenceInput(value, referenceKind);
    }
  });
  if (!input) {
    return;
  }

  const newFileName = resolveRefactorTargetFileName(entry.fileName, input, referenceKind);
  if (newFileName === entry.fileName) {
    return;
  }
  if (!isSafeWorkspaceRefactorPath(newFileName, vscode.Uri.file(entry.fileName))) {
    vscode.window.showErrorMessage("TxtJet can only rename references inside the current workspace or template directory.");
    return;
  }
  if (existsSync(newFileName)) {
    vscode.window.showErrorMessage(`Target already exists: ${workspaceRelativeLabel(newFileName)}`);
    return;
  }

  const references = model.referencesTo(entry.fileName, referenceKind);
  const referenceEdits: Array<{ document: vscode.TextDocument; range: vscode.Range; newText: string }> = [];
  for (const reference of references) {
    const sourceDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(reference.sourceFileName));
    const valueRange = directiveReferenceValueRange(sourceDocument, reference);
    if (!valueRange) {
      vscode.window.showErrorMessage(
        `TxtJet could not map a ${referenceKind} reference in ${workspaceRelativeLabel(reference.sourceFileName)}. No files were changed.`
      );
      return;
    }
    referenceEdits.push({
      document: sourceDocument,
      range: valueRange,
      newText: relativeReferenceFromSource(reference.sourceFileName, newFileName)
    });
  }
  const action = await vscode.window.showWarningMessage(
    `Rename ${workspaceRelativeLabel(entry.fileName)} and update ${references.length} TxtJet reference${references.length === 1 ? "" : "s"}?`,
    { modal: true },
    "Apply Refactor"
  );
  if (action !== "Apply Refactor") {
    return;
  }
  if (!await createRefactorParentDirectory(newFileName)) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const referenceEdit of referenceEdits) {
    edit.replace(referenceEdit.document.uri, referenceEdit.range, referenceEdit.newText);
  }
  edit.renameFile(vscode.Uri.file(entry.fileName), vscode.Uri.file(newFileName), { overwrite: false, ignoreIfExists: false });

  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage("TxtJet could not apply the reference rename.");
    return;
  }
  vscode.window.showInformationMessage(`TxtJet updated ${references.length} reference${references.length === 1 ? "" : "s"}.`);
}

async function ensureWorkspaceModel(): Promise<TxtJetWorkspaceModel> {
  const requestRefresh = requestWorkspaceModelRefresh;
  if (!requestRefresh) {
    throw new Error("TxtJet workspace refresh is not available before extension activation.");
  }
  const refreshed = await requestRefresh(false, true);
  if (!refreshed || !activeWorkspaceModel) {
    throw new Error("TxtJet could not build the workspace model.");
  }
  return activeWorkspaceModel;
}

async function javaWorkspaceIndex(document: vscode.TextDocument): Promise<TxtJetJavaWorkspaceIndex> {
  if (!activeWorkspaceModel) {
    try {
      await ensureWorkspaceModel();
    } catch {
      // Open documents still provide a useful partial index while workspace discovery is unavailable.
    }
  }
  const openTemplates = vscode.workspace.textDocuments
    .filter((candidate) => workspaceEntryKind(candidate.fileName) === "template")
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  const key = [
    workspaceModelGeneration,
    ...openTemplates.map((candidate) => `${normalize(candidate.fileName)}:${candidate.version}`)
  ].join("|");
  if (javaWorkspaceIndexCache?.key === key) {
    return javaWorkspaceIndexCache.index;
  }

  const sources = new Map<string, { fileName: string; text: string }>();
  for (const entry of activeWorkspaceModel?.templates ?? []) {
    if (entry.text !== undefined) {
      sources.set(normalize(entry.fileName), { fileName: entry.fileName, text: entry.text });
    }
  }
  for (const openDocument of openTemplates) {
    sources.set(normalize(openDocument.fileName), {
      fileName: openDocument.fileName,
      text: openDocument.getText()
    });
  }
  sources.set(normalize(document.fileName), { fileName: document.fileName, text: document.getText() });

  const index = createJavaWorkspaceIndex(Array.from(sources.values()));
  javaWorkspaceIndexCache = { key, index };
  return index;
}

async function workspaceFileNameForImpact(
  model: TxtJetWorkspaceModel,
  item?: TxtJetWorkspaceTreeNode
): Promise<string | undefined> {
  const fileName = workspaceFileNameFromNode(item) ?? vscode.window.activeTextEditor?.document.fileName;
  if (fileName && model.entry(fileName)) {
    return fileName;
  }
  const picked = await pickWorkspaceEntry(model.entries, "Show TxtJet impact graph");
  return picked?.fileName;
}

async function workspaceReferenceEntryForRefactor(
  model: TxtJetWorkspaceModel,
  item?: TxtJetWorkspaceTreeNode
): Promise<TxtJetWorkspaceEntry | undefined> {
  const fileName = workspaceFileNameFromNode(item) ?? activeReferenceTargetFileName(model);
  const entry = fileName ? model.entry(fileName) : undefined;
  if (entry?.kind === "include" || entry?.kind === "skeleton") {
    return entry;
  }
  return pickWorkspaceEntry([...model.includes, ...model.skeletons], "Rename or move TxtJet include/skeleton");
}

function activeReferenceTargetFileName(model: TxtJetWorkspaceModel): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document)) {
    return undefined;
  }
  const reference = referenceDirectiveAtOffset(
    parseTxtJetTemplate(editor.document.getText()),
    editor.document.offsetAt(editor.selection.active)
  );
  if (!reference) {
    return undefined;
  }
  return model.referencesFrom(editor.document.fileName, reference.kind)
    .find((candidate) => candidate.referenceFile === reference.file)
    ?.resolvedFileName;
}

function impactGraphMarkdown(
  model: TxtJetWorkspaceModel,
  fileName: string,
  classDependencies: TxtJetJavaWorkspaceDependency[] = []
): string {
  const impact = model.impactedBy(fileName);
  const sourceLabel = workspaceRelativeLabel(fileName);
  const lines = [
    "# TxtJet Impact Graph",
    "",
    `Source: ${markdownFileLink(fileName, sourceLabel)}`,
    "",
    "## Summary",
    "",
    `- Affected workspace files: ${impact.affectedEntries.length}`,
    `- Affected templates: ${impact.affectedTemplates.length}`,
    `- Generated output targets to recheck: ${impact.generatedTargets.length}`,
    `- Dependency edges: ${impact.references.length}`,
    `- Referenced workspace classes: ${new Set(classDependencies.map((entry) => entry.targetClass.fileName)).size}`,
    `- Java class dependency edges: ${classDependencies.length}`,
    "",
    "## Graph",
    "",
    "```mermaid",
    "flowchart LR",
    ...impactGraphMermaidLines(model, fileName, classDependencies),
    "```",
    "",
    "## Affected Templates",
    "",
    ...markdownList(impact.affectedTemplates.map((entry) => markdownFileLink(entry.fileName))),
    "",
    "## Direct And Transitive Reference Edges",
    "",
    ...markdownList(impact.references.map((reference) =>
      `${reference.resolvedFileName ? markdownFileLink(reference.resolvedFileName) : "Unresolved"} -> ${markdownFileLink(reference.sourceFileName)} (${reference.kind}: \`${reference.referenceFile}\`)`
    )),
    "",
    "## Java Class Dependencies",
    "",
    ...markdownList(classDependencies.map((dependency) =>
      `${markdownFileLink(dependency.sourceClass.fileName, dependency.sourceClass.qualifiedName)} -> ${markdownFileLink(dependency.targetClass.fileName, dependency.targetClass.qualifiedName)}`
    )),
    ""
  ];
  return lines.join("\n");
}

function impactGraphMermaidLines(
  model: TxtJetWorkspaceModel,
  fileName: string,
  classDependencies: TxtJetJavaWorkspaceDependency[] = []
): string[] {
  const impact = model.impactedBy(fileName);
  const fileNames = new Set(impact.affectedEntries.map((entry) => entry.fileName));
  fileNames.add(fileName);
  for (const dependency of classDependencies) {
    fileNames.add(dependency.sourceClass.fileName);
    fileNames.add(dependency.targetClass.fileName);
  }
  const ids = new Map(Array.from(fileNames).sort().map((entryFileName, index) => [entryFileName, `n${index}`]));
  const lines = Array.from(fileNames).sort().map((entryFileName) => {
    const label = markdownEscaped(workspaceRelativeLabel(entryFileName));
    return `  ${ids.get(entryFileName)}["${label}"]`;
  });
  for (const reference of impact.references) {
    if (!reference.resolvedFileName || !ids.has(reference.resolvedFileName) || !ids.has(reference.sourceFileName)) {
      continue;
    }
    lines.push(`  ${ids.get(reference.resolvedFileName)} -->|${reference.kind}| ${ids.get(reference.sourceFileName)}`);
  }
  for (const dependency of classDependencies) {
    lines.push(`  ${ids.get(dependency.sourceClass.fileName)} -->|uses ${markdownEscaped(dependency.targetClass.className)}| ${ids.get(dependency.targetClass.fileName)}`);
  }
  if (lines.length === 1) {
    lines.push(`  ${ids.get(fileName)} --> ${ids.get(fileName)}`);
  }
  return lines;
}

function markdownList(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- None"];
}

function markdownEscaped(value: string): string {
  return value.replace(/["<>]/g, "_");
}

function markdownFileLink(fileName: string, label = workspaceRelativeLabel(fileName)): string {
  const safeLabel = label.replace(/[\[\]\\]/g, "_");
  return `[${safeLabel}](${vscode.Uri.file(fileName).toString()})`;
}

function validateReferenceInput(value: string, kind: TxtJetWorkspaceReferenceKind): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Enter a path.";
  }
  if (isAbsolutePath(trimmed)) {
    return "Enter a relative path.";
  }
  if (/[\0\r\n"']/.test(trimmed)) {
    return "Path cannot contain quotes, line breaks, or null bytes.";
  }
  if (/[\\/]$/.test(trimmed)) {
    return "Enter a file name, not a directory.";
  }
  const required = kind === "skeleton" ? ".skeleton" : ".jetinc";
  const extension = extname(trimmed);
  if (extension && extension !== required) {
    return `TxtJet ${kind} files must use ${required}.`;
  }
  return undefined;
}

function withRequiredReferenceExtension(value: string, kind: TxtJetWorkspaceReferenceKind): string {
  const trimmed = value.trim();
  if (extname(trimmed)) {
    return trimmed;
  }
  return `${trimmed}${kind === "skeleton" ? ".skeleton" : ".jetinc"}`;
}

function normalizeReferenceForDirective(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveRefactorTargetFileName(
  currentFileName: string,
  input: string,
  kind: TxtJetWorkspaceReferenceKind
): string {
  const target = withRequiredReferenceExtension(input, kind);
  if (isAbsolutePath(target)) {
    return target;
  }
  const normalizedTarget = normalizeReferenceForDirective(target);
  if (!normalizedTarget.includes("/")) {
    return join(dirname(currentFileName), normalizedTarget);
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(currentFileName));
  return join(workspaceFolder?.uri.fsPath ?? dirname(currentFileName), normalizedTarget);
}

function isSafeWorkspaceRefactorPath(fileName: string, resource: vscode.Uri): boolean {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(resource)?.uri.fsPath;
  return isPathInsideAnyRoot(fileName, workspaceRoot ? [workspaceRoot] : [dirname(resource.fsPath)]);
}

async function createRefactorParentDirectory(fileName: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(fileName)));
    return true;
  } catch (error) {
    vscode.window.showErrorMessage(`TxtJet could not create the target folder: ${String(error)}`);
    return false;
  }
}

function directiveReferenceValueRange(
  document: vscode.TextDocument,
  reference: TxtJetWorkspaceReference
): vscode.Range | undefined {
  const attributeRange = vscodeRangeFor(document, reference.range);
  const attributeText = document.getText(attributeRange);
  const equalsIndex = attributeText.indexOf("=");
  if (equalsIndex === -1) {
    return undefined;
  }
  for (let index = equalsIndex + 1; index < attributeText.length; index += 1) {
    const quote = attributeText[index];
    if (quote !== "\"" && quote !== "'") {
      continue;
    }
    const start = reference.range.start + index + 1;
    for (let endIndex = index + 1; endIndex < attributeText.length; endIndex += 1) {
      if (attributeText[endIndex] === quote && attributeText[endIndex - 1] !== "\\") {
        return new vscode.Range(document.positionAt(start), document.positionAt(reference.range.start + endIndex));
      }
    }
  }
  return undefined;
}

function relativeReferenceFromSource(sourceFileName: string, targetFileName: string): string {
  return normalizeReferenceForDirective(relative(dirname(sourceFileName), targetFileName));
}

function workspaceFileNameFromNode(item?: TxtJetWorkspaceTreeNode): string | undefined {
  if (!item) {
    return undefined;
  }
  if (item.kind === "entry" || item.kind === "generated") {
    return item.entry.fileName;
  }
  if (item.kind === "reference") {
    return item.reference.sourceFileName;
  }
  return undefined;
}

async function pickWorkspaceEntry(entries: TxtJetWorkspaceEntry[], title: string): Promise<TxtJetWorkspaceEntry | undefined> {
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: basename(entry.fileName),
      description: workspaceRelativeLabel(entry.fileName),
      entry
    })),
    { title }
  );
  return picked?.entry;
}

function workspaceRelativeLabel(fileName: string): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fileName));
  return workspaceFolder ? relative(workspaceFolder.uri.fsPath, fileName) : fileName;
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
  const previousUri = generationPreviousUri(editor.document);
  const previous = context.workspaceState.get<Record<string, string>>(GENERATION_STORAGE_KEY, {})[editor.document.uri.toString()];
  if (!showDiffOnly) {
    const outputUri = generationOutputUri(editor.document, true);
    if (!outputUri || !await writeGeneratedOutput(outputUri, generated, true)) {
      return;
    }
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

async function openIpxactPreview(): Promise<void> {
  const sourceEditor = vscode.window.activeTextEditor;
  if (!sourceEditor || !isTxtJetFile(sourceEditor.document) || !isIpxactDocument(sourceEditor.document)) {
    showIpxactUnavailableMessage(sourceEditor?.document);
    return;
  }

  const preview = buildIpxactPreviewForDocument(sourceEditor.document);
  const mappedPreviewRange = mapSourceRangeToPreview(preview.mappings, selectionToRange(sourceEditor.document, sourceEditor.selection));
  const previewDocument = await vscode.workspace.openTextDocument(buildIpxactPreviewUri(sourceEditor.document));
  const updatedDocument = await vscode.languages.setTextDocumentLanguage(previewDocument, "xml");
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, sourceEditor.document.uri);
  const viewColumn = config.get<boolean>("previews.openBeside", true) ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  const previewEditor = await vscode.window.showTextDocument(updatedDocument, { preview: true, viewColumn });
  revealMappedPreviewRange(previewEditor, mappedPreviewRange);
}

async function generateIpxactOutput(
  context: vscode.ExtensionContext,
  diffProvider: TxtJetGeneratedDiffProvider,
  showDiffOnly: boolean
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document) || !isIpxactDocument(editor.document)) {
    showIpxactUnavailableMessage(editor?.document);
    return;
  }

  const generated = buildIpxactOutputForDocument(editor.document).text;
  const previousUri = generationPreviousUri(editor.document, IPXACT_GENERATION_STORAGE_KEY);
  const previous = context.workspaceState.get<Record<string, string>>(IPXACT_GENERATION_STORAGE_KEY, {})[editor.document.uri.toString()];
  if (!showDiffOnly) {
    const outputUri = ipxactOutputUri(editor.document, true);
    if (!outputUri || !await writeGeneratedOutput(outputUri, generated, true)) {
      return;
    }
    await rememberGeneratedOutput(context, editor.document, generated, IPXACT_GENERATION_STORAGE_KEY);
    diffProvider.refresh(previousUri);
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, editor.document.uri);
    if (config.get<boolean>("ipxact.generation.autoOpen", true)) {
      await vscode.window.showTextDocument(outputUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }
    vscode.window.setStatusBarMessage(`TxtJet generated IP-XACT ${workspaceRelativeLabel(outputUri.fsPath)}`, 5000);
    return;
  }

  if (previous === undefined) {
    vscode.window.showInformationMessage("TxtJet has no previous IP-XACT generated output snapshot for this template yet.");
    return;
  }
  const currentDocument = await vscode.workspace.openTextDocument({ content: generated, language: "xml" });
  await vscode.commands.executeCommand(
    "vscode.diff",
    previousUri,
    currentDocument.uri,
    `TxtJet IP-XACT generated diff: ${basename(editor.document.fileName)}`
  );
}

async function validateIpxactTemplate(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  ipxactDiagnosticsBySource: Map<string, vscode.Diagnostic[]>,
  interactive: boolean,
  compilerDiagnosticsBySource: Map<string, vscode.Diagnostic[]> | undefined,
  validationRuns: ValidationRunCoordinator
): Promise<void> {
  if (!isTxtJetFile(document)) {
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.enabled", true) || !config.get<boolean>("ipxact.enabled", false)) {
    ipxactDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    return;
  }

  if (!isIpxactDocument(document)) {
    ipxactDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    if (interactive) {
      showIpxactUnavailableMessage(document);
    }
    return;
  }

  if (!canRunExternalCommands(interactive)) {
    ipxactDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    return;
  }

  if (document.isDirty) {
    if (!interactive) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "Save the current template before validating IP-XACT output.",
      "Save and Validate",
      "Cancel"
    );
    if (choice !== "Save and Validate") {
      return;
    }
    await document.save();
  }

  const validationCommand = config.get<string>("ipxact.validation.command", "").trim();
  if (validationCommand.length === 0) {
    ipxactDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    if (interactive) {
      vscode.window.showErrorMessage("TxtJet IP-XACT validation command is not configured. Set txtjet.ipxact.validation.command in settings.");
    }
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? dirname(document.fileName);
  const outputUri = ipxactOutputUri(document, interactive);
  if (!outputUri) {
    return;
  }
  const source = document.uri.toString();
  const run = validationRuns.begin(source, document.version);
  const validationOutput = validationOutputUri(outputUri, "ipxact", run.generation);
  const outputPath = validationOutput.fsPath;
  try {
    const generated = buildIpxactOutputForDocument(document);
    if (!await writeGeneratedOutput(validationOutput, generated.text, interactive)) {
      return;
    }
    if (!validationRuns.isCurrent(source, run, document.version, document.isClosed)) {
      return;
    }
    const fullCommand = safeCompilerCommandFor(validationCommand, document.fileName, workspaceFolder, outputPath, interactive);
    if (!fullCommand) {
      return;
    }
    const timeoutMs = compilerTimeoutMs(config.get<number>("ipxact.validation.timeoutMs"));
    const result = await runCompilerCommand(fullCommand, workspaceFolder, timeoutMs, run.signal);
    if (!validationRuns.isCurrent(source, run, document.version, document.isClosed)) {
      return;
    }
    if (result.stdout.trim().length > 0) {
      appendOutputLog("stdout", result.stdout);
    }
    if (result.stderr.trim().length > 0) {
      appendOutputLog("stderr", result.stderr);
    }
    if (result.error.trim().length > 0) {
      appendOutputLog("error", result.error);
    }

    const matcher = config.get<string>("ipxact.validation.problemMatcher", DEFAULT_IPXACT_PROBLEM_MATCHER);
    const problems = parseCompilerProblems([result.stdout, result.stderr].filter(Boolean).join("\n"), matcher);
    const mappedProblems = mapIpxactProblemsToSource(problems, generated, outputPath, workspaceFolder);
    const schema = configuredIpxactSchemaIndex(document);
    const mappedDiagnostics = mappedProblems.map((problem) => ipxactProblemToDiagnostic(document, problem, schema));
    if (mappedDiagnostics.length > 0) {
      ipxactDiagnosticsBySource.set(source, mappedDiagnostics);
    } else {
      ipxactDiagnosticsBySource.delete(source);
    }
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);

    if (!interactive) {
      return;
    }
    if (mappedDiagnostics.length > 0) {
      vscode.window.showWarningMessage(`TxtJet IP-XACT validation found ${mappedDiagnostics.length} mapped diagnostic${mappedDiagnostics.length === 1 ? "" : "s"}.`);
    } else if (problems.length > 0) {
      vscode.window.showWarningMessage("TxtJet IP-XACT validation finished, but no diagnostics could be mapped to this template.");
    } else if (result.failed) {
      vscode.window.showErrorMessage("TxtJet IP-XACT validation failed. Open the TxtJet output channel for details.");
    } else {
      vscode.window.showInformationMessage("TxtJet IP-XACT validation finished without mapped diagnostics.");
    }
  } finally {
    await deleteValidationOutput(validationOutput);
    validationRuns.finish(source, run);
  }
}

async function openIpxactTemplate(): Promise<void> {
  const model = await ensureWorkspaceModel();
  if (model.ipxactTemplates.length === 0) {
    const message = isIpxactFeatureEnabledInAnyWorkspaceContext()
      ? "TxtJet found no IP-XACT templates in this workspace."
      : "Enable txtjet.ipxact.enabled in a workspace folder to use IP-XACT template navigation.";
    vscode.window.showInformationMessage(message);
    return;
  }
  const selected = await pickWorkspaceEntry(model.ipxactTemplates, "Open IP-XACT TxtJet template");
  if (!selected) {
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(selected.fileName), { preview: false });
}

async function setupCompilerToolchain(
  argument?: vscode.Uri | TxtJetWorkspaceTreeNode
): Promise<void> {
  const resource = await compilerSetupResource(argument);
  if (!resource) {
    const action = await vscode.window.showInformationMessage(
      "Open a workspace folder or TxtJet template before setting up an external compiler.",
      "Open Folder",
      "Open Compiler Settings",
      "Getting Started"
    );
    if (action === "Open Folder") {
      await vscode.commands.executeCommand("workbench.action.files.openFolder");
    } else if (action === "Open Compiler Settings") {
      await openCompilerSettings();
    } else if (action === "Getting Started") {
      await vscode.commands.executeCommand("txtjet.openGettingStarted");
    }
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
  let command = config.get<string>("compiler.command", "").trim();
  const action = await vscode.window.showQuickPick(
    command
      ? [
        { label: "$(testing-run-icon) Test configured compiler", id: "test", description: compilerScopeLabel(resource) },
        { label: "$(edit) Edit compiler command", id: "edit", description: "Configure the external command for this workspace context" },
        { label: "$(settings-gear) Open compiler settings", id: "settings" },
        { label: "$(book) Open Getting Started", id: "walkthrough" }
      ]
      : [
        { label: "$(edit) Configure compiler command", id: "edit", description: "JetForge does not bundle a compiler" },
        { label: "$(settings-gear) Open compiler settings", id: "settings" },
        { label: "$(book) Open Getting Started", id: "walkthrough" }
      ],
    {
      title: "Set up TxtJet compiler toolchain",
      placeHolder: command
        ? "Test or update the configured external compiler"
        : "Configure the external compiler used by JetForge"
    }
  );
  if (!action) {
    return;
  }
  if (action.id === "settings") {
    await openCompilerSettings();
    return;
  }
  if (action.id === "walkthrough") {
    await vscode.commands.executeCommand("txtjet.openGettingStarted");
    return;
  }
  if (action.id === "edit") {
    const configured = await configureCompilerCommand(resource, command);
    if (!configured) {
      return;
    }
    command = configured;
    const nextAction = await vscode.window.showInformationMessage(
      `TxtJet compiler command saved for ${compilerScopeLabel(resource)}.`,
      "Test Compiler",
      "Open Settings"
    );
    if (nextAction === "Open Settings") {
      await openCompilerSettings();
      return;
    }
    if (nextAction !== "Test Compiler") {
      return;
    }
  }

  if (!vscode.workspace.isTrusted) {
    const trustAction = await vscode.window.showWarningMessage(
      "TxtJet saved the compiler configuration, but external commands stay disabled in Restricted Mode.",
      "Manage Workspace Trust",
      "Open Compiler Settings"
    );
    if (trustAction === "Manage Workspace Trust") {
      await vscode.commands.executeCommand("workbench.trust.manage");
    } else if (trustAction === "Open Compiler Settings") {
      await openCompilerSettings();
    }
    return;
  }

  const document = await selectCompilerTestTemplate(resource);
  if (!document) {
    const noTemplateAction = await vscode.window.showInformationMessage(
      "TxtJet found no template in this workspace context to use for the compiler test.",
      "Getting Started",
      "Refresh Workspace"
    );
    if (noTemplateAction === "Getting Started") {
      await vscode.commands.executeCommand("txtjet.openGettingStarted");
    } else if (noTemplateAction === "Refresh Workspace") {
      await vscode.commands.executeCommand("txtjet.refreshWorkspaceModel");
    }
    return;
  }
  if (document.isDirty) {
    const saveAction = await vscode.window.showWarningMessage(
      "Save the selected template before testing the external compiler.",
      "Save and Test",
      "Cancel"
    );
    if (saveAction !== "Save and Test" || !await document.save()) {
      return;
    }
  }

  const report = await runCompilerToolchainTest(document, command);
  if (!report) {
    return;
  }
  appendOutputLog("report", formatCompilerToolchainReport(report));
  await showCompilerToolchainResult(document, resource, command, report);
}

async function compilerSetupResource(
  argument?: vscode.Uri | TxtJetWorkspaceTreeNode
): Promise<vscode.Uri | undefined> {
  if (isVscodeUri(argument)) {
    return argument;
  }
  const itemFileName = argument ? workspaceFileNameFromNode(argument) : undefined;
  if (itemFileName) {
    return vscode.Uri.file(itemFileName);
  }
  const activeResource = vscode.window.activeTextEditor?.document.uri;
  if (activeResource?.scheme === "file") {
    return activeResource;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0].uri;
  }
  if (folders.length > 1) {
    const picked = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        uri: folder.uri
      })),
      { title: "Select workspace folder for TxtJet compiler setup" }
    );
    return picked?.uri;
  }
  return undefined;
}

function isVscodeUri(value: vscode.Uri | TxtJetWorkspaceTreeNode | undefined): value is vscode.Uri {
  return Boolean(
    value
    && "scheme" in value
    && "path" in value
    && typeof value.scheme === "string"
    && typeof value.path === "string"
  );
}

async function configureCompilerCommand(resource: vscode.Uri, current: string): Promise<string | undefined> {
  const command = await vscode.window.showInputBox({
    title: `Configure TxtJet compiler for ${compilerScopeLabel(resource)}`,
    prompt: "External shell command. Available placeholders: ${file}, ${workspaceFolder}, and ${outputFile}.",
    value: current,
    ignoreFocusOut: true,
    validateInput(value) {
      return value.trim().length > 0 ? undefined : "Enter an external compiler command.";
    }
  });
  if (!command?.trim()) {
    return undefined;
  }
  const target = vscode.workspace.getWorkspaceFolder(resource)
    ? (vscode.workspace.workspaceFolders?.length ?? 0) > 1
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration(CONFIG_SECTION, resource)
    .update("compiler.command", command.trim(), target);
  const guidance = compilerCommandGuidance(command);
  if (guidance.warnings.length > 0) {
    appendOutputLog("report", ["TxtJet compiler configuration guidance", ...guidance.warnings.map((warning) => `warning: ${warning}`)].join("\n"));
    void vscode.window.showWarningMessage(guidance.warnings.join(" "), "Open TxtJet Output")
      .then((selected) => {
        if (selected === "Open TxtJet Output") {
          outputChannel.show(true);
        }
      });
  }
  return command.trim();
}

function compilerScopeLabel(resource: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  return folder ? `workspace folder “${folder.name}”` : "the current user profile";
}

async function selectCompilerTestTemplate(resource: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const resourceFolder = vscode.workspace.getWorkspaceFolder(resource);
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (
    activeDocument
    && isTxtJetFile(activeDocument)
    && (!resourceFolder || vscode.workspace.getWorkspaceFolder(activeDocument.uri)?.uri.toString() === resourceFolder.uri.toString())
  ) {
    return activeDocument;
  }
  const model = await ensureWorkspaceModel();
  const templates = model.templates.filter((entry) =>
    !resourceFolder
    || vscode.workspace.getWorkspaceFolder(vscode.Uri.file(entry.fileName))?.uri.toString() === resourceFolder.uri.toString()
  );
  const selected = templates.length === 1
    ? templates[0]
    : await pickWorkspaceEntry(templates, "Select template for compiler toolchain test");
  return selected ? vscode.workspace.openTextDocument(vscode.Uri.file(selected.fileName)) : undefined;
}

async function runCompilerToolchainTest(
  document: vscode.TextDocument,
  command: string
): Promise<CompilerToolchainReport | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? dirname(document.fileName);
  const outputUri = generationOutputUri(document, true);
  if (!outputUri) {
    return undefined;
  }
  const testOutput = validationOutputUri(outputUri, "compiler", Date.now());
  if (!await ensureGeneratedOutputDirectory(testOutput, true)) {
    return undefined;
  }
  const fullCommand = safeCompilerCommandFor(command, document.fileName, workspaceFolder, testOutput.fsPath, true);
  if (!fullCommand) {
    return undefined;
  }
  const timeoutMs = compilerTimeoutMs(
    vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri).get<number>("compiler.timeoutMs")
  );
  const startedAt = Date.now();
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Testing TxtJet compiler with ${basename(document.fileName)}`,
        cancellable: true
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
          const result = await runCompilerCommand(fullCommand, workspaceFolder, timeoutMs, controller.signal);
          if (result.stdout.trim()) {
            appendOutputLog("stdout", result.stdout);
          }
          if (result.stderr.trim()) {
            appendOutputLog("stderr", result.stderr);
          }
          if (result.error.trim() && !token.isCancellationRequested) {
            appendOutputLog("error", result.error);
          }
          return {
            status: token.isCancellationRequested ? "cancelled" : result.failed ? "failed" : "success",
            workspaceFolder,
            template: document.fileName,
            durationMs: Date.now() - startedAt,
            outputProduced: existsSync(testOutput.fsPath),
            stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
            stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
            error: token.isCancellationRequested ? undefined : result.error || undefined
          };
        } finally {
          cancellation.dispose();
        }
      }
    );
  } finally {
    await deleteValidationOutput(testOutput);
  }
}

async function showCompilerToolchainResult(
  document: vscode.TextDocument,
  resource: vscode.Uri,
  command: string,
  report: CompilerToolchainReport
): Promise<void> {
  if (report.status === "cancelled") {
    const action = await vscode.window.showInformationMessage("TxtJet compiler toolchain test cancelled.", "Open TxtJet Output");
    if (action === "Open TxtJet Output") {
      outputChannel.show(true);
    }
    return;
  }
  if (report.status === "failed") {
    const action = await vscode.window.showErrorMessage(
      `TxtJet compiler toolchain test failed after ${report.durationMs} ms.`,
      "Open TxtJet Output",
      "Edit Command"
    );
    if (action === "Open TxtJet Output") {
      outputChannel.show(true);
    } else if (action === "Edit Command") {
      await configureCompilerCommand(resource, command);
    }
    return;
  }
  const guidance = compilerCommandGuidance(command);
  const message = guidance.hasOutputFilePlaceholder && !report.outputProduced
    ? "TxtJet compiler ran successfully, but it did not create the configured ${outputFile}."
    : `TxtJet compiler toolchain test succeeded in ${report.durationMs} ms.`;
  const action = await vscode.window.showInformationMessage(message, "Compile Template", "Open TxtJet Output");
  if (action === "Open TxtJet Output") {
    outputChannel.show(true);
  } else if (action === "Compile Template") {
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand("txtjet.compileTemplate");
  }
}

async function openCompilerSettings(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.openSettings", "txtjet.compiler.command");
}

async function showCompilerNotConfigured(resource: vscode.Uri): Promise<void> {
  const action = await vscode.window.showErrorMessage(
    "TxtJet has no external compiler command configured for this workspace context.",
    "Set Up Compiler",
    "Open Compiler Settings"
  );
  if (action === "Set Up Compiler") {
    await vscode.commands.executeCommand("txtjet.setupCompilerToolchain", resource);
  } else if (action === "Open Compiler Settings") {
    await openCompilerSettings();
  }
}

async function compileTemplateWithExternalTool(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTxtJetFile(editor.document)) {
    return;
  }
  if (!canRunExternalCommands(true)) {
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
    await showCompilerNotConfigured(editor.document.uri);
    return;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath ?? dirname(editor.document.fileName);
  const outputUri = generationOutputUri(editor.document, true);
  if (!outputUri || !await ensureGeneratedOutputDirectory(outputUri, true)) {
    return;
  }
  const outputPath = outputUri.fsPath;
  const timeoutMs = compilerTimeoutMs(config.get<number>("compiler.timeoutMs"));
  const fullCommand = safeCompilerCommandFor(compileCommand, editor.document.fileName, workspaceFolder, outputPath, true);
  if (!fullCommand) {
    return;
  }

  try {
    const { stdout, stderr } = await execAsync(fullCommand, { cwd: workspaceFolder, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs });
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
      rememberCompilerOutput(outputUri, editor.document.uri);
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
  interactive: boolean,
  ipxactDiagnosticsBySource: Map<string, vscode.Diagnostic[]> | undefined,
  validationRuns: ValidationRunCoordinator,
  cancellationToken?: vscode.CancellationToken
): Promise<CompilerValidationResult> {
  if (!isTxtJetFile(document)) {
    return skippedCompilerValidation("not-txtjet");
  }
  if (cancellationToken?.isCancellationRequested) {
    return cancelledCompilerValidation();
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.enabled", true) || !config.get<boolean>("diagnostics.compiler.enabled", true)) {
    compilerDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    return skippedCompilerValidation("disabled");
  }

  if (!canRunExternalCommands(interactive)) {
    compilerDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    return skippedCompilerValidation("restricted");
  }

  if (document.isDirty) {
    if (!interactive) {
      return skippedCompilerValidation("dirty");
    }
    const choice = await vscode.window.showWarningMessage(
      "Save the current template before validating it with the external compiler.",
      "Save and Validate",
      "Cancel"
    );
    if (choice !== "Save and Validate") {
      return skippedCompilerValidation("dirty");
    }
    if (!await document.save()) {
      return skippedCompilerValidation("dirty");
    }
  }

  const compileCommand = config.get<string>("compiler.command", "").trim();
  if (compileCommand.length === 0) {
    compilerDiagnosticsBySource.delete(document.uri.toString());
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);
    if (interactive) {
      await showCompilerNotConfigured(document.uri);
    }
    return skippedCompilerValidation("unconfigured");
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? dirname(document.fileName);
  const outputUri = generationOutputUri(document, interactive);
  if (!outputUri) {
    return skippedCompilerValidation("unsafe-output");
  }
  const source = document.uri.toString();
  const sourceText = document.getText();
  const preview = buildGeneratedJavaPreview(sourceText, document.fileName, javaPreviewOptions(document));
  const outputPreview = buildGeneratedOutputPreview(
    sourceText,
    selectedTargetLanguage(document),
    outputPreviewOptions(document)
  );
  const run = validationRuns.begin(source, document.version);
  const cancellation = cancellationToken?.onCancellationRequested(() => validationRuns.invalidate(source));
  const validationOutput = validationOutputUri(outputUri, "compiler", run.generation);
  const outputPath = validationOutput.fsPath;
  try {
    if (!await ensureGeneratedOutputDirectory(validationOutput, interactive)) {
      return skippedCompilerValidation("output-directory");
    }
    if (!validationRuns.isCurrent(source, run, document.version, document.isClosed)) {
      return cancellationToken?.isCancellationRequested
        ? cancelledCompilerValidation()
        : skippedCompilerValidation("superseded");
    }
    const fullCommand = safeCompilerCommandFor(compileCommand, document.fileName, workspaceFolder, outputPath, interactive);
    if (!fullCommand) {
      return skippedCompilerValidation("unsafe-command");
    }
    const timeoutMs = compilerTimeoutMs(config.get<number>("compiler.timeoutMs"));
    const result = await runCompilerCommand(fullCommand, workspaceFolder, timeoutMs, run.signal);
    if (!validationRuns.isCurrent(source, run, document.version, document.isClosed)) {
      return cancellationToken?.isCancellationRequested
        ? cancelledCompilerValidation()
        : skippedCompilerValidation("superseded");
    }
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
    const mappedProblems = mapCompilerProblemsToSource(
      problems,
      document.fileName,
      sourceText,
      preview,
      outputPreview,
      outputPath,
      workspaceFolder
    );
    const mappedDiagnostics = mappedProblems.map((problem) => compilerProblemToDiagnostic(document, problem.message, problem.severity, problem.sourceRange));

    if (mappedDiagnostics.length > 0) {
      compilerDiagnosticsBySource.set(source, mappedDiagnostics);
    } else {
      compilerDiagnosticsBySource.delete(source);
    }
    updateDiagnostics(collection, document, compilerDiagnosticsBySource, ipxactDiagnosticsBySource);

    const validationResult: CompilerValidationResult = {
      outcome: "completed",
      failed: result.failed,
      mappedDiagnostics: mappedDiagnostics.length,
      compilerProblems: problems.length
    };
    if (!interactive) {
      return validationResult;
    }
    if (mappedDiagnostics.length > 0) {
      const action = await vscode.window.showWarningMessage(
        `TxtJet compiler validation found ${mappedDiagnostics.length} mapped diagnostic${mappedDiagnostics.length === 1 ? "" : "s"}.`,
        "Show Problems"
      );
      if (action === "Show Problems") {
        await vscode.commands.executeCommand("workbench.actions.view.problems");
      }
    } else if (problems.length > 0) {
      const action = await vscode.window.showWarningMessage(
        "TxtJet compiler validation finished, but no compiler diagnostics could be mapped to this template.",
        "Open TxtJet Output"
      );
      if (action === "Open TxtJet Output") {
        outputChannel.show(true);
      }
    } else if (result.failed) {
      const action = await vscode.window.showErrorMessage(
        "TxtJet compiler validation failed.",
        "Open TxtJet Output",
        "Set Up Compiler"
      );
      if (action === "Open TxtJet Output") {
        outputChannel.show(true);
      } else if (action === "Set Up Compiler") {
        await vscode.commands.executeCommand("txtjet.setupCompilerToolchain", document.uri);
      }
    } else {
      vscode.window.showInformationMessage("TxtJet compiler validation finished without mapped diagnostics.");
    }
    return validationResult;
  } finally {
    cancellation?.dispose();
    await deleteValidationOutput(validationOutput);
    validationRuns.finish(source, run);
  }
}

function skippedCompilerValidation(reason: string): CompilerValidationResult {
  return {
    outcome: "skipped",
    failed: false,
    mappedDiagnostics: 0,
    compilerProblems: 0,
    reason
  };
}

function cancelledCompilerValidation(): CompilerValidationResult {
  return {
    outcome: "cancelled",
    failed: false,
    mappedDiagnostics: 0,
    compilerProblems: 0,
    reason: "cancelled"
  };
}

function canRunExternalCommands(interactive: boolean): boolean {
  if (vscode.workspace.isTrusted) {
    return true;
  }
  if (interactive) {
    void vscode.window.showErrorMessage(
      "TxtJet external compiler and validator commands are disabled in Restricted Mode.",
      "Manage Workspace Trust"
    ).then((action) => {
      if (action === "Manage Workspace Trust") {
        void vscode.commands.executeCommand("workbench.trust.manage");
      }
    });
  }
  return false;
}

async function runCompilerCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; error: string; failed: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, signal });
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

function safeCompilerCommandFor(
  command: string,
  fileName: string,
  workspaceFolder: string,
  outputPath: string,
  interactive: boolean
): string | undefined {
  try {
    return compilerCommandFor(command, fileName, workspaceFolder, outputPath);
  } catch (error) {
    const message = `TxtJet could not safely quote the external command path: ${String(error)}`;
    appendOutputLog("error", message);
    if (interactive) {
      vscode.window.showErrorMessage(message);
    }
    return undefined;
  }
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

function ipxactProblemToDiagnostic(
  document: vscode.TextDocument,
  problem: TxtJetMappedIpxactProblem,
  schema: TxtJetIpxactSchemaIndex | undefined
): vscode.Diagnostic {
  const message = problem.explanation
    ? `${problem.explanation.summary} ${problem.explanation.guidance}\n\nValidator: ${problem.message}`
    : problem.message;
  const diagnostic = new vscode.Diagnostic(
    vscodeRangeFor(document, problem.sourceRange),
    `IP-XACT: ${message}`,
    compilerDiagnosticSeverity(problem.severity)
  );
  diagnostic.source = `${DIAGNOSTIC_SOURCE}.ipxact`;
  diagnostic.code = "ipxact";
  const relatedNames = uniqueStrings([
    problem.explanation?.elementName ?? "",
    ...(problem.explanation?.expectedElements ?? [])
  ].filter(Boolean));
  const related = schema
    ? relatedNames.flatMap((name) =>
      schemaElementsNamed(schema, name)
        .slice(0, 1)
        .map((element) => schemaLocation(element.location))
        .filter((location): location is vscode.Location => Boolean(location))
        .map((location) => new vscode.DiagnosticRelatedInformation(
          location,
          `IP-XACT schema declaration for <${name}>`
        ))
    )
    : [];
  if (related.length > 0) {
    diagnostic.relatedInformation = related;
  }
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

function appendOutputLog(stream: "stdout" | "stderr" | "error" | "report", content: string): void {
  outputChannel.appendLine(`[${new Date().toISOString()}] ${stream}`);
  outputChannel.appendLine(content.trimEnd());
}

function shellEscape(value: string): string {
  return shellArgumentQuote(value);
}

function generationOutputUri(document: vscode.TextDocument, interactive: boolean): vscode.Uri | undefined {
  const extension = targetOutputExtension(selectedTargetLanguage(document));
  return configuredGeneratedOutputUri(
    document,
    "generation.outputDirectory",
    "${workspaceFolder}/generated",
    extension,
    interactive
  );
}

function ipxactOutputUri(document: vscode.TextDocument, interactive: boolean): vscode.Uri | undefined {
  return configuredGeneratedOutputUri(
    document,
    "ipxact.outputDirectory",
    "${workspaceFolder}/generated-ipxact",
    "xml",
    interactive
  );
}

function configuredGeneratedOutputUri(
  document: vscode.TextDocument,
  setting: string,
  fallback: string,
  extension: string,
  interactive: boolean
): vscode.Uri | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const sourceRoot = workspaceFolder?.uri.fsPath ?? dirname(document.fileName);
  const configuredRoot = config.get<string>(setting, fallback).trim() || fallback;
  const outputRoot = resolveWorkspaceConfiguredPath(configuredRoot, sourceRoot);
  if (!vscode.workspace.isTrusted && !isPathInsideAnyRoot(outputRoot, [sourceRoot])) {
    reportUnsafeOutputPath(
      interactive,
      `TxtJet blocked ${setting} outside the workspace in Restricted Mode. Choose a workspace-local directory or trust the workspace.`
    );
    return undefined;
  }
  const outputPath = generatedOutputPath(document.fileName, sourceRoot, outputRoot, extension);
  if (!outputPath) {
    reportUnsafeOutputPath(interactive, `TxtJet blocked an unsafe generated output path from ${setting}.`);
    return undefined;
  }
  return vscode.Uri.file(outputPath);
}

function reportUnsafeOutputPath(interactive: boolean, message: string): void {
  appendOutputLog("error", message);
  if (interactive) {
    vscode.window.showErrorMessage(message);
  }
}

function validationOutputUri(outputUri: vscode.Uri, kind: "compiler" | "ipxact", generation: number): vscode.Uri {
  return vscode.Uri.file(isolatedValidationOutputPath(outputUri.fsPath, kind, process.pid, generation));
}

async function deleteValidationOutput(outputUri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(outputUri, { recursive: false, useTrash: false });
  } catch {
    // The external tool may have failed before creating its isolated validation output.
  }
}

async function ensureGeneratedOutputDirectory(outputUri: vscode.Uri, interactive: boolean): Promise<boolean> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(outputUri.fsPath)));
    return true;
  } catch (error) {
    const message = `TxtJet could not create the generated output directory: ${String(error)}`;
    appendOutputLog("error", message);
    if (interactive) {
      vscode.window.showErrorMessage(message);
    }
    return false;
  }
}

async function writeGeneratedOutput(outputUri: vscode.Uri, content: string, interactive: boolean): Promise<boolean> {
  if (!await ensureGeneratedOutputDirectory(outputUri, interactive)) {
    return false;
  }
  try {
    await vscode.workspace.fs.writeFile(outputUri, Buffer.from(content, "utf8"));
    return true;
  } catch (error) {
    const message = `TxtJet could not write generated output: ${String(error)}`;
    appendOutputLog("error", message);
    if (interactive) {
      vscode.window.showErrorMessage(message);
    }
    return false;
  }
}

function isIpxactFeatureEnabled(document?: vscode.TextDocument): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION, document?.uri).get<boolean>("ipxact.enabled", false);
}

function isIpxactFeatureEnabledInAnyWorkspaceContext(): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.some((folder) =>
    vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri).get<boolean>("ipxact.enabled", false)
  )) {
    return true;
  }
  const activeDocument = vscode.window.activeTextEditor?.document;
  return Boolean(activeDocument && isIpxactFeatureEnabled(activeDocument));
}

function isIpxactDocument(document: vscode.TextDocument): boolean {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  return isIpxactTemplate(document.fileName, document.getText(), {
    enabled: config.get<boolean>("ipxact.enabled", false),
    templateGlobs: config.get<string[]>("ipxact.templateGlobs", [])
  });
}

function showIpxactUnavailableMessage(document?: vscode.TextDocument): void {
  if (!document || !isIpxactFeatureEnabled(document)) {
    vscode.window.showInformationMessage("Enable txtjet.ipxact.enabled to use IP-XACT commands.");
    return;
  }
  vscode.window.showInformationMessage("This TxtJet template is not matched as IP-XACT. Add @jet ipxact=\"true\" or update txtjet.ipxact.templateGlobs.");
}

async function setSynchronizedRevealEnabled(document: vscode.TextDocument | undefined, enabled: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document?.uri);
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update("previews.synchronizedReveal.enabled", enabled, target);
}

async function togglePreviewSynchronization(): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document?.uri);
  const nextEnabled = !config.get<boolean>("previews.synchronizedReveal.enabled", false);
  await setSynchronizedRevealEnabled(document, nextEnabled);
  vscode.window.setStatusBarMessage(`TxtJet preview synchronization ${nextEnabled ? "enabled" : "disabled"}.`, 4000);
}

function configuredDirectiveMetadata(document: vscode.TextDocument): Record<string, string[]> {
  const configured = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri)
    .get<Record<string, string[]>>("completions.directiveMetadata", {});
  const result: Record<string, string[]> = {};
  for (const [directive, attributes] of Object.entries(configured)) {
    if (!Array.isArray(attributes)) {
      continue;
    }
    const valid = attributes.filter((attribute) => /^[A-Za-z_][\w.-]*$/.test(attribute));
    if (valid.length > 0) {
      result[directive] = valid;
    }
  }
  return result;
}

function generationPreviousUri(document: vscode.TextDocument, storageKey = GENERATION_STORAGE_KEY): vscode.Uri {
  return vscode.Uri.from({
    scheme: GENERATED_DIFF_SCHEME,
    path: `${document.uri.path}.previous`,
    query: `source=${encodeURIComponent(document.uri.toString())}&storage=${encodeURIComponent(storageKey)}`
  });
}

async function rememberGeneratedOutput(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  generated: string,
  storageKey = GENERATION_STORAGE_KEY
): Promise<void> {
  const snapshots = context.workspaceState.get<Record<string, string>>(storageKey, {});
  const source = document.uri.toString();
  const remaining = Object.entries(snapshots).filter(([key]) => key !== source);
  if (Buffer.byteLength(generated, "utf8") > MAX_GENERATED_SNAPSHOT_BYTES) {
    await context.workspaceState.update(storageKey, Object.fromEntries(remaining));
    vscode.window.showWarningMessage(
      "TxtJet generated the output, but did not retain a diff snapshot because it exceeds the 1 MB local snapshot limit."
    );
    return;
  }
  const retained = [...remaining, [source, generated] as const].slice(-MAX_GENERATED_SNAPSHOT_COUNT);
  await context.workspaceState.update(storageKey, Object.fromEntries(retained));
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
  const preview = previewEditor.document.uri.scheme === IPXACT_PREVIEW_SCHEME
    ? buildIpxactPreviewForDocument(sourceDocument)
    : buildPreviewForDocument(sourceDocument, kind);
  const mappedRange = mapPreviewRangeToSource(preview.mappings, selectionToRange(previewEditor.document, previewEditor.selection));
  const sourceEditor = await vscode.window.showTextDocument(sourceDocument, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  revealMappedPreviewRange(sourceEditor, mappedRange);
}

function isPreviewDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === OUTPUT_PREVIEW_SCHEME
    || document.uri.scheme === JAVA_PREVIEW_SCHEME
    || document.uri.scheme === IPXACT_PREVIEW_SCHEME;
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
  compilerDiagnosticsBySource?: Map<string, vscode.Diagnostic[]>,
  ipxactDiagnosticsBySource?: Map<string, vscode.Diagnostic[]>
): void {
  if (!isTxtJetFile(document)) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
    ipxactDiagnosticsBySource?.delete(document.uri.toString());
    collection.delete(document.uri);
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, document.uri);
  if (!config.get<boolean>("diagnostics.enabled", true)) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
    ipxactDiagnosticsBySource?.delete(document.uri.toString());
    collection.delete(document.uri);
    return;
  }

  const maxFileSizeKb = config.get<number>("diagnostics.maxFileSizeKb", DEFAULT_MAX_DIAGNOSTIC_FILE_SIZE_KB);
  if (maxFileSizeKb > 0 && Buffer.byteLength(document.getText(), "utf8") > maxFileSizeKb * 1024) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
    ipxactDiagnosticsBySource?.delete(document.uri.toString());
    collection.delete(document.uri);
    return;
  }

  const severity = diagnosticSeverityFromSetting(config.get<string>("diagnostics.severity", "warning"));
  const text = document.getText();
  const diagnostics = [
    ...scanTxtJetIssues(text),
    ...scanTxtJetDirectiveIssues(text, {
      includeExists: (includeFile) => workspaceReferenceExists(document, includeFile, "include"),
      skeletonExists: (skeletonFile) => workspaceReferenceExists(document, skeletonFile, "skeleton"),
      directiveAttributes: configuredDirectiveMetadata(document)
    })
  ].map((issue) => issueToDiagnostic(document, issue, severity));
  const compilerDiagnostics = config.get<boolean>("diagnostics.compiler.enabled", true)
    ? compilerDiagnosticsBySource?.get(document.uri.toString()) ?? []
    : [];
  if (!config.get<boolean>("diagnostics.compiler.enabled", true)) {
    compilerDiagnosticsBySource?.delete(document.uri.toString());
  }
  const ipxactDiagnostics = config.get<boolean>("ipxact.enabled", false)
    ? ipxactDiagnosticsBySource?.get(document.uri.toString()) ?? []
    : [];
  if (!config.get<boolean>("ipxact.enabled", false)) {
    ipxactDiagnosticsBySource?.delete(document.uri.toString());
  }
  collection.set(document.uri, diagnostics.concat(compilerDiagnostics, ipxactDiagnostics, mappedGeneratedJavaDiagnostics(document)));
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

function registerCodeLensProvider(): vscode.Disposable {
  return vscode.languages.registerCodeLensProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      async provideCodeLenses(document) {
        if (!javaBridgeEnabled(document)) {
          return [];
        }
        const index = await javaWorkspaceIndex(document);
        const sourceClass = index.classForFile(document.fileName);
        if (!sourceClass) {
          return [];
        }
        const referenced = referencedWorkspaceJavaClasses(index, document.fileName, document.getText());
        const count = referenced.length;
        const title = count === 0
          ? "JetForge: no referenced workspace classes"
          : `JetForge: ${count} referenced workspace class${count === 1 ? "" : "es"}`;
        const lens = new vscode.CodeLens(vscodeRangeFor(document, sourceClass.range), {
          title,
          tooltip: count > 0
            ? referenced.map((entry) => entry.qualifiedName).join(", ")
            : "No other @jet classes are referenced from this template's Java blocks.",
          command: "txtjet.showReferencedJavaClasses",
          arguments: [document.uri]
        });
        return [lens];
      }
    }
  );
}

function registerDefinitionProvider(): vscode.Disposable {
  return vscode.languages.registerDefinitionProvider(
    Array.from(TXTJET_LANGUAGES).map((language) => ({ language })),
    {
      async provideDefinition(document, position) {
        const schemaDefinitions = ipxactSchemaDefinitionLocations(document, position);
        if (schemaDefinitions.length > 0) {
          return schemaDefinitions;
        }
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
  const workspaceDefinitions = await workspaceJavaDefinitionLocations(document, position);
  if (workspaceDefinitions.length > 0) {
    return workspaceDefinitions;
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
          const schemaHover = ipxactSchemaHover(document, position);
          const javaHover = javaBridgeEnabled(document)
            ? await workspaceJavaHover(document, position)
              ?? await javaBridgeHover(document, position)
              ?? localJavaHover(document, position)
            : undefined;
          return schemaHover ?? javaHover ?? regionHover(document, text, offset);
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

function ipxactSchemaDefinitionLocations(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Location[] {
  if (!isIpxactGeneratedOutputPosition(document, position)) {
    return [];
  }
  const schema = configuredIpxactSchemaIndex(document);
  const name = schema ? ipxactXmlNameAt(document.getText(), document.offsetAt(position)) : undefined;
  if (!schema || !name) {
    return [];
  }
  if (name.kind === "element") {
    return schemaElementsNamed(schema, name.name)
      .map((element) => schemaLocation(element.location))
      .filter((location): location is vscode.Location => Boolean(location));
  }
  return schemaAttributesFor(schema, name.element)
    .filter((attribute) => attribute.name === name.name)
    .map((attribute) => schemaLocation(attribute.location))
    .filter((location): location is vscode.Location => Boolean(location));
}

function ipxactSchemaHover(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Hover | undefined {
  if (!isIpxactGeneratedOutputPosition(document, position)) {
    return undefined;
  }
  const schema = configuredIpxactSchemaIndex(document);
  const name = schema ? ipxactXmlNameAt(document.getText(), document.offsetAt(position)) : undefined;
  if (!schema || !name) {
    return undefined;
  }
  const definition = name.kind === "element"
    ? schemaElementsNamed(schema, name.name)[0]
    : schemaAttributesFor(schema, name.element).find((attribute) => attribute.name === name.name);
  if (!definition) {
    return undefined;
  }
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**IP-XACT schema ${name.kind}** \`${escapeMarkdownInline(name.name)}\`\n\n`);
  if (definition.documentation) {
    markdown.appendMarkdown(`${definition.documentation}\n\n`);
  }
  if ("children" in definition && definition.children.length > 0) {
    markdown.appendMarkdown(`Permitted children: ${definition.children.map((child) => `\`<${escapeMarkdownInline(child)}>\``).join(", ")}\n\n`);
  }
  if ("required" in definition) {
    markdown.appendMarkdown(definition.required ? "Required attribute.\n\n" : "Optional attribute.\n\n");
  }
  markdown.appendMarkdown(`Defined in \`${escapeMarkdownInline(workspaceRelativeLabel(definition.location.fileName))}\`.`);
  return new vscode.Hover(
    markdown,
    new vscode.Range(document.positionAt(name.range.start), document.positionAt(name.range.end))
  );
}

function schemaLocation(location: { fileName: string; range: TxtJetRange }): vscode.Location | undefined {
  let text = openDocumentText(location.fileName);
  if (text === undefined) {
    try {
      text = readFileSync(location.fileName, "utf8");
    } catch {
      return undefined;
    }
  }
  return new vscode.Location(
    vscode.Uri.file(location.fileName),
    new vscode.Range(positionAtSourceOffset(text, location.range.start), positionAtSourceOffset(text, location.range.end))
  );
}

function registerPreviewProvenanceProviders(): vscode.Disposable {
  const selector: vscode.DocumentSelector = [
    { scheme: OUTPUT_PREVIEW_SCHEME },
    { scheme: JAVA_PREVIEW_SCHEME },
    { scheme: IPXACT_PREVIEW_SCHEME },
    { scheme: "file" }
  ];
  return vscode.Disposable.from(
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const context = provenanceContext(document);
        if (!context) {
          return undefined;
        }
        const origins = provenanceAtPreviewOffset(context.preview, document.offsetAt(position));
        return origins.length > 0 ? new vscode.Hover(provenanceMarkdown(origins)) : undefined;
      }
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(document, position) {
        const context = provenanceContext(document);
        if (!context) {
          return undefined;
        }
        return provenanceAtPreviewOffset(context.preview, document.offsetAt(position))
          .map(provenanceLocation)
          .filter((location): location is vscode.Location => Boolean(location));
      }
    })
  );
}

function registerIpxactPreviewSchemaProviders(): vscode.Disposable {
  const selector: vscode.DocumentSelector = [{ scheme: IPXACT_PREVIEW_SCHEME, language: "xml" }];
  return vscode.Disposable.from(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        return ipxactGeneratedStructures(document.getText())
          .map((structure) => ipxactStructureSymbol(document, structure));
      }
    }),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const sourceDocument = sourceDocumentForPreview(document);
        const schema = sourceDocument ? configuredIpxactSchemaIndex(sourceDocument) : undefined;
        const name = schema ? ipxactXmlNameAt(document.getText(), document.offsetAt(position)) : undefined;
        if (!sourceDocument || !schema || !name) {
          return undefined;
        }
        return ipxactSchemaHoverForName(document, name, schema);
      }
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(document, position) {
        const sourceDocument = sourceDocumentForPreview(document);
        const schema = sourceDocument ? configuredIpxactSchemaIndex(sourceDocument) : undefined;
        const name = schema ? ipxactXmlNameAt(document.getText(), document.offsetAt(position)) : undefined;
        if (!schema || !name) {
          return undefined;
        }
        return name.kind === "element"
          ? schemaElementsNamed(schema, name.name)
            .map((element) => schemaLocation(element.location))
            .filter((location): location is vscode.Location => Boolean(location))
          : schemaAttributesFor(schema, name.element)
            .filter((attribute) => attribute.name === name.name)
            .map((attribute) => schemaLocation(attribute.location))
            .filter((location): location is vscode.Location => Boolean(location));
      }
    })
  );
}

function ipxactStructureSymbol(
  document: vscode.TextDocument,
  structure: TxtJetIpxactStructure
): vscode.DocumentSymbol {
  const label = structure.name
    ? `${ipxactStructureKindLabel(structure.kind)}: ${structure.name}`
    : ipxactStructureKindLabel(structure.kind);
  const symbol = new vscode.DocumentSymbol(
    label,
    `IP-XACT ${structure.kind}`,
    ipxactStructureSymbolKind(structure.kind),
    new vscode.Range(document.positionAt(structure.range.start), document.positionAt(structure.range.end)),
    new vscode.Range(document.positionAt(structure.selectionRange.start), document.positionAt(structure.selectionRange.end))
  );
  symbol.children = structure.children.map((child) => ipxactStructureSymbol(document, child));
  return symbol;
}

function ipxactStructureKindLabel(kind: TxtJetIpxactStructure["kind"]): string {
  switch (kind) {
    case "busInterface":
      return "Bus interface";
    case "memoryMap":
      return "Memory map";
    case "addressBlock":
      return "Address block";
    case "register":
      return "Register";
    case "field":
      return "Field";
    case "component":
    default:
      return "Component";
  }
}

function ipxactStructureSymbolKind(kind: TxtJetIpxactStructure["kind"]): vscode.SymbolKind {
  switch (kind) {
    case "component":
      return vscode.SymbolKind.Module;
    case "busInterface":
      return vscode.SymbolKind.Interface;
    case "memoryMap":
      return vscode.SymbolKind.Namespace;
    case "addressBlock":
      return vscode.SymbolKind.Object;
    case "register":
      return vscode.SymbolKind.Struct;
    case "field":
    default:
      return vscode.SymbolKind.Field;
  }
}

function sourceDocumentForPreview(document: vscode.TextDocument): vscode.TextDocument | undefined {
  const source = sourceUriFromPreview(document.uri);
  return source
    ? vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === source.toString())
    : undefined;
}

function ipxactSchemaHoverForName(
  document: vscode.TextDocument,
  name: NonNullable<ReturnType<typeof ipxactXmlNameAt>>,
  schema: TxtJetIpxactSchemaIndex
): vscode.Hover | undefined {
  const definition = name.kind === "element"
    ? schemaElementsNamed(schema, name.name)[0]
    : schemaAttributesFor(schema, name.element).find((attribute) => attribute.name === name.name);
  if (!definition) {
    return undefined;
  }
  const markdown = schemaDocumentation(definition.documentation, definition.location.fileName);
  return new vscode.Hover(
    markdown,
    new vscode.Range(document.positionAt(name.range.start), document.positionAt(name.range.end))
  );
}

function provenanceLocation(origin: TxtJetProvenance): vscode.Location | undefined {
  if (!origin.sourceFileName || !origin.source) {
    return undefined;
  }
  const uri = vscode.Uri.file(origin.sourceFileName);
  const openDocument = vscode.workspace.textDocuments.find((document) =>
    document.uri.toString() === uri.toString()
  );
  const source = origin.source;
  if (openDocument) {
    return new vscode.Location(
      uri,
      new vscode.Range(openDocument.positionAt(source.start), openDocument.positionAt(source.end))
    );
  }
  if (!existsSync(origin.sourceFileName)) {
    return undefined;
  }
  const text = readFileSync(origin.sourceFileName, "utf8");
  return new vscode.Location(
    uri,
    new vscode.Range(positionAtSourceOffset(text, source.start), positionAtSourceOffset(text, source.end))
  );
}

async function showPreviewLineSource(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const context = editor ? provenanceContext(editor.document) : undefined;
  if (!editor || !context) {
    vscode.window.showInformationMessage("Open a TxtJet generated preview or compiler output and place the cursor on an output line first.");
    return;
  }
  const origins = provenanceAtPreviewOffset(context.preview, editor.document.offsetAt(editor.selection.active));
  const origin = primaryProvenance(origins.filter((entry) => entry.sourceFileName && entry.source));
  const location = origin ? provenanceLocation(origin) : undefined;
  if (!location) {
    vscode.window.showInformationMessage("This preview line has no deterministic source range.");
    return;
  }
  await showProvenanceLocation(location);
}

async function showPreviewLineContributions(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const context = editor ? provenanceContext(editor.document) : undefined;
  if (!editor || !context) {
    vscode.window.showInformationMessage("Open a TxtJet generated preview or compiler output and place the cursor on an output line first.");
    return;
  }
  const origins = provenanceAtPreviewOffset(context.preview, editor.document.offsetAt(editor.selection.active));
  if (origins.length === 0) {
    vscode.window.showInformationMessage("This preview line has no recorded contributions.");
    return;
  }
  const selected = await vscode.window.showQuickPick(
    origins.map((origin, index) => ({
      label: `$(${origin.kind === "unmapped" ? "question" : "symbol-file"}) ${provenanceKindLabel(origin.kind)}`,
      description: provenanceConfidenceLabel(origin.confidence),
      detail: [
        origin.sourceFileName ? workspaceRelativeLabel(origin.sourceFileName) : "No source file",
        origin.label
      ].filter(Boolean).join(" · "),
      origin,
      index
    })),
    {
      title: "Generated preview line contributions",
      placeHolder: "Select a deterministic contribution to open its source"
    }
  );
  if (!selected) {
    return;
  }
  const location = provenanceLocation(selected.origin);
  if (!selected.origin.source || !location) {
    vscode.window.showInformationMessage("The selected contribution has no deterministic source range.");
    return;
  }
  await showProvenanceLocation(location);
}

async function showProvenanceLocation(location: vscode.Location): Promise<void> {
  const document = await vscode.workspace.openTextDocument(location.uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.ViewColumn.Beside
  });
  editor.selection = new vscode.Selection(location.range.start, location.range.end);
  editor.revealRange(location.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
      async provideSignatureHelp(document, position) {
        if (!javaBridgeEnabled(document)) {
          return undefined;
        }
        const signatureHelp = await workspaceJavaSignatureHelp(document, position)
          ?? localJavaSignatureHelpAt(document.getText(), document.offsetAt(position));
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
  const setting = kind === "include" ? "resolution.includePaths" : "resolution.skeletonPaths";
  const searchPaths = configuredReferencePaths(document, setting);
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const allowedRoots = uniqueStrings([
    ...(workspaceRoot ? [workspaceRoot] : [dirname(document.fileName)]),
    ...searchPaths
  ]);
  const resolved = resolveReferenceCandidates(document.fileName, referenceFile, { searchPaths })
    .find((candidate) => isPathInsideAnyRoot(candidate, allowedRoots));
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

function workspaceReferenceExists(
  document: vscode.TextDocument,
  referenceFile: string,
  kind: "include" | "skeleton"
): boolean {
  const setting = kind === "include" ? "resolution.includePaths" : "resolution.skeletonPaths";
  const workspaceReference = activeWorkspaceModel
    ?.referencesFrom(document.fileName, kind)
    .find((reference) => reference.referenceFile === referenceFile)
    ?.resolvedFileName;
  if (workspaceReference && isPathInsideAnyRoot(workspaceReference, referenceReadRoots(document, setting))) {
    return true;
  }
  return Boolean(resolveExistingReferencePath(document, referenceFile, setting));
}

function resolveExistingReferencePath(document: vscode.TextDocument, referenceFile: string, setting: string): string | undefined {
  const workspaceReference = resolveWorkspaceReferencePath(document, referenceFile, setting);
  const allowedRoots = referenceReadRoots(document, setting);
  if (workspaceReference && isPathInsideAnyRoot(workspaceReference, allowedRoots)) {
    return workspaceReference;
  }
  return resolveReferenceCandidates(document.fileName, referenceFile, {
    searchPaths: configuredReferencePaths(document, setting)
  }).find((candidate) => isPathInsideAnyRoot(candidate, allowedRoots) && existsSync(candidate));
}

function resolveWorkspaceReferencePath(document: vscode.TextDocument, referenceFile: string, setting: string): string | undefined {
  const kind = setting === "resolution.skeletonPaths" ? "skeleton" : "include";
  return activeWorkspaceModel
    ?.referencesFrom(document.fileName, kind)
    .find((reference) => reference.referenceFile === referenceFile)
    ?.resolvedFileName;
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
          return directiveCompletions(document);
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
        if (range) {
          const markers = markerCompletions(range);
          return isIpxactGeneratedOutputPosition(document, position)
            ? new vscode.CompletionList([...ipxactNodeCompletions(document, position, range).items, ...markers], false)
            : markers;
        }
        return isIpxactGeneratedOutputPosition(document, position)
          ? ipxactNodeCompletions(document, position, xmlCompletionRange(document, position))
          : [];
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

  const workspaceItems = await workspaceJavaCompletionItems(document, position);
  const projection = await openJavaBridgeProjection(document, position);
  if (!projection) {
    return mergeJavaCompletions(workspaceItems, fallbackTargetCompletions(document, position).items);
  }

  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    projection.previewDocument.uri,
    projection.previewPosition,
    triggerCharacter
  );
  if (!completions) {
    return mergeJavaCompletions(workspaceItems, fallbackTargetCompletions(document, position).items);
  }

  const items = completions.items
    .map((item) => remapJavaCompletionItem(document, projection.previewDocument, position, item))
    .filter((item): item is vscode.CompletionItem => Boolean(item));
  if (items.length === 0) {
    return mergeJavaCompletions(workspaceItems, fallbackTargetCompletions(document, position).items);
  }
  return new vscode.CompletionList(mergeJavaCompletionItems(workspaceItems, items), completions.isIncomplete);
}

async function workspaceJavaCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.CompletionItem[]> {
  const index = await javaWorkspaceIndex(document);
  return workspaceJavaCompletionsAt(index, document.fileName, document.getText(), document.offsetAt(position))
    .map((completion) => {
      const item = new vscode.CompletionItem(
        completion.label,
        completion.kind === "method" ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Class
      );
      item.detail = completion.detail;
      item.insertText = completion.insertText;
      item.range = vscodeRangeFor(document, completion.range);
      item.sortText = `0_${completion.label}_${completion.detail}`;
      return item;
    });
}

function mergeJavaCompletions(
  workspaceItems: vscode.CompletionItem[],
  otherItems: readonly vscode.CompletionItem[]
): vscode.CompletionList {
  return new vscode.CompletionList(mergeJavaCompletionItems(workspaceItems, otherItems), false);
}

function mergeJavaCompletionItems(
  workspaceItems: vscode.CompletionItem[],
  otherItems: readonly vscode.CompletionItem[]
): vscode.CompletionItem[] {
  const seen = new Set<string>();
  return [...workspaceItems, ...otherItems].filter((item) => {
    const label = typeof item.label === "string" ? item.label : item.label.label;
    const key = `${label}\0${item.detail ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function workspaceJavaDefinitionLocations(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Location[]> {
  const index = await javaWorkspaceIndex(document);
  return workspaceJavaDefinitionsAt(index, document.fileName, document.getText(), document.offsetAt(position))
    .map((definition) => {
      const targetDocument = vscode.workspace.textDocuments.find((candidate) =>
        normalize(candidate.fileName) === normalize(definition.fileName)
      );
      if (targetDocument) {
        return new vscode.Location(targetDocument.uri, vscodeRangeFor(targetDocument, definition.range));
      }
      return new vscode.Location(
        vscode.Uri.file(definition.fileName),
        new vscode.Range(positionAtSourceOffset(index.source(definition.fileName)?.text ?? "", definition.range.start), positionAtSourceOffset(index.source(definition.fileName)?.text ?? "", definition.range.end))
      );
    });
}

async function workspaceJavaHover(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Hover | undefined> {
  const index = await javaWorkspaceIndex(document);
  const hover = workspaceJavaHoverAt(index, document.fileName, document.getText(), document.offsetAt(position));
  if (!hover) {
    return undefined;
  }
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${hover.title}**\n\n`);
  for (const signature of hover.signatures) {
    markdown.appendCodeblock(signature, "java");
  }
  return new vscode.Hover(markdown, vscodeRangeFor(document, hover.range));
}

async function workspaceJavaSignatureHelp(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<ReturnType<typeof localJavaSignatureHelpAt>> {
  const index = await javaWorkspaceIndex(document);
  return workspaceJavaSignatureHelpAt(index, document.fileName, document.getText(), document.offsetAt(position));
}

function positionAtSourceOffset(text: string, offset: number): vscode.Position {
  const safeOffset = Math.min(Math.max(offset, 0), text.length);
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return new vscode.Position(line, safeOffset - lineStart);
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

function directiveCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
  return [
    keyword("jet", "TxtJet directive"),
    keyword("include", "Include directive"),
    attribute("package"),
    attribute("class"),
    attribute("imports"),
    attribute("ipxact"),
    attribute("skeleton"),
    attribute("file"),
    ...configuredDirectiveCompletionItems(document)
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
      ".texjet",
      ".latexjet",
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

  if (context.directiveName === "jet" && context.attributeName === "ipxact") {
    return staticValueCompletions(
      ["true", "false"],
      "TxtJet IP-XACT metadata",
      vscode.CompletionItemKind.Value,
      new vscode.Range(document.positionAt(context.valueRange.start), position)
    );
  }

  return new vscode.CompletionList([], false);
}

function configuredDirectiveCompletionItems(document: vscode.TextDocument): vscode.CompletionItem[] {
  const attributes = configuredDirectiveMetadata(document);
  return Object.values(attributes)
    .flat()
    .map((name) => attribute(name));
}

function isIpxactGeneratedOutputPosition(document: vscode.TextDocument, position: vscode.Position): boolean {
  if (!isIpxactDocument(document)) {
    return false;
  }
  const region = classifyTxtJetRegionAt(document.getText(), document.offsetAt(position), "txtjet-xml");
  return region?.kind === "generated-output";
}

function ipxactNodeCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  range: vscode.Range
): vscode.CompletionList {
  const schema = configuredIpxactSchemaIndex(document);
  const context = schema
    ? ipxactXmlContextAt(document.getText(), document.offsetAt(position))
    : undefined;
  if (schema && context?.kind === "element") {
    const candidates = schemaChildrenFor(schema, context.parentElement)
      .filter((element) => !context.prefix || element.name.toLowerCase().startsWith(context.prefix.toLowerCase()));
    if (!context.parentElement || schemaElementsNamed(schema, context.parentElement).length > 0) {
      return new vscode.CompletionList(
        candidates.map((element) => ipxactSchemaElementCompletion(element, range, context.namespacePrefix)),
        false
      );
    }
  }
  if (schema && context?.kind === "attribute") {
    const candidates = schemaAttributesFor(schema, context.element)
      .filter((attribute) => !context.prefix || attribute.name.toLowerCase().startsWith(context.prefix.toLowerCase()));
    if (context.element && schemaElementsNamed(schema, context.element).length > 0) {
      return new vscode.CompletionList(
        candidates.map((attribute) => ipxactSchemaAttributeCompletion(attribute, range)),
        false
      );
    }
  }

  const items = IPXACT_NODE_COMPLETIONS.map((nodeName) => {
    const item = new vscode.CompletionItem(nodeName, vscode.CompletionItemKind.Snippet);
    item.detail = "TxtJet IP-XACT node";
    item.insertText = new vscode.SnippetString(`<${nodeName}>\n\t$0\n</${nodeName}>`);
    item.range = range;
    return item;
  });
  return new vscode.CompletionList(items, false);
}

function ipxactSchemaElementCompletion(
  element: TxtJetIpxactSchemaElement,
  range: vscode.Range,
  namespacePrefix?: string
): vscode.CompletionItem {
  const qualifiedName = namespacePrefix ? `${namespacePrefix}:${element.name}` : element.name;
  const item = new vscode.CompletionItem(element.name, vscode.CompletionItemKind.Snippet);
  item.detail = element.type
    ? `IP-XACT schema element · ${element.type}`
    : "IP-XACT schema element";
  item.documentation = schemaDocumentation(element.documentation, element.location.fileName);
  item.insertText = new vscode.SnippetString(`<${qualifiedName}>\n\t$0\n</${qualifiedName}>`);
  item.range = range;
  item.sortText = `0_${element.name}`;
  return item;
}

function ipxactSchemaAttributeCompletion(
  attribute: TxtJetIpxactSchemaAttribute,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(attribute.name, vscode.CompletionItemKind.Property);
  item.detail = [
    "IP-XACT schema attribute",
    attribute.type,
    attribute.required ? "required" : undefined
  ].filter(Boolean).join(" · ");
  item.documentation = schemaDocumentation(attribute.documentation, attribute.location.fileName);
  item.insertText = new vscode.SnippetString(`${attribute.name}="$1"`);
  item.range = range;
  item.sortText = `${attribute.required ? "0" : "1"}_${attribute.name}`;
  return item;
}

function schemaDocumentation(
  documentation: string | undefined,
  fileName: string
): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  if (documentation) {
    markdown.appendMarkdown(`${documentation}\n\n`);
  }
  markdown.appendMarkdown(`Schema: \`${escapeMarkdownInline(workspaceRelativeLabel(fileName))}\``);
  return markdown;
}

function xmlCompletionRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  const line = document.lineAt(position.line).text;
  let start = position.character;
  while (start > 0 && /[A-Za-z0-9_:-]/.test(line[start - 1])) {
    start -= 1;
  }
  if (start > 0 && line[start - 1] === "<") {
    start -= 1;
  }
  return new vscode.Range(new vscode.Position(position.line, start), position);
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
    if (isExcludedTxtJetWorkspacePath(directory)) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(directory, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory() && isExcludedTxtJetWorkspacePath(entryPath)) {
        continue;
      }
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
