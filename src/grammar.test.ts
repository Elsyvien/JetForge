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

assert.match(injection.injectionSelector, /string\.quoted/);
assert.match(injection.injectionSelector, /meta\.preprocessor/);
assert.match(injection.injectionSelector, /comment/);
assert.ok(begins.includes("(<%@)\\s*([A-Za-z_][\\w.-]*)?"), "directive injection missing");
assert.ok(begins.includes("(<%=)"), "expression injection missing");
assert.ok(begins.includes("(<%!)"), "declaration injection missing");
assert.ok(begins.includes("(<%)"), "scriptlet injection missing");

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
