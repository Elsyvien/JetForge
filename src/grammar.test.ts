import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const grammarDir = "syntaxes";
const grammarFiles = readdirSync(grammarDir).filter((file) => file.endsWith(".json"));

for (const file of grammarFiles) {
  JSON.parse(readFileSync(join(grammarDir, file), "utf8"));
}

const injection = JSON.parse(readFileSync(join(grammarDir, "txtjet-expression.injection.tmLanguage.json"), "utf8"));
const begins = collectBeginPatterns(injection);
const names = collectNames(injection);

assert.match(injection.injectionSelector, /string\.quoted/);
assert.match(injection.injectionSelector, /meta\.preprocessor/);
assert.match(injection.injectionSelector, /comment/);
assert.ok(begins.includes("(<%@)\\s*([A-Za-z_][\\w.-]*)?"), "directive injection missing");
assert.ok(begins.includes("(<%=)"), "expression injection missing");
assert.ok(begins.includes("(<%!)"), "declaration injection missing");
assert.ok(begins.includes("(<%)"), "scriptlet injection missing");
assert.ok(names.some((name) => name.includes("punctuation.definition.template.begin.txtjet")), "marker begin scope missing");
assert.ok(names.some((name) => name.includes("entity.name.directive.txtjet")), "directive name scope missing");
assert.ok(names.some((name) => name.includes("meta.directive.attribute.txtjet")), "directive attribute scope missing");
assert.ok(names.some((name) => name.includes("string.quoted.double.directive.txtjet")), "directive double-string scope missing");

assertGrammarEmbeds("txtjet-html.tmLanguage.json", "text.html.basic");
assertGrammarEmbeds("txtjet-xml.tmLanguage.json", "text.xml");
assertGrammarEmbeds("txtjet-java.tmLanguage.json", "source.java");
assertGrammarEmbeds("txtjet-c.tmLanguage.json", "source.c");
assertGrammarEmbeds("txtjet-python.tmLanguage.json", "source.python");
assertTemplateBeforeHostLanguage("txtjet-html.tmLanguage.json", "text.html.basic");
assertTemplateBeforeHostLanguage("txtjet-xml.tmLanguage.json", "text.xml");

console.log("grammar tests ok");

function collectBeginPatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectBeginPatterns);
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const ownBegin = typeof record.begin === "string" ? [record.begin] : [];
  return ownBegin.concat(Object.values(record).flatMap(collectBeginPatterns));
}

function collectNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectNames);
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const ownName = typeof record.name === "string" ? [record.name] : [];
  return ownName.concat(Object.values(record).flatMap(collectNames));
}

function collectIncludes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectIncludes);
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const ownInclude = typeof record.include === "string" ? [record.include] : [];
  return ownInclude.concat(Object.values(record).flatMap(collectIncludes));
}

function assertGrammarEmbeds(file: string, hostLanguage: string): void {
  const grammar = JSON.parse(readFileSync(join(grammarDir, file), "utf8"));
  const includes = collectIncludes(grammar);
  const grammarNames = collectNames(grammar);
  assert.ok(includes.includes(hostLanguage), `${file} should include ${hostLanguage}`);
  assert.ok(includes.includes("source.java"), `${file} should include embedded Java`);
  assert.ok(grammarNames.some((name) => name.includes("punctuation.definition.template.begin.txtjet")), `${file} marker scope missing`);
  assert.ok(grammarNames.some((name) => name.includes("entity.name.directive.txtjet")), `${file} directive name scope missing`);
}

function assertTemplateBeforeHostLanguage(file: string, hostLanguage: string): void {
  const grammar = JSON.parse(readFileSync(join(grammarDir, file), "utf8"));
  const patterns = grammar.patterns as Array<{ include?: string }>;
  assert.equal(patterns[0]?.include, "#txtjet-template", `${file} should check TxtJet blocks before ${hostLanguage}`);
  assert.equal(patterns[1]?.include, hostLanguage, `${file} host language include missing`);
}
