import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const contributes = manifest.contributes;
const languages = contributes.languages.map((language: { id: string }) => language.id);
const grammars = new Map(contributes.grammars.filter((grammar: { language?: string }) => grammar.language).map((grammar: { language: string; path: string }) => [grammar.language, grammar.path]));
const snippets = new Map(contributes.snippets.map((snippet: { language: string; path: string }) => [snippet.language, snippet.path]));
const activationEvents = new Set(manifest.activationEvents);
const commandPaletteCommands = new Set(contributes.menus.commandPalette.map((item: { command: string }) => item.command));
const editorContextCommands = contributes.menus["editor/context"].map((item: { command: string }) => item.command);
const contributedCommands = new Set(contributes.commands.map((command: { command: string }) => command.command));
const commandContributions = new Map<string, { command: string; enablement?: string }>(
  contributes.commands.map((command: { command: string; enablement?: string }) => [command.command, command])
);
const untrustedWorkspaces = manifest.capabilities?.untrustedWorkspaces;

const expectedLanguages = [
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python",
  "txtjet-latex"
];

assert.deepEqual(languages, expectedLanguages);
assert.deepEqual(editorContextCommands, [
  "txtjet.selectTargetLanguage",
  "txtjet.openGeneratedOutputPreview"
]);
assert.equal(untrustedWorkspaces?.supported, "limited");
assert.deepEqual(untrustedWorkspaces?.restrictedConfigurations, [
  "txtjet.compiler.command",
  "txtjet.diagnostics.compiler.runOnSave",
  "txtjet.resolution.includePaths",
  "txtjet.resolution.skeletonPaths",
  "txtjet.generation.outputDirectory",
  "txtjet.ipxact.validation.command",
  "txtjet.ipxact.validation.runOnSave",
  "txtjet.ipxact.outputDirectory"
]);
for (const command of [
  "txtjet.compileTemplate",
  "txtjet.validateWithCompiler",
  "txtjet.validateWorkspaceTemplates",
  "txtjet.validateIpxact"
]) {
  assert.equal(commandContributions.get(command)?.enablement, "isWorkspaceTrusted", `${command} must require Workspace Trust`);
}

for (const language of expectedLanguages) {
  assert.ok(grammars.has(language), `${language} grammar missing`);
  assert.ok(existsSync(String(grammars.get(language)).replace("./", "")), `${language} grammar path missing`);
  assert.equal(snippets.get(language), "./snippets/txtjet.code-snippets", `${language} snippets missing`);
  assert.ok(activationEvents.has(`onLanguage:${language}`), `${language} activation missing`);
}

assert.deepEqual(contributes.languages[0].extensions, [
  ".txtjet",
  ".jet",
  ".javajet",
  ".htmljet",
  ".xmljet",
  ".cjet",
  ".pythonjet",
  ".texjet",
  ".latexjet",
  ".propertiesjet",
  ".jetinc"
]);

for (const command of contributedCommands) {
  if (command !== "txtjet.clearLanguage.all") {
    assert.ok(commandPaletteCommands.has(command), `${command} palette entry missing`);
  }
  assert.ok(activationEvents.has(`onCommand:${command}`), `${command} activation missing`);
}
for (const command of contributes.commands as Array<{ command: string; title: string; category?: string }>) {
  assert.equal(
    Boolean(command.category && command.title.startsWith(`${command.category}:`)),
    false,
    `${command.command} must not duplicate its category in the Command Palette label`
  );
}

assert.ok(contributes.configuration.properties["txtjet.diagnostics.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.autoDetect.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.defaultTargetLanguage"]);
assert.ok(contributes.configuration.properties["txtjet.diagnostics.generatedJava.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.diagnostics.compiler.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.diagnostics.compiler.runOnSave"]);
assert.ok(contributes.configuration.properties["txtjet.diagnostics.compiler.problemMatcher"]);
assert.ok(contributes.configuration.properties["txtjet.codeActions.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.completions.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.javaIntelliSense.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.statusBar.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.previews.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.previews.openBeside"]);
assert.ok(contributes.configuration.properties["txtjet.previews.generatedJava.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.previews.synchronizedReveal.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.navigation.includeDefinitions.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.resolution.includePaths"]);
assert.ok(contributes.configuration.properties["txtjet.resolution.skeletonPaths"]);
assert.ok(contributes.configuration.properties["txtjet.formatting.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.visualDifferentiation.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.generation.outputDirectory"]);
assert.ok(contributes.configuration.properties["txtjet.compiler.command"]);
assert.ok(contributes.configuration.properties["txtjet.compiler.timeoutMs"]);
assert.ok(contributes.configuration.properties["txtjet.completions.directiveMetadata"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.templateGlobs"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.outputDirectory"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.generation.autoOpen"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.validation.command"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.validation.problemMatcher"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.validation.runOnSave"]);
assert.ok(contributes.configuration.properties["txtjet.ipxact.validation.timeoutMs"]);
assert.equal(manifest.displayName, "JetForge — TxtJet & Eclipse JET");
assert.ok(contributes.views.explorer.some((view: { id: string; name: string }) => view.id === "txtjetWorkspace" && view.name === "JetForge Workspace"));
assert.ok(contributes.viewsWelcome.some((welcome: { view: string; contents: string }) =>
  welcome.view === "txtjetWorkspace" && welcome.contents.includes("txtjet.openGettingStarted")
));
const gettingStarted = contributes.walkthroughs.find((walkthrough: { id: string }) => walkthrough.id === "jetforge.gettingStarted");
assert.ok(gettingStarted);
assert.ok(gettingStarted.steps.length >= 5);
for (const step of gettingStarted.steps as Array<{ id: string; media?: { markdown?: string } }>) {
  assert.equal(typeof step.media?.markdown, "string", `${step.id} must contribute VS Code 1.85-compatible media`);
  assert.ok(existsSync(step.media!.markdown!), `${step.id} walkthrough media must be packaged from an existing file`);
}

for (const setting of [
  "txtjet.resolution.includePaths",
  "txtjet.resolution.skeletonPaths",
  "txtjet.generation.outputDirectory",
  "txtjet.compiler.command",
  "txtjet.diagnostics.compiler.problemMatcher",
  "txtjet.ipxact.enabled",
  "txtjet.ipxact.templateGlobs",
  "txtjet.ipxact.outputDirectory",
  "txtjet.ipxact.validation.command"
]) {
  assert.equal(contributes.configuration.properties[setting]?.scope, "resource", `${setting} must support folder-scoped configuration`);
}
assert.ok(contributedCommands.has("txtjet.toggleVisualDifferentiation"));
assert.ok(commandPaletteCommands.has("txtjet.toggleVisualDifferentiation"));
assert.ok(activationEvents.has("onCommand:txtjet.toggleVisualDifferentiation"));

for (const item of contributes.menus.commandPalette as Array<{ command: string; when?: string }>) {
  if (item.when?.includes("resourceExtname")) {
    assert.ok(item.when.includes("jetinc"), `${item.command} palette entry omits .jetinc`);
    assert.ok(item.when.includes("propertiesjet"), `${item.command} palette entry omits .propertiesjet`);
  }
}

for (const command of [
  "txtjet.openGeneratedOutputPreview",
  "txtjet.openGeneratedJavaPreview",
  "txtjet.openPreviewBesideSource",
  "txtjet.openRegionInGeneratedPreview",
  "txtjet.openRegionInJavaPreview",
  "txtjet.revealPreviewFromSource",
  "txtjet.revealSourceFromPreview",
  "txtjet.generateOutput",
  "txtjet.diffLastGeneratedOutput",
  "txtjet.compileTemplate",
  "txtjet.validateWithCompiler",
  "txtjet.refreshWorkspaceModel",
  "txtjet.openIncludingTemplate",
  "txtjet.openGeneratedJavaForTemplate",
  "txtjet.validateWorkspaceTemplates",
  "txtjet.showImpactGraph",
  "txtjet.extractSelectionToInclude",
  "txtjet.renameWorkspaceReference",
  "txtjet.openIpxactPreview",
  "txtjet.generateIpxactOutput",
  "txtjet.diffIpxactOutput",
  "txtjet.validateIpxact",
  "txtjet.openIpxactTemplate",
  "txtjet.openSynchronizedPreview",
  "txtjet.togglePreviewSynchronization",
  "txtjet.openGettingStarted",
  "txtjet.setupCompilerToolchain",
  "txtjet.openGeneratedOutputForTemplate"
]) {
  assert.ok(contributedCommands.has(command), `${command} command missing`);
  assert.ok(commandPaletteCommands.has(command), `${command} palette entry missing`);
  assert.ok(activationEvents.has(`onCommand:${command}`), `${command} activation missing`);
}
for (const command of [
  "txtjet.openIpxactPreview",
  "txtjet.generateIpxactOutput",
  "txtjet.diffIpxactOutput",
  "txtjet.validateIpxact"
]) {
  const paletteEntry = (contributes.menus.commandPalette as Array<{ command: string; when?: string }>).find((item) => item.command === command);
  assert.ok(paletteEntry?.when?.includes("config.txtjet.ipxact.enabled"), `${command} must be hidden unless IP-XACT is enabled`);
}
const ipxactTemplatePaletteEntry = (contributes.menus.commandPalette as Array<{ command: string; when?: string }>)
  .find((item) => item.command === "txtjet.openIpxactTemplate");
assert.equal(ipxactTemplatePaletteEntry?.when, undefined, "workspace-wide IP-XACT navigation must not use unscoped configuration gating");
const ipxactTemplateViewEntry = (contributes.menus["view/title"] as Array<{ command: string; when?: string }>)
  .find((item) => item.command === "txtjet.openIpxactTemplate");
assert.equal(ipxactTemplateViewEntry?.when, "view == txtjetWorkspace", "IP-XACT workspace navigation must remain available in multi-root views");
assert.ok(activationEvents.has("onView:txtjetWorkspace"));

console.log("manifest tests ok");
