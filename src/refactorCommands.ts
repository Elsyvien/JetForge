import { existsSync, readFileSync } from "node:fs";
import { normalize } from "node:path";
import * as vscode from "vscode";
import { TxtJetJavaWorkspaceIndex } from "./javaWorkspaceIntelligence";
import {
  formatRefactorPlanMarkdown,
  JetForgeRefactorPlan,
  planHelperExtraction,
  planImportCleanup,
  planWorkspaceClassRename
} from "./refactorPlans";
import { TxtJetRange } from "./templateModel";

export interface RefactorCommandServices {
  javaWorkspaceIndex(document: vscode.TextDocument): Promise<TxtJetJavaWorkspaceIndex>;
  isTxtJetFile(document: vscode.TextDocument): boolean;
  workspaceRelativeLabel(fileName: string): string;
  vscodeRangeFor(document: vscode.TextDocument, range: TxtJetRange): vscode.Range;
}

export function registerSafeRecipeCommands(context: vscode.ExtensionContext, services: RefactorCommandServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("txtjet.renameWorkspaceClass", async () => {
      await renameWorkspaceClass(services);
    }),
    vscode.commands.registerCommand("txtjet.extractJavaHelper", async () => {
      await extractJavaHelper(services);
    }),
    vscode.commands.registerCommand("txtjet.cleanJetImports", async () => {
      await cleanJetImports(services);
    })
  );
}

export async function confirmRefactorPlan(
  plan: JetForgeRefactorPlan,
  workspaceRelativeLabel: (fileName: string) => string
): Promise<boolean> {
  const openDocuments = new Map(vscode.workspace.textDocuments.map((document) => [normalize(document.fileName), document.getText()]));
  const markdown = formatRefactorPlanMarkdown(
    plan,
    (fileName) => openDocuments.get(normalize(fileName)) ?? (existsSync(fileName) ? readFileSync(fileName, "utf8") : undefined),
    workspaceRelativeLabel
  );
  const preview = await vscode.workspace.openTextDocument({ language: "markdown", content: markdown });
  try {
    await vscode.commands.executeCommand("markdown.showPreview", preview.uri);
  } catch {
    await vscode.window.showTextDocument(preview, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }
  const action = await vscode.window.showWarningMessage(
    plan.summary,
    { modal: true, detail: "Review the opened change plan before applying it." },
    "Apply Refactor"
  );
  return action === "Apply Refactor";
}

async function renameWorkspaceClass(services: RefactorCommandServices): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || !services.isTxtJetFile(document)) {
    return;
  }
  const index = await services.javaWorkspaceIndex(document);
  const currentClass = index.classForFile(document.fileName);
  if (!currentClass) {
    vscode.window.showInformationMessage("The active template does not declare an @jet class.");
    return;
  }
  const newName = await vscode.window.showInputBox({
    title: `Rename workspace class ${currentClass.className}`,
    prompt: "JetForge updates only deterministic TxtJet workspace references.",
    value: currentClass.className,
    valueSelection: [0, currentClass.className.length],
    validateInput(value) {
      return /^[A-Za-z_$][\w$]*$/.test(value) ? undefined : "Enter a valid Java class identifier.";
    }
  });
  if (!newName || newName === currentClass.className) {
    return;
  }
  try {
    const plan = planWorkspaceClassRename(index, document.fileName, newName);
    if (await confirmRefactorPlan(plan, services.workspaceRelativeLabel) && await applyTextRefactorPlan(plan, services)) {
      const filesChanged = new Set(plan.edits.map((edit) => edit.fileName)).size;
      vscode.window.showInformationMessage(`JetForge renamed ${currentClass.className} to ${newName} in ${filesChanged} template${filesChanged === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`JetForge could not plan the class rename: ${String(error)}`);
  }
}

async function extractJavaHelper(services: RefactorCommandServices): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !services.isTxtJetFile(editor.document) || editor.selection.isEmpty) {
    vscode.window.showInformationMessage("Select Java statements inside one TxtJet scriptlet before extracting a helper.");
    return;
  }
  const helperName = await vscode.window.showInputBox({
    title: "Extract private TxtJet helper",
    prompt: "The selection must not depend on enclosing local variables or control flow.",
    value: "renderSection",
    valueSelection: [0, "renderSection".length],
    validateInput(value) {
      return /^[A-Za-z_$][\w$]*$/.test(value) ? undefined : "Enter a valid Java helper name.";
    }
  });
  if (!helperName) {
    return;
  }
  try {
    const document = editor.document;
    const plan = planHelperExtraction(document.fileName, document.getText(), {
      start: document.offsetAt(editor.selection.start),
      end: document.offsetAt(editor.selection.end)
    }, helperName);
    if (await confirmRefactorPlan(plan, services.workspaceRelativeLabel) && await applyTextRefactorPlan(plan, services)) {
      vscode.window.showInformationMessage(`JetForge extracted ${helperName}().`);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`JetForge did not extract the helper: ${String(error)}`);
  }
}

async function cleanJetImports(services: RefactorCommandServices): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || !services.isTxtJetFile(document)) {
    return;
  }
  try {
    const plan = planImportCleanup(document.fileName, document.getText());
    if (await confirmRefactorPlan(plan, services.workspaceRelativeLabel) && await applyTextRefactorPlan(plan, services)) {
      vscode.window.showInformationMessage("JetForge normalized the @jet imports metadata.");
    }
  } catch (error) {
    vscode.window.showInformationMessage(String(error));
  }
}

async function applyTextRefactorPlan(plan: JetForgeRefactorPlan, services: RefactorCommandServices): Promise<boolean> {
  if (plan.fileOperations.length > 0) {
    throw new Error("This helper applies text-only refactor plans.");
  }
  const edit = new vscode.WorkspaceEdit();
  for (const planned of plan.edits) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(planned.fileName));
    edit.replace(document.uri, services.vscodeRangeFor(document, planned.range), planned.newText);
  }
  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage("JetForge could not apply the reviewed refactor plan.");
    return false;
  }
  return true;
}
