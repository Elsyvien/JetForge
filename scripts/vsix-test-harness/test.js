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
    const builtinRoot = resolve(workspaceRoot, "compatibility-projects", "builtin-compiler");
    assert.ok(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(builtinRoot)), "builtin fixture must be present in the initial workspace");
    const result = await vscode.commands.executeCommand("txtjet.evaluateBuiltinTarget", { root: builtinRoot, target: "component-demo", quiet: true });
    assert.ok(result?.ok, JSON.stringify(result));
    const expected = require("node:fs").readFileSync(resolve(builtinRoot, "golden", "component-demo.xml"), "utf8");
    assert.equal(result.output, expected, "installed runner must produce exact golden XML with the model and nested includes");
    assert.ok(require("node:fs").existsSync(resolve(extension.extensionPath, "runtime", "jetforge-runtime.jar")), "the runner must come from the installed VSIX");
    if (process.platform === "win32") {
      const configDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(resolve(builtinRoot, ".JETFORGE.JSON")));
      const templateDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(resolve(builtinRoot, "templates", "COMPONENT.XMLJET")));
      const originalConfig = configDocument.getText();
      const originalTemplate = templateDocument.getText();
      const replaceDocument = async (document, text) => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
        assert.equal(await vscode.workspace.applyEdit(edit), true);
      };
      try {
        const config = JSON.parse(originalConfig);
        config.targets[0].name = "windows-live";
        config.targets[0].template = "TEMPLATES/COMPONENT.XMLJET";
        for (const test of config.tests) if (test.target === "component-demo") test.target = "windows-live";
        await replaceDocument(configDocument, JSON.stringify(config));
        await replaceDocument(templateDocument, originalTemplate + "Windows live buffer");
        await vscode.window.showTextDocument(templateDocument);
        await vscode.commands.executeCommand("txtjet.openGeneratedJavaPreview");
        assert.match(vscode.window.activeTextEditor.document.getText(), /generate\(Object argument\)/, "case variants must identify a configured builtin template");
        const liveResult = await vscode.commands.executeCommand("txtjet.evaluateBuiltinTarget", { root: builtinRoot, target: "windows-live", quiet: true });
        assert.ok(liveResult?.ok, JSON.stringify(liveResult));
        assert.equal(liveResult.output, expected + "Windows live buffer", "Windows file aliases must use the unsaved configuration and template buffers");
      } finally {
        await replaceDocument(configDocument, originalConfig);
        await replaceDocument(templateDocument, originalTemplate);
        await configDocument.save();
        await templateDocument.save();
      }
    }
    if (process.env.TXTJET_VSIX_TEST_SUCCESS_PATH) require("node:fs").writeFileSync(process.env.TXTJET_VSIX_TEST_SUCCESS_PATH, JSON.stringify({ complete: true, builtin: true }));
    console.log("Installed VSIX assertions passed, including packaged Java runner execution.");
  } catch (error) {
    if (process.env.TXTJET_VSIX_TEST_ERROR_PATH) require("node:fs").writeFileSync(process.env.TXTJET_VSIX_TEST_ERROR_PATH, error.stack || String(error));
    throw error;
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
}

module.exports = { run };
