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
