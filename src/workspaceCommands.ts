import { relative } from "node:path";
import * as vscode from "vscode";
import {
  evaluateJetForgeCase,
  formatDoctorMarkdown,
  formatGoldenMarkdown,
  generateJetForgeProject,
  inspectJetForgeProject,
  loadJetForgeProject,
  runJetForgeGoldenTests,
  validateJetForgeProject
} from "./headlessProject";
import { validationText } from "./headlessReports";
import { targetPreviewLanguage } from "./templateModel";

const FIXTURE_PREVIEW_SCHEME = "jetforge-fixture-preview";

export function registerHeadlessWorkspaceCommands(context: vscode.ExtensionContext): void {
  registerGoldenTestController(context);
  const fixturePreviews = new FixturePreviewProvider();
  context.subscriptions.push(
    fixturePreviews,
    vscode.workspace.registerTextDocumentContentProvider(FIXTURE_PREVIEW_SCHEME, fixturePreviews)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.runWorkspaceDoctor", async () => {
      const root = await selectWorkspaceRoot("Run JetForge Workspace Doctor");
      if (!root) {
        return;
      }
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "JetForge is inspecting the workspace…",
        cancellable: false
      }, async () => {
        const project = loadJetForgeProject(root.fsPath);
        const report = inspectJetForgeProject(project);
        await openMarkdownReport("JetForge Workspace Doctor", formatDoctorMarkdown(report));
      });
    }),
    vscode.commands.registerCommand("txtjet.validateHeadlessWorkspace", async () => {
      const root = await selectWorkspaceRoot("Validate workspace with JetForge core");
      if (!root) {
        return;
      }
      const project = loadJetForgeProject(root.fsPath);
      const result = validateJetForgeProject(project);
      const language = "log";
      const document = await vscode.workspace.openTextDocument({ language, content: validationText(result) });
      await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      const message = result.ok
        ? `JetForge validation passed for ${result.templates} templates.`
        : `JetForge found ${result.issues.length} validation issues.`;
      (result.ok ? vscode.window.showInformationMessage : vscode.window.showWarningMessage)(message);
    }),
    vscode.commands.registerCommand("txtjet.generateWorkspaceOutputs", async () => {
      const root = await selectWorkspaceRoot("Generate all JetForge workspace outputs");
      if (!root) {
        return;
      }
      const project = loadJetForgeProject(root.fsPath);
      const results = generateJetForgeProject(project);
      const action = await vscode.window.showInformationMessage(
        `JetForge generated ${results.length} workspace output${results.length === 1 ? "" : "s"}.`,
        "Open Output Folder"
      );
      if (action === "Open Output Folder") {
        const output = results[0]?.output;
        if (output) {
          await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(output));
        }
      }
    }),
    vscode.commands.registerCommand("txtjet.runGoldenTests", async () => {
      await runGoldenCommand(false);
    }),
    vscode.commands.registerCommand("txtjet.updateGoldenTests", async () => {
      const confirmation = await vscode.window.showWarningMessage(
        "Replace every configured JetForge golden baseline with current output?",
        { modal: true },
        "Update Baselines"
      );
      if (confirmation === "Update Baselines") {
        await runGoldenCommand(true);
      }
    }),
    vscode.commands.registerCommand("txtjet.evaluateFixture", async () => {
      const root = await selectWorkspaceRoot("Evaluate a JetForge fixture");
      if (!root) {
        return;
      }
      const project = loadJetForgeProject(root.fsPath);
      const cases = (project.config.tests ?? []).filter((entry) => entry.mode === "command" && entry.fixture);
      if (cases.length === 0) {
        vscode.window.showInformationMessage("No command-mode fixture cases are configured in .jetforge.json.");
        return;
      }
      const picked = await vscode.window.showQuickPick(cases.map((entry) => ({
        label: entry.name,
        description: entry.fixture,
        detail: entry.template,
        entry
      })), {
        title: "Evaluate fixture with the configured local command",
        placeHolder: "Choose a named fixture case"
      });
      if (!picked) {
        return;
      }
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `JetForge is evaluating ${picked.entry.name}…`,
        cancellable: false
      }, async () => {
        const result = await evaluateJetForgeCase(project, picked.entry.name);
        const uri = fixturePreviews.set(result.testCase.name, result.content);
        let document = await vscode.workspace.openTextDocument(uri);
        if (result.testCase.targetLanguage) {
          document = await vscode.languages.setTextDocumentLanguage(document, targetPreviewLanguage(result.testCase.targetLanguage));
        }
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        vscode.window.setStatusBarMessage(`JetForge evaluated ${result.testCase.name} in ${result.durationMs} ms.`, 5000);
      });
    })
  );
}

class FixturePreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly content = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  set(name: string, content: string): vscode.Uri {
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, "-") || "fixture";
    const uri = vscode.Uri.from({ scheme: FIXTURE_PREVIEW_SCHEME, path: `/${safeName}` });
    this.content.set(uri.toString(), content);
    this.changed.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? "JetForge fixture output is unavailable. Run the evaluation again.";
  }

  dispose(): void {
    this.content.clear();
    this.changed.dispose();
  }
}

function registerGoldenTestController(context: vscode.ExtensionContext): void {
  const controller = vscode.tests.createTestController("jetforgeGolden", "JetForge Golden Output");
  const cases = new Map<string, { root: vscode.Uri; name: string }>();
  const refresh = (): void => {
    controller.items.replace([]);
    cases.clear();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const rootItem = controller.createTestItem(`folder:${folder.uri.toString()}`, folder.name, folder.uri);
      rootItem.description = "JetForge golden outputs";
      controller.items.add(rootItem);
      try {
        const project = loadJetForgeProject(folder.uri.fsPath);
        const configured = project.config.tests ?? [];
        if (configured.length === 0) {
          rootItem.error = "Add tests to .jetforge.json, then update golden baselines.";
          continue;
        }
        for (const testCase of configured) {
          const id = `case:${folder.uri.toString()}:${testCase.name}`;
          const item = controller.createTestItem(id, testCase.name, vscode.Uri.file(resolveCasePath(folder.uri.fsPath, testCase.template)));
          item.description = testCase.mode === "command" ? "fixture command" : "preview";
          rootItem.children.add(item);
          cases.set(id, { root: folder.uri, name: testCase.name });
        }
      } catch (error) {
        rootItem.error = error instanceof Error ? error.message : String(error);
      }
    }
  };
  controller.refreshHandler = async () => refresh();
  controller.createRunProfile("Run Golden Outputs", vscode.TestRunProfileKind.Run, async (request, token) => {
    const run = controller.createTestRun(request);
    try {
      const selected = selectedGoldenCases(controller, cases, request);
      for (const [root, entries] of selected) {
        if (token.isCancellationRequested) {
          for (const entry of entries) {
            run.skipped(entry.item);
          }
          continue;
        }
        for (const entry of entries) {
          run.enqueued(entry.item);
          run.started(entry.item);
        }
        try {
          const project = loadJetForgeProject(vscode.Uri.parse(root).fsPath);
          const result = await runJetForgeGoldenTests(project, false, new Set(entries.map((entry) => entry.name)));
          const byName = new Map(result.results.map((entry) => [entry.name, entry]));
          for (const entry of entries) {
            const outcome = byName.get(entry.name);
            if (!outcome) {
              run.skipped(entry.item);
            } else if (outcome.status === "passed") {
              run.passed(entry.item, outcome.durationMs);
            } else {
              const message = new vscode.TestMessage(outcome.error ?? outcome.firstDifference ?? "Golden output differs from its baseline.");
              outcome.status === "error"
                ? run.errored(entry.item, message, outcome.durationMs)
                : run.failed(entry.item, message, outcome.durationMs);
            }
          }
        } catch (error) {
          const message = new vscode.TestMessage(error instanceof Error ? error.message : String(error));
          for (const entry of entries) {
            run.errored(entry.item, message);
          }
        }
      }
    } finally {
      run.end();
    }
  }, true);
  const watcher = vscode.workspace.createFileSystemWatcher("**/.jetforge.json");
  watcher.onDidCreate(refresh, undefined, context.subscriptions);
  watcher.onDidChange(refresh, undefined, context.subscriptions);
  watcher.onDidDelete(refresh, undefined, context.subscriptions);
  context.subscriptions.push(controller, watcher, vscode.workspace.onDidChangeWorkspaceFolders(refresh));
  refresh();
}

function selectedGoldenCases(
  controller: vscode.TestController,
  cases: Map<string, { root: vscode.Uri; name: string }>,
  request: vscode.TestRunRequest
): Map<string, Array<{ item: vscode.TestItem; name: string }>> {
  const excluded = new Set((request.exclude ?? []).map((item) => item.id));
  const includedIds = request.include ? new Set(request.include.map((item) => item.id)) : undefined;
  const selected = new Map<string, Array<{ item: vscode.TestItem; name: string }>>();
  for (const [id, metadata] of cases) {
    const item = findTestItem(controller.items, id);
    if (!item || excluded.has(id)) {
      continue;
    }
    const parentId = parentTestItemId(controller.items, id);
    if (includedIds && !includedIds.has(id) && (!parentId || !includedIds.has(parentId))) {
      continue;
    }
    const key = metadata.root.toString();
    const entries = selected.get(key) ?? [];
    entries.push({ item, name: metadata.name });
    selected.set(key, entries);
  }
  return selected;
}

function findTestItem(collection: vscode.TestItemCollection, id: string): vscode.TestItem | undefined {
  let found: vscode.TestItem | undefined;
  collection.forEach((item) => {
    found = found ?? (item.id === id ? item : findTestItem(item.children, id));
  });
  return found;
}

function parentTestItemId(collection: vscode.TestItemCollection, childId: string): string | undefined {
  let parent: string | undefined;
  collection.forEach((item) => {
    if (item.children.get(childId)) {
      parent = item.id;
    } else {
      parent = parent ?? parentTestItemId(item.children, childId);
    }
  });
  return parent;
}

function resolveCasePath(root: string, path: string): string {
  return vscode.Uri.joinPath(vscode.Uri.file(root), ...path.replace(/\\/g, "/").split("/")).fsPath;
}

async function runGoldenCommand(update: boolean): Promise<void> {
  const root = await selectWorkspaceRoot(update ? "Update JetForge golden outputs" : "Run JetForge golden tests");
  if (!root) {
    return;
  }
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: update ? "JetForge is updating golden outputs…" : "JetForge is testing generated outputs…",
    cancellable: false
  }, async () => {
    const project = loadJetForgeProject(root.fsPath);
    const run = await runJetForgeGoldenTests(project, update);
    await openMarkdownReport("JetForge Golden Output Tests", formatGoldenMarkdown(run));
    if (run.ok) {
      vscode.window.showInformationMessage(
        update ? `JetForge updated ${run.updated} golden baseline${run.updated === 1 ? "" : "s"}.` : `JetForge: ${run.passed} golden tests passed.`
      );
    } else {
      vscode.window.showWarningMessage(`JetForge: ${run.failed} golden tests failed and ${run.errors} errored.`);
    }
  });
}

async function selectWorkspaceRoot(title: string): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showWarningMessage("Open a workspace folder before running JetForge project commands.");
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0].uri;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = active ? vscode.workspace.getWorkspaceFolder(active) : undefined;
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: activeFolder?.uri.toString() === folder.uri.toString() ? "Active workspace folder" : relative(folders[0].uri.fsPath, folder.uri.fsPath),
      uri: folder.uri
    })),
    { title, placeHolder: "Choose the workspace folder whose .jetforge.json should be used" }
  );
  return picked?.uri;
}

async function openMarkdownReport(title: string, content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: `<!-- ${title} -->\n\n${content}`
  });
  try {
    await vscode.commands.executeCommand("markdown.showPreview", document.uri);
  } catch {
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }
}
