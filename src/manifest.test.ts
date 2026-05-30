import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const contributes = manifest.contributes;
const languages = contributes.languages.map((language: { id: string }) => language.id);
const grammars = new Map(contributes.grammars.filter((grammar: { language?: string }) => grammar.language).map((grammar: { language: string; path: string }) => [grammar.language, grammar.path]));
const snippets = new Map(contributes.snippets.map((snippet: { language: string; path: string }) => [snippet.language, snippet.path]));
const activationEvents = new Set(manifest.activationEvents);
const commandPaletteCommands = new Set(contributes.menus.commandPalette.map((item: { command: string }) => item.command));
const contributedCommands = new Set(contributes.commands.map((command: { command: string }) => command.command));

const expectedLanguages = [
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python"
];

assert.deepEqual(languages, expectedLanguages);

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
  ".pythonjet"
]);

for (const command of contributedCommands) {
  if (command !== "txtjet.clearLanguage.all") {
    assert.ok(commandPaletteCommands.has(command), `${command} palette entry missing`);
  }
}

assert.ok(contributes.configuration.properties["txtjet.diagnostics.enabled"]);
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
assert.ok(contributes.configuration.properties["txtjet.navigation.includeDefinitions.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.resolution.includePaths"]);
assert.ok(contributes.configuration.properties["txtjet.resolution.skeletonPaths"]);
assert.ok(contributes.configuration.properties["txtjet.formatting.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.visualDifferentiation.enabled"]);
assert.ok(contributes.configuration.properties["txtjet.generation.outputDirectory"]);
assert.ok(contributedCommands.has("txtjet.toggleVisualDifferentiation"));
assert.ok(commandPaletteCommands.has("txtjet.toggleVisualDifferentiation"));
assert.ok(activationEvents.has("onCommand:txtjet.toggleVisualDifferentiation"));

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
  "txtjet.validateWithCompiler"
]) {
  assert.ok(contributedCommands.has(command), `${command} command missing`);
  assert.ok(commandPaletteCommands.has(command), `${command} palette entry missing`);
  assert.ok(activationEvents.has(`onCommand:${command}`), `${command} activation missing`);
}

console.log("manifest tests ok");
