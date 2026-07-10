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
  "txtjet-python"
];

export async function run(): Promise<void> {
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

    const extensionRoot = resolve(__dirname, "..");
    const sourceUri = vscode.Uri.file(resolve(extensionRoot, "examples", "sample-java.txtjet"));
    const sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
    await vscode.window.showTextDocument(sourceDocument);

    await vscode.commands.executeCommand("txtjet.openGeneratedOutputPreview");

    const previewDocument = vscode.window.activeTextEditor?.document;
    assert.ok(previewDocument, "the generated-output preview command must open an editor");
    assert.equal(previewDocument.uri.scheme, "txtjet-preview-output");
    assert.ok(previewDocument.getText().length > 0, "the generated-output preview must not be empty");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
}
