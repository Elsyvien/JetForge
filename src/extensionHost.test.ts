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
  let workspaceConfiguration: vscode.WorkspaceConfiguration | undefined;
  let compilerConfiguration: vscode.WorkspaceConfiguration | undefined;
  let previousIpxactEnabled: unknown;
  let previousSchemaPaths: unknown;
  let previousCompilerCommand: unknown;
  let previousGenerationOutputDirectory: unknown;
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

    const ipxactSchema = vscode.Uri.joinPath(topologyRoot, "ieee1685-mini.xsd");
    const ipxactTemplate = vscode.Uri.joinPath(topologyRoot, "component.ipxact.txtjet");
    const ipxactAttributeTemplate = vscode.Uri.joinPath(topologyRoot, "component-attribute.ipxact.txtjet");
    const ipxactForbiddenTemplate = vscode.Uri.joinPath(topologyRoot, "component-forbidden.ipxact.txtjet");
    await vscode.workspace.fs.writeFile(ipxactSchema, Buffer.from(minimalIpxactSchema(), "utf8"));
    await vscode.workspace.fs.writeFile(
      ipxactTemplate,
      Buffer.from('<%@ jet ipxact="true" %>\n<component>\n  <name>demo.component</name>\n  <mem\n</component>\n', "utf8")
    );
    await vscode.workspace.fs.writeFile(
      ipxactAttributeTemplate,
      Buffer.from('<%@ jet ipxact="true" %>\n<component ver', "utf8")
    );
    await vscode.workspace.fs.writeFile(
      ipxactForbiddenTemplate,
      Buffer.from('<%@ jet ipxact="true" %>\n<component>\n  <bus', "utf8")
    );
    workspaceConfiguration = vscode.workspace.getConfiguration("txtjet", ipxactTemplate);
    previousIpxactEnabled = workspaceConfiguration.inspect("ipxact.enabled")?.workspaceFolderValue;
    previousSchemaPaths = workspaceConfiguration.inspect("ipxact.schemaPaths")?.workspaceFolderValue;
    await workspaceConfiguration.update("ipxact.enabled", true, vscode.ConfigurationTarget.WorkspaceFolder);
    await workspaceConfiguration.update("ipxact.schemaPaths", [ipxactSchema.fsPath], vscode.ConfigurationTarget.WorkspaceFolder);

    const ipxactDocument = await vscode.workspace.openTextDocument(ipxactTemplate);
    await vscode.window.showTextDocument(ipxactDocument);
    const memoryPrefixOffset = ipxactDocument.getText().indexOf("<mem") + "<mem".length;
    const schemaCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      ipxactDocument.uri,
      ipxactDocument.positionAt(memoryPrefixOffset)
    );
    assert.ok(schemaCompletions.items.some((item) =>
      completionLabel(item) === "memoryMaps" && item.detail?.includes("IP-XACT schema element")
    ), "IP-XACT completion must use permitted children from the configured schema");

    const attributeDocument = await vscode.workspace.openTextDocument(ipxactAttributeTemplate);
    await vscode.window.showTextDocument(attributeDocument);
    const attributeCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      attributeDocument.uri,
      attributeDocument.positionAt(attributeDocument.getText().length)
    );
    assert.ok(attributeCompletions.items.some((item) =>
      completionLabel(item) === "version" && item.detail?.includes("required")
    ), "IP-XACT completion must offer schema-declared attributes");

    const forbiddenDocument = await vscode.workspace.openTextDocument(ipxactForbiddenTemplate);
    await vscode.window.showTextDocument(forbiddenDocument);
    const forbiddenCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      forbiddenDocument.uri,
      forbiddenDocument.positionAt(forbiddenDocument.getText().length)
    );
    assert.equal(forbiddenCompletions.items.some((item) => completionLabel(item) === "busInterface"), false,
      "configured schema completions must not fall back to children forbidden by the parent type");

    await vscode.window.showTextDocument(ipxactDocument);
    const componentOffset = ipxactDocument.getText().indexOf("<component") + 2;
    const schemaDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      ipxactDocument.uri,
      ipxactDocument.positionAt(componentOffset)
    );
    assert.ok(schemaDefinitions.some((location) => location.uri.fsPath === ipxactSchema.fsPath),
      "IP-XACT Go to Definition must open the configured XSD declaration");
    const schemaHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      ipxactDocument.uri,
      ipxactDocument.positionAt(componentOffset)
    );
    assert.ok(schemaHovers.some((hover) => hoverText(hover).includes("Top-level IP-XACT component")),
      "IP-XACT hover must show schema documentation");

    await vscode.commands.executeCommand("txtjet.openIpxactPreview");
    const ipxactPreview = vscode.window.activeTextEditor?.document;
    assert.ok(ipxactPreview, "the IP-XACT preview command must open an editor");
    assert.equal(ipxactPreview.uri.scheme, "txtjet-preview-ipxact");
    const previewComponentOffset = ipxactPreview.getText().indexOf("<component") + 2;
    assert.ok(previewComponentOffset >= 2, "IP-XACT preview must contain the component element");
    const previewSchemaDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      ipxactPreview.uri,
      ipxactPreview.positionAt(previewComponentOffset)
    );
    assert.ok(previewSchemaDefinitions.some((location) => location.uri.fsPath === ipxactSchema.fsPath),
      "IP-XACT preview Go to Definition must open the configured XSD declaration");
    const previewSchemaHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      ipxactPreview.uri,
      ipxactPreview.positionAt(previewComponentOffset)
    );
    assert.ok(previewSchemaHovers.some((hover) => hoverText(hover).includes("Top-level IP-XACT component")),
      "IP-XACT preview hover must show schema documentation");
    const structureSymbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
      "vscode.executeDocumentSymbolProvider",
      ipxactPreview.uri
    );
    assert.ok(structureSymbols.some((symbol) => symbol.name === "Component: demo.component"),
      "IP-XACT preview outline must expose named generated structures");

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
    if (workspaceConfiguration) {
      await workspaceConfiguration.update("ipxact.enabled", previousIpxactEnabled, vscode.ConfigurationTarget.WorkspaceFolder);
      await workspaceConfiguration.update("ipxact.schemaPaths", previousSchemaPaths, vscode.ConfigurationTarget.WorkspaceFolder);
    }
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

function minimalIpxactSchema(): string {
  return `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="component" type="componentType">
    <xs:annotation><xs:documentation>Top-level IP-XACT component.</xs:documentation></xs:annotation>
  </xs:element>
  <xs:complexType name="componentType">
    <xs:sequence>
      <xs:element name="memoryMaps" type="xs:string"/>
    </xs:sequence>
    <xs:attribute name="version" type="xs:string" use="required"/>
  </xs:complexType>
</xs:schema>`;
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
