import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as vscode from "vscode";
import {
  BuiltinTargetResult,
  builtinResultsText,
  isBuiltinProject,
  runBuiltinTarget,
  runBuiltinTargets,
} from "./builtinProject";
import { publishBuiltinOutput } from "./builtinCompiler";
import { canonicalFileIdentity, isPathInsideAnyRoot } from "./extensionSupport";
import { JetForgeProject, loadJetForgeProject } from "./headlessProject";
import { ValidationRunCoordinator } from "./validationRuns";

export const BUILTIN_OUTPUT_SCHEME = "jetforge-builtin-output";
interface EditorArgument {
  root?: string;
  target?: string;
  quiet?: boolean;
}
type Action = "compile" | "evaluate" | "generate" | "diff";
let adapter: BuiltinEditorAdapter | undefined;

export function readBuiltinEditorFile(fileName: string): string | undefined {
  return vscode.workspace.textDocuments
    .find(
      (document) =>
        document.uri.scheme === "file" &&
        canonicalFileIdentity(document.uri.fsPath) === canonicalFileIdentity(fileName),
    )
    ?.getText();
}

/** Saved v1 behavior is preserved; explicit v2 project operations consume live buffers. */
export function loadBuiltinEditorProject(root: string): JetForgeProject {
  const path = join(root, ".jetforge.json");
  const buffer = readBuiltinEditorFile(path);
  if (buffer !== undefined) {
    try {
      if (JSON.parse(buffer).version === 2) {
        return loadJetForgeProject(
          root,
          ".jetforge.json",
          readBuiltinEditorFile,
        );
      }
    } catch {
      /* The saved v2 branch below reports invalid open configuration. */
    }
  }
  const saved = loadJetForgeProject(root);
  return isBuiltinProject(saved)
    ? loadJetForgeProject(root, ".jetforge.json", readBuiltinEditorFile)
    : saved;
}

export function registerBuiltinCompilerCommands(
  context: vscode.ExtensionContext,
): void {
  const instance = new BuiltinEditorAdapter(context);
  adapter = instance;
  context.subscriptions.push(instance);
  for (const [command, action] of [
    ["txtjet.compileBuiltinTarget", "compile"],
    ["txtjet.evaluateBuiltinTarget", "evaluate"],
    ["txtjet.generateBuiltinTarget", "generate"],
  ] as const) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (argument?: EditorArgument) =>
        instance.execute(action, argument),
      ),
    );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "txtjet.validateBuiltinProject",
      async (argument?: EditorArgument) => {
        if (!vscode.workspace.isTrusted) {
          await vscode.window.showWarningMessage(
            "Trust this workspace before running the built-in compiler.",
          );
          return undefined;
        }
        const project = await instance.project(argument);
        if (!project) {
          return undefined;
        }
        const results = await runBuiltinTargets(
          project,
          "compile",
          argument?.target,
          {
            readFile: readBuiltinEditorFile,
            javaHome: vscode.workspace
              .getConfiguration("txtjet", vscode.Uri.file(project.root))
              .get<string>("compiler.javaHome"),
          },
        );
        if (!argument?.quiet) {
          const document = await vscode.workspace.openTextDocument({
            language: "log",
            content: builtinResultsText(results),
          });
          await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Beside,
          });
        }
        return results;
      },
    ),
  );
}

/** True means this template belongs to the explicit builtin workflow, including failure/cancel. */
export async function handleBuiltinDocument(
  document: vscode.TextDocument,
  action: Action,
): Promise<boolean> {
  const selection = await adapter?.documentSelection(document);
  if (!selection) {
    return false;
  }
  await adapter!.execute(action, {
    root: selection.project.root,
    target: selection.target,
  });
  return true;
}

export function isBuiltinDocument(document: vscode.TextDocument): boolean {
  return adapter?.configuredDocument(document) ?? false;
}

class BuiltinEditorAdapter
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly outputs = new Map<string, string>();
  private readonly runs = new ValidationRunCoordinator();
  private readonly active = new Map<string, Set<string>>();
  private readonly diagnosticsByTarget = new Map<string, Map<string, { uri: vscode.Uri; entries: vscode.Diagnostic[] }>>();
  private readonly diagnosticUris = new Map<string, vscode.Uri>();
  private readonly diagnostics =
    vscode.languages.createDiagnosticCollection("jetforge-builtin");
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider(
        BUILTIN_OUTPUT_SCHEME,
        this,
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== "file") {
          return;
        }
        const fileName = canonicalFileIdentity(event.document.uri.fsPath);
        for (const [key, files] of this.active) {
          if (files.has(fileName)) {
            this.runs.invalidate(key);
          }
        }
        for (const [key, diagnosed] of this.diagnosticsByTarget) {
          if (diagnosed.has(fileName)) {
            this.diagnosticsByTarget.delete(key);
            this.refreshDiagnostics(diagnosed.keys());
          }
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme !== "file") {
          return;
        }
        for (const [key, files] of this.active) {
          if (files.has(canonicalFileIdentity(document.uri.fsPath))) {
            this.runs.invalidate(key);
          }
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("txtjet.compiler.javaHome")) {
          for (const key of this.active.keys()) {
            this.runs.invalidate(key);
          }
        }
      }),
    ].filter(Boolean);
  }

  async project(
    argument?: EditorArgument,
  ): Promise<JetForgeProject | undefined> {
    let root = argument?.root;
    if (!root) {
      const active = vscode.window.activeTextEditor?.document;
      if (active?.uri.scheme === "file") {
        root = this.projectRoot(active);
      }
    }
    if (!root) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 1) {
        root = folders[0].uri.fsPath;
      } else {
        root = (
          await vscode.window.showQuickPick(
            folders.map((folder) => ({
              label: folder.name,
              root: folder.uri.fsPath,
            })),
            { title: "Choose the compiler project" },
          )
        )?.root;
      }
    }
    if (!root) {
      return undefined;
    }
    if (
      !(vscode.workspace.workspaceFolders ?? []).some((folder) =>
        isPathInsideAnyRoot(root!, [folder.uri.fsPath]),
      )
    ) {
      throw new Error(
        "Built-in editor targets must belong to an open workspace.",
      );
    }
    const project = loadJetForgeProject(
      root,
      ".jetforge.json",
      readBuiltinEditorFile,
    );
    if (!isBuiltinProject(project)) {
      if (!argument?.quiet) {
        await vscode.window.showInformationMessage(
          "Configure a version 2 .jetforge.json with the builtin compiler to execute targets.",
        );
      }
      return undefined;
    }
    return project;
  }

  private projectRoot(document: vscode.TextDocument): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      return undefined;
    }
    let root = dirname(document.uri.fsPath);
    while (isPathInsideAnyRoot(root, [folder.uri.fsPath])) {
      if (existsSync(join(root, ".jetforge.json"))) {
        return root;
      }
      const parent = dirname(root);
      if (parent === root) {
        break;
      }
      root = parent;
    }
    return folder.uri.fsPath;
  }

  async documentSelection(
    document: vscode.TextDocument,
    interactive = true,
  ): Promise<{ project: JetForgeProject; target: string } | undefined> {
    const root = this.projectRoot(document);
    if (!root) {
      return undefined;
    }
    const project = loadJetForgeProject(
      root,
      ".jetforge.json",
      readBuiltinEditorFile,
    );
    if (!isBuiltinProject(project)) {
      return undefined;
    }
    const targets = project.config.targets!.filter(
      (target) =>
        canonicalFileIdentity(resolve(root, target.template)) === canonicalFileIdentity(document.uri.fsPath),
    );
    if (!targets.length) {
      return undefined;
    }
    const target =
      targets.length === 1
        ? targets[0].name
        : interactive
          ? (
              await vscode.window.showQuickPick(
                targets.map((entry) => ({
                  label: entry.name,
                  description: entry.fixture,
                  target: entry.name,
                })),
                { title: "Choose the target and fixture" },
              )
            )?.target
          : undefined;
    if (!target) {
      throw new Error(
        "Choose one named target when a template has multiple fixtures.",
      );
    }
    return { project, target };
  }

  configuredDocument(document: vscode.TextDocument): boolean {
    const root = this.projectRoot(document);
    if (!root) {
      return false;
    }
    const path = join(root, ".jetforge.json");
    if (!existsSync(path) || statSync(path).size > 1024 * 1024) {
      return false;
    }
    try {
      const config = JSON.parse(
        readBuiltinEditorFile(path) ?? readFileSync(path, "utf8"),
      ) as {
        version?: number;
        compiler?: { backend?: string };
        targets?: Array<{ template?: string }>;
      };
      return (
        config.version === 2 &&
        config.compiler?.backend === "builtin" &&
        Array.isArray(config.targets) &&
        config.targets.some(
          (target) =>
            typeof target?.template === "string" &&
            canonicalFileIdentity(resolve(root, target.template)) === canonicalFileIdentity(document.uri.fsPath),
        )
      );
    } catch {
      return false;
    }
  }

  async execute(
    action: Action,
    argument?: EditorArgument,
  ): Promise<BuiltinTargetResult | undefined> {
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage(
        "Trust this workspace before running template Java.",
      );
      return undefined;
    }
    const project = await this.project(argument);
    if (!project) {
      return undefined;
    }
    const name =
      argument?.target ??
      (project.config.targets!.length === 1
        ? project.config.targets![0].name
        : (
            await vscode.window.showQuickPick(
              project.config.targets!.map((target) => ({
                label: target.name,
                description: target.fixture,
                target: target.name,
              })),
              { title: "Choose a built-in compiler target" },
            )
          )?.target);
    if (!name) {
      return undefined;
    }
    const key = `${canonicalFileIdentity(project.root)}:${name}`;
    const files = new Set<string>([canonicalFileIdentity(project.configPath)]);
    this.active.set(key, files);
    const token = this.runs.begin(key, 0);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    token.signal.addEventListener("abort", onAbort, { once: true });
    const run = async (
      cancellation?: vscode.CancellationToken,
    ): Promise<BuiltinTargetResult> => {
      const listener = cancellation?.onCancellationRequested(() =>
        controller.abort(),
      );
      try {
        return await runBuiltinTarget(
          project,
          name,
          action === "compile" ? "compile" : "evaluate",
          {
            signal: controller.signal,
            isCurrent: () =>
              this.runs.isCurrent(key, token, 0) && vscode.workspace.isTrusted,
            readFile: (path) => {
              files.add(canonicalFileIdentity(path));
              return readBuiltinEditorFile(path);
            },
            javaHome: vscode.workspace
              .getConfiguration("txtjet", vscode.Uri.file(project.root))
              .get<string>("compiler.javaHome"),
          },
        );
      } finally {
        listener?.dispose();
      }
    };
    try {
      const result = argument?.quiet
        ? await run()
        : await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `JetForge: ${action} ${name}`,
              cancellable: true,
            },
            (_progress, cancellation) => run(cancellation),
          );
      if (!this.runs.isCurrent(key, token, 0)) {
        result.ok = false;
        result.output = undefined;
        return result;
      }
      await this.setDiagnostics(key, result, () => this.runs.isCurrent(key, token, 0) && result.inputsCurrent?.() !== false);
      if (
        !this.runs.isCurrent(key, token, 0) ||
        result.inputsCurrent?.() === false
      ) {
        result.ok = false;
        result.output = undefined;
        result.diagnostics.push({
          code: "STALE",
          severity: "error",
          message: "An input changed before publication; run the target again.",
        });
        return result;
      }
      if (result.ok && action === "generate") {
        try {
          publishBuiltinOutput(project.root, result.outputFile, result);
        } catch (error) {
          result.ok = false;
          result.diagnostics.push({
            code: "OUTPUT_ERROR",
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const snapshots = this.context.workspaceState.get<
          Record<string, string>
        >("jetforge.builtin.snapshots", {});
        if (
          result.ok &&
          Buffer.byteLength(result.output ?? "") <= 1024 * 1024
        ) {
          delete snapshots[key];
          snapshots[key] = result.output!;
          await this.context.workspaceState.update(
            "jetforge.builtin.snapshots",
            Object.fromEntries(Object.entries(snapshots).slice(-20)),
          );
        }
      }
      if (!argument?.quiet) {
        if (!result.ok) {
          await vscode.window.showErrorMessage(
            result.diagnostics
              .map((problem) => `[${problem.code}] ${problem.message}`)
              .join("\n") || "Compiler run was cancelled or superseded.",
          );
        } else if (action === "diff") {
          const previous = this.context.workspaceState.get<
            Record<string, string>
          >("jetforge.builtin.snapshots", {})[key];
          if (previous === undefined) {
            await vscode.window.showInformationMessage(
              "Generate this target once before comparing with its last output.",
            );
          } else {
            const before = this.setOutput(result, previous, "previous");
            const after = this.setOutput(result, result.output!);
            await vscode.commands.executeCommand(
              "vscode.diff",
              before,
              after,
              `JetForge evaluated diff: ${name}`,
            );
          }
        } else if (result.output !== undefined) {
          await this.showResult(result);
        } else {
          await vscode.window.showInformationMessage(
            `JetForge compiled ${name} successfully.`,
          );
        }
      }
      return result;
    } finally {
      token.signal.removeEventListener("abort", onAbort);
      if (this.runs.isCurrent(key, token, 0)) {
        this.active.delete(key);
      }
      this.runs.finish(key, token);
    }
  }

  private async setDiagnostics(key: string, result: BuiltinTargetResult, isCurrent: () => boolean): Promise<void> {
    const byFile = new Map<string, { uri: vscode.Uri; entries: vscode.Diagnostic[] }>();
    byFile.set(canonicalFileIdentity(result.template), { uri: vscode.Uri.file(result.template), entries: [] });
    for (const problem of result.diagnostics) {
      if (!problem.fileName || !problem.range) {
        continue;
      }
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(problem.fileName),
      );
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          document.positionAt(problem.range.start),
          document.positionAt(problem.range.end),
        ),
        problem.message,
        problem.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.code = problem.code;
      diagnostic.source = "JetForge compiler";
      const fileName = canonicalFileIdentity(problem.fileName);
      const entry = byFile.get(fileName) ?? { uri: document.uri, entries: [] };
      entry.entries.push(diagnostic);
      byFile.set(fileName, entry);
    }
    if (!isCurrent()) {
      return;
    }
    const previous = this.diagnosticsByTarget.get(key);
    this.diagnosticsByTarget.set(key, byFile);
    this.refreshDiagnostics(new Set([...previous?.keys() ?? [], ...byFile.keys()]));
  }

  private refreshDiagnostics(files: Iterable<string>): void {
    for (const fileName of files) {
      const contributions = [...this.diagnosticsByTarget.values()].flatMap((byFile) => byFile.get(fileName) ?? []);
      const previousUri = this.diagnosticUris.get(fileName);
      const uri = contributions[0]?.uri ?? previousUri ?? vscode.Uri.file(fileName);
      const entries = contributions.flatMap((entry) => entry.entries);
      if (previousUri && previousUri.toString() !== uri.toString()) {
        this.diagnostics.delete(previousUri);
      }
      if (entries.length) {
        this.diagnostics.set(uri, entries);
        this.diagnosticUris.set(fileName, uri);
      } else {
        this.diagnostics.delete(uri);
        this.diagnosticUris.delete(fileName);
      }
    }
  }

  private setOutput(
    result: BuiltinTargetResult,
    output: string,
    suffix = "current",
  ): vscode.Uri {
    const identity = createHash("sha256")
      .update(result.template + result.target + suffix)
      .digest("hex")
      .slice(0, 24);
    const uri = vscode.Uri.from({
      scheme: BUILTIN_OUTPUT_SCHEME,
      path: `/${identity}/${basename(result.outputFile)}`,
    });
    this.outputs.delete(uri.toString());
    this.outputs.set(uri.toString(), output);
    while (
      this.outputs.size > 20 ||
      [...this.outputs.values()].reduce(
        (sum, text) => sum + Buffer.byteLength(text),
        0,
      ) >
        16 * 1024 * 1024
    ) {
      this.outputs.delete(this.outputs.keys().next().value!);
    }
    this.changed.fire(uri);
    return uri;
  }
  async showResult(
    result: BuiltinTargetResult,
  ): Promise<vscode.TextDocument | undefined> {
    if (!result.ok || result.output === undefined) {
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(
      this.setOutput(result, result.output),
    );
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
    });
    return document;
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    return (
      this.outputs.get(uri.toString()) ??
      "This evaluated output was evicted. Run the target again."
    );
  }
  dispose(): void {
    this.runs.dispose();
    this.changed.dispose();
    this.diagnostics.dispose();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.outputs.clear();
    this.diagnosticsByTarget.clear();
    this.diagnosticUris.clear();
    if (adapter === this) {
      adapter = undefined;
    }
  }
}
