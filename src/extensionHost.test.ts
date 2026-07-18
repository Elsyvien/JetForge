import assert from "node:assert/strict";
import { resolve } from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "elsyvien.txtjet-syntax";
const EXPECTED_LANGUAGE_IDS = [
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python",
  "txtjet-latex"
];

export async function run(): Promise<void> {
  let topologyRoot: vscode.Uri | undefined;
  try {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} must be discoverable in the extension host`);

    await extension.activate();
    assert.equal(extension.isActive, true, `${EXTENSION_ID} must activate successfully`);

    const contributedCommands = extension.packageJSON.contributes?.commands as Array<{ command: string }> | undefined;
    assert.ok(Array.isArray(contributedCommands), "the extension must contribute commands");

    const registeredCommands = new Set(await vscode.commands.getCommands(true));
    for (const contribution of contributedCommands) {
      assert.ok(
        registeredCommands.has(contribution.command),
        `contributed command must be registered after activation: ${contribution.command}`
      );
    }

    const registeredLanguages = new Set(await vscode.languages.getLanguages());
    for (const languageId of EXPECTED_LANGUAGE_IDS) {
      assert.ok(registeredLanguages.has(languageId), `language must be registered: ${languageId}`);
    }

    await vscode.commands.executeCommand("txtjet.openGettingStarted");

    const extensionRoot = resolve(__dirname, "..");
    const sourceUri = vscode.Uri.file(resolve(extensionRoot, "examples", "sample-java.txtjet"));
    const sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
    await vscode.window.showTextDocument(sourceDocument);

    await vscode.commands.executeCommand("txtjet.openGeneratedOutputPreview");

    const previewDocument = vscode.window.activeTextEditor?.document;
    assert.ok(previewDocument, "the generated-output preview command must open an editor");
    assert.equal(previewDocument.uri.scheme, "txtjet-preview-output");
    assert.ok(previewDocument.getText().length > 0, "the generated-output preview must not be empty");

    await vscode.window.showTextDocument(sourceDocument);
    await vscode.commands.executeCommand("txtjet.openGeneratedOutputForTemplate");
    const workspaceOutputPreview = vscode.window.activeTextEditor?.document;
    assert.ok(workspaceOutputPreview, "the workspace generated-output command must open an editor");
    assert.equal(workspaceOutputPreview.uri.scheme, "txtjet-preview-output");
    assert.ok(workspaceOutputPreview.getText().length > 0, "the workspace generated-output preview must not be empty");

    topologyRoot = vscode.Uri.file(resolve(extensionRoot, "examples", ".jetforge-extension-host-topology"));
    const topologySource = vscode.Uri.joinPath(topologyRoot, "parent.txtjet");
    const topologyInclude = vscode.Uri.joinPath(topologyRoot, "partial.jetinc");
    const workspaceService = vscode.Uri.joinPath(topologyRoot, "WorkspaceService.txtjet");
    const workspaceConsumer = vscode.Uri.joinPath(topologyRoot, "WorkspaceConsumer.txtjet");
    const resolvedMarker = "resolved-include-from-topology-refresh";
    await vscode.workspace.fs.createDirectory(topologyRoot);
    await vscode.workspace.fs.writeFile(
      topologySource,
      Buffer.from('<%@ include file="partial.jetinc" %>\n', "utf8")
    );
    await vscode.commands.executeCommand("txtjet.refreshWorkspaceModel");
    const topologyDocument = await vscode.workspace.openTextDocument(topologySource);
    await vscode.window.showTextDocument(topologyDocument);
    await vscode.commands.executeCommand("txtjet.openGeneratedOutputPreview");
    const topologyPreview = vscode.window.activeTextEditor?.document;
    assert.ok(topologyPreview, "topology regression test must open a generated preview");
    assert.equal(topologyPreview.uri.scheme, "txtjet-preview-output");
    assert.equal(topologyPreview.getText().includes(resolvedMarker), false);

    await vscode.workspace.fs.writeFile(topologyInclude, Buffer.from(resolvedMarker, "utf8"));
    await vscode.commands.executeCommand("txtjet.refreshWorkspaceModel");
    await waitFor(
      () => topologyPreview.getText().includes(resolvedMarker),
      "an open parent preview must refresh when a formerly unresolved include becomes available"
    );

    await vscode.workspace.fs.writeFile(
      workspaceService,
      Buffer.from('<%@ jet package="host" class="WorkspaceService" %>\n<%! public String render(String value) { return value; } %>\n', "utf8")
    );
    const consumerText = '<%@ jet package="host" class="WorkspaceConsumer" %>\n<%! private WorkspaceService service = new WorkspaceService(); %>\n<% service.ren; service.render("x"); %>\n';
    await vscode.workspace.fs.writeFile(workspaceConsumer, Buffer.from(consumerText, "utf8"));
    await vscode.commands.executeCommand("txtjet.refreshWorkspaceModel");
    const consumerDocument = await vscode.workspace.openTextDocument(workspaceConsumer);
    await vscode.window.showTextDocument(consumerDocument);

    const completionOffset = consumerText.indexOf("service.ren") + "service.ren".length;
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      consumerDocument.uri,
      consumerDocument.positionAt(completionOffset)
    );
    assert.ok(completions.items.some((item) => completionLabel(item) === "render" && item.detail?.includes("host.WorkspaceService")),
      "cross-class IntelliSense must offer methods from another workspace @jet class");

    const definitionOffset = consumerText.indexOf('service.render("x")') + "service.".length + 2;
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      consumerDocument.uri,
      consumerDocument.positionAt(definitionOffset)
    );
    assert.ok(definitions.some((location) => location.uri.fsPath === workspaceService.fsPath),
      "cross-class Go to Definition must open the template that declares the method");

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      consumerDocument.uri
    );
    assert.ok(codeLenses.some((lens) => lens.command?.title.includes("1 referenced workspace class")),
      "the current template must show its referenced workspace classes");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (topologyRoot) {
      try {
        await vscode.workspace.fs.delete(topologyRoot, { recursive: true, useTrash: false });
      } catch {
        // The test may fail before creating its temporary workspace folder.
      }
    }
  }
}

function completionLabel(item: vscode.CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.fail(message);
}
