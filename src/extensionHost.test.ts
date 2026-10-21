import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vscode from "vscode";
import { BuiltinTargetResult } from "./builtinProject";

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
  let compilerConfiguration: vscode.WorkspaceConfiguration | undefined;
  let previousCompilerCommand: unknown;
  let previousGenerationOutputDirectory: unknown;
  try {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} must be discoverable in the extension host`);

    await extension.activate();
    assert.equal(extension.isActive, true, `${EXTENSION_ID} must activate successfully`);
    assert.ok(!(await vscode.commands.getCommands(true)).some((command) => /^txtjet\..*ipxact/i.test(command)),
      "removed domain commands must not be registered in the extension host");

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

    await vscode.commands.executeCommand("txtjet.validateHeadlessWorkspace");
    const headlessValidation = vscode.window.activeTextEditor?.document;
    assert.ok(headlessValidation, "headless workspace validation must open a report");
    assert.match(headlessValidation.getText(), /JetForge validation passed: 4 templates, 0 issues/,
      "headless validation must use the checked-in compatibility project contract");
    await vscode.commands.executeCommand("txtjet.runWorkspaceDoctor");
    await vscode.commands.executeCommand("txtjet.runGoldenTests");

    await vscode.window.showTextDocument(sourceDocument);

    await vscode.commands.executeCommand("txtjet.openGeneratedOutputPreview");

    const previewDocument = vscode.window.activeTextEditor?.document;
    assert.ok(previewDocument, "the generated-output preview command must open an editor");
    assert.equal(previewDocument.uri.scheme, "txtjet-preview-output");
    assert.ok(previewDocument.getText().length > 0, "the generated-output preview must not be empty");
    const rootPreviewOffset = previewDocument.getText().indexOf("package generated.sample");
    assert.ok(rootPreviewOffset >= 0, "generated-output preview must contain root template text");
    const rootProvenanceHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      previewDocument.uri,
      previewDocument.positionAt(rootPreviewOffset)
    );
    assert.ok(rootProvenanceHovers.some((hover) => hoverText(hover).includes("Root template")),
      "generated preview hover must identify root-template provenance");
    const rootProvenanceDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      previewDocument.uri,
      previewDocument.positionAt(rootPreviewOffset)
    );
    assert.ok(rootProvenanceDefinitions.some((location) => location.uri.fsPath === sourceUri.fsPath),
      "generated preview definition must navigate back to the root template");
    const rootPreviewPosition = previewDocument.positionAt(rootPreviewOffset);
    assert.ok(vscode.window.activeTextEditor, "generated preview editor must remain active");
    vscode.window.activeTextEditor.selection = new vscode.Selection(rootPreviewPosition, rootPreviewPosition);
    await vscode.commands.executeCommand("txtjet.showPreviewLineSource");
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, sourceUri.fsPath,
      "Show Source for This Output Line must open the primary provenance source");

    await vscode.window.showTextDocument(sourceDocument);
    await vscode.commands.executeCommand("txtjet.openGeneratedOutputForTemplate");
    const workspaceOutputPreview = vscode.window.activeTextEditor?.document;
    assert.ok(workspaceOutputPreview, "the workspace generated-output command must open an editor");
    assert.equal(workspaceOutputPreview.uri.scheme, "txtjet-preview-output");
    assert.ok(workspaceOutputPreview.getText().length > 0, "the workspace generated-output preview must not be empty");

    const skeletonSourceUri = vscode.Uri.file(resolve(extensionRoot, "examples", "skeleton-directive.txtjet"));
    const skeletonSourceDocument = await vscode.workspace.openTextDocument(skeletonSourceUri);
    await vscode.window.showTextDocument(skeletonSourceDocument);
    await vscode.commands.executeCommand("txtjet.openGeneratedJavaPreview");
    const skeletonPreview = vscode.window.activeTextEditor?.document;
    assert.ok(skeletonPreview, "the generated-Java preview command must open an editor");
    assert.equal(skeletonPreview.uri.scheme, "txtjet-preview-java");
    const skeletonOffset = skeletonPreview.getText().indexOf("public final class SkeletonSample");
    assert.ok(skeletonOffset >= 0, "generated-Java preview must render the configured skeleton");
    const skeletonHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      skeletonPreview.uri,
      skeletonPreview.positionAt(skeletonOffset)
    );
    assert.ok(skeletonHovers.some((hover) => hoverText(hover).includes("Skeleton token or layout")),
      "generated-Java preview hover must identify skeleton provenance");
    const skeletonDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      skeletonPreview.uri,
      skeletonPreview.positionAt(skeletonOffset)
    );
    assert.ok(skeletonDefinitions.some((location) => location.uri.fsPath.endsWith("examples/templates/base.skeleton")),
      "generated-Java preview definition must open the contributing skeleton");

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
    const includeOffset = topologyPreview.getText().indexOf(resolvedMarker);
    const includeHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      topologyPreview.uri,
      topologyPreview.positionAt(includeOffset)
    );
    assert.ok(includeHovers.some((hover) => hoverText(hover).includes("Included template")),
      "expanded include preview hover must identify include provenance");
    const includeDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      topologyPreview.uri,
      topologyPreview.positionAt(includeOffset)
    );
    assert.ok(includeDefinitions.some((location) => location.uri.fsPath === topologyInclude.fsPath),
      "expanded include preview definition must open the contributing include");
    const includeMarkerOffset = topologyPreview.getText().indexOf("txtjet include begin");
    assert.ok(includeMarkerOffset >= 0, "expanded include preview must expose a begin marker");
    const includeMarkerDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      topologyPreview.uri,
      topologyPreview.positionAt(includeMarkerOffset)
    );
    assert.equal(includeMarkerDefinitions.length, 0,
      "include boundary markers without a deterministic source range must not fabricate offset-zero definitions");

    const compilerSource = vscode.Uri.joinPath(topologyRoot, "compiler-output.txtjet");
    await vscode.workspace.fs.writeFile(
      compilerSource,
      Buffer.from('<%@ jet package="host" class="CompilerOutput" %>\n<component>\n</component>\n', "utf8")
    );
    compilerConfiguration = vscode.workspace.getConfiguration("txtjet", compilerSource);
    previousCompilerCommand = compilerConfiguration.inspect("compiler.command")?.workspaceFolderValue;
    previousGenerationOutputDirectory = compilerConfiguration.inspect("generation.outputDirectory")?.workspaceFolderValue;
    const compilerOutputRoot = vscode.Uri.joinPath(topologyRoot, "compiler-generated");
    await compilerConfiguration.update(
      "compiler.command",
      'node -e "const fs=require(\'node:fs\');const t=fs.readFileSync(process.argv[1],\'utf8\');fs.writeFileSync(process.argv[2],t+\'\\\\ncompiler-only\\\\n\')" ${file} ${outputFile}',
      vscode.ConfigurationTarget.WorkspaceFolder
    );
    await compilerConfiguration.update(
      "generation.outputDirectory",
      compilerOutputRoot.fsPath,
      vscode.ConfigurationTarget.WorkspaceFolder
    );
    const compilerSourceDocument = await vscode.workspace.openTextDocument(compilerSource);
    await vscode.window.showTextDocument(compilerSourceDocument);
    await vscode.commands.executeCommand("txtjet.compileTemplate");
    const compilerOutputDocument = vscode.window.activeTextEditor?.document;
    assert.ok(compilerOutputDocument, "external compile command must open its generated output");
    assert.equal(compilerOutputDocument.uri.scheme, "file");
    assert.notEqual(compilerOutputDocument.uri.fsPath, compilerSource.fsPath);
    const compilerRootOffset = compilerOutputDocument.getText().indexOf("<component>");
    const compilerOnlyOffset = compilerOutputDocument.getText().indexOf("compiler-only");
    assert.ok(compilerRootOffset >= 0 && compilerOnlyOffset >= 0, "compiler fixture output must contain mapped and compiler-only lines");
    const compilerRootHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      compilerOutputDocument.uri,
      compilerOutputDocument.positionAt(compilerRootOffset)
    );
    assert.ok(compilerRootHovers.some((hover) => hoverText(hover).includes("Root template")),
      "uniquely matching external compiler lines must inherit template provenance");
    const compilerOnlyHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      compilerOutputDocument.uri,
      compilerOutputDocument.positionAt(compilerOnlyOffset)
    );
    assert.ok(compilerOnlyHovers.some((hover) => hoverText(hover).includes("Unmapped generated/compiler output")),
      "compiler-only lines must remain visibly unmapped");
    const compilerDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      compilerOutputDocument.uri,
      compilerOutputDocument.positionAt(compilerRootOffset)
    );
    assert.ok(compilerDefinitions.some((location) => location.uri.fsPath === compilerSource.fsPath),
      "mapped compiler output must navigate back to its template");

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

    await vscode.window.showTextDocument(consumerDocument);
    await vscode.commands.executeCommand("txtjet.showImpactGraph");
    const builtinRoot = vscode.Uri.joinPath(topologyRoot!, "builtin");
    await vscode.workspace.fs.createDirectory(builtinRoot);
    const builtinTemplate = vscode.Uri.joinPath(builtinRoot, "main.xmljet");
    const builtinInclude = vscode.Uri.joinPath(builtinRoot, "tail.jetinc");
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(builtinRoot, ".jetforge.json"), Buffer.from(JSON.stringify({
      version: 2, sourcePaths: ["main.xmljet"], compiler: { backend: "builtin", dialect: "jetforge-v1" },
      targets: [{ name: "smoke", template: "main.xmljet", fixture: "model.json", output: "generated/result.xml" }]
    })));
    await vscode.workspace.fs.writeFile(builtinTemplate, Buffer.from('<%@ jet imports="java.util.Map" %><% Map<?,?> model=(Map<?,?>)argument; %><%= model.get("name") %><%@ include file="tail.jetinc" %>'));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(builtinRoot, "model.json"), Buffer.from('{"name":"Ada"}'));
    await vscode.workspace.fs.writeFile(builtinInclude, Buffer.from(" saved"));
    const includedDocument = await vscode.workspace.openTextDocument(builtinInclude);
    const replaceInclude = new vscode.WorkspaceEdit(); replaceInclude.replace(builtinInclude, new vscode.Range(includedDocument.positionAt(0), includedDocument.positionAt(includedDocument.getText().length)), " live");
    await vscode.workspace.applyEdit(replaceInclude);
    const argument = { root: builtinRoot.fsPath, target: "smoke", quiet: true };
    const compiledBuiltin = await vscode.commands.executeCommand<BuiltinTargetResult>("txtjet.compileBuiltinTarget", argument);
    assert.equal(compiledBuiltin.ok, true, JSON.stringify(compiledBuiltin)); assert.equal(compiledBuiltin.output, undefined);
    const evaluatedBuiltin = await vscode.commands.executeCommand<BuiltinTargetResult>("txtjet.evaluateBuiltinTarget", argument);
    assert.equal(evaluatedBuiltin.ok, true, JSON.stringify(evaluatedBuiltin)); assert.equal(evaluatedBuiltin.output, "Ada live", "builtin evaluation must prefer unsaved includes");
    await vscode.commands.executeCommand("txtjet.evaluateBuiltinTarget", { ...argument, quiet: false });
    assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, "jetforge-builtin-output", "builtin output must open as a read-only document");
    assert.equal(vscode.window.activeTextEditor?.document.getText(), "Ada live");
    const generatedBuiltin = await vscode.commands.executeCommand<BuiltinTargetResult>("txtjet.generateBuiltinTarget", argument);
    assert.equal(generatedBuiltin.ok, true);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(builtinRoot, "generated/result.xml"))).toString("utf8"), "Ada live");
    const sharedTemplate = vscode.Uri.joinPath(builtinRoot, "other.xmljet");
    await vscode.workspace.fs.writeFile(sharedTemplate, Buffer.from('<%@ include file="tail.jetinc" %>'));
    const builtinConfig = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(builtinRoot, ".jetforge.json"));
    const configValue = JSON.parse(builtinConfig.getText());
    configValue.sourcePaths.push("other.xmljet");
    configValue.targets.push({ name: "shared", template: "other.xmljet", output: "generated/shared.xml" });
    const replaceDocument = async (document: vscode.TextDocument, text: string): Promise<void> => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
      assert.equal(await vscode.workspace.applyEdit(edit), true);
    };
    await replaceDocument(builtinConfig, JSON.stringify(configValue));
    await replaceDocument(includedDocument, "<%= unknownSharedValue %>");
    const compilerDiagnostics = () => vscode.languages.getDiagnostics(builtinInclude).filter(diagnostic => diagnostic.source === "JetForge compiler");
    for (const target of ["smoke", "shared"]) {
      const failed = await vscode.commands.executeCommand<BuiltinTargetResult>("txtjet.compileBuiltinTarget", { ...argument, target });
      assert.equal(failed.ok, false);
    }
    assert.equal(compilerDiagnostics().length, 2, "each target contributes its own include diagnostic");
    const rootDocument = await vscode.workspace.openTextDocument(builtinTemplate);
    await replaceDocument(rootDocument, "valid root");
    const cleanRoot = await vscode.commands.executeCommand<BuiltinTargetResult>("txtjet.compileBuiltinTarget", argument);
    assert.equal(cleanRoot.ok, true);
    assert.equal(compilerDiagnostics().length, 1, "removed dependency diagnostics must clear without erasing another target's error");
    await replaceDocument(await vscode.workspace.openTextDocument(sharedTemplate), "valid shared root");
    const cleanShared = await vscode.commands.executeCommand<BuiltinTargetResult>("txtjet.compileBuiltinTarget", { ...argument, target: "shared" });
    assert.equal(cleanShared.ok, true);
    assert.equal(compilerDiagnostics().length, 0, "no diagnostics may remain after the last target removes the include");
    if (process.env.TXTJET_EXTENSION_TEST_SUCCESS_PATH) { writeFileSync(process.env.TXTJET_EXTENSION_TEST_SUCCESS_PATH, JSON.stringify({ complete: true, builtin: true })); }
  } finally {
    if (compilerConfiguration) {
      await compilerConfiguration.update("compiler.command", previousCompilerCommand, vscode.ConfigurationTarget.WorkspaceFolder);
      await compilerConfiguration.update("generation.outputDirectory", previousGenerationOutputDirectory, vscode.ConfigurationTarget.WorkspaceFolder);
    }
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

function hoverText(hover: vscode.Hover): string {
  return hover.contents.map((content) => typeof content === "string" ? content : content.value).join("\n");
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
