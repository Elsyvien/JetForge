const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const vscode = require("vscode");

async function run() {
  try {
    const extensionId = process.env.TXTJET_EXPECTED_EXTENSION_ID;
    const expectedVersion = process.env.TXTJET_EXPECTED_VERSION;
    const workspaceRoot = process.env.TXTJET_TEST_WORKSPACE;
    assert.ok(extensionId && expectedVersion && workspaceRoot, "installed VSIX test environment is incomplete");

    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, `${extensionId} must be discoverable after VSIX installation`);
    assert.equal(extension.packageJSON.version, expectedVersion, `${extensionId} version must match the packaged artifact`);
    await extension.activate();
    assert.equal(extension.isActive, true, `${extensionId} must activate from the installed VSIX`);

    const registeredCommands = new Set(await vscode.commands.getCommands(true));
    for (const contribution of extension.packageJSON.contributes.commands) {
      assert.ok(registeredCommands.has(contribution.command), `installed command must register: ${contribution.command}`);
    }

    const sourceUri = vscode.Uri.file(resolve(workspaceRoot, "examples", "sample-java.txtjet"));
    const sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
    await vscode.window.showTextDocument(sourceDocument);
    await vscode.commands.executeCommand("txtjet.openGeneratedOutputPreview");

    const previewDocument = vscode.window.activeTextEditor?.document;
    assert.ok(previewDocument, "installed extension must open a generated-output preview");
    assert.equal(previewDocument.uri.scheme, "txtjet-preview-output");
    assert.ok(previewDocument.getText().length > 0, "installed extension preview must not be empty");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
}

module.exports = { run };
