import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const packageText = execFileSync("npx", ["vsce", "ls", "--no-dependencies"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const files = packageText.trim().split(/\r?\n/).filter(Boolean);

const forbidden = [
  /^src\//,
  /^test-fixtures\//,
  /^node_modules\//,
  /^\.github\//,
  /^example\.txt$/,
  /^example\.txtjet$/,
  /^private-examples\//,
  /^.*\.vsix$/
];

for (const pattern of forbidden) {
  assert.equal(files.some((file: string) => pattern.test(file)), false, `forbidden package path matched ${pattern}`);
}

assert.ok(files.includes("package.json"));
assert.ok(files.includes("README.md"));
assert.ok(files.includes("docs/INTELLISENSE_ROADMAP.md"));
assert.ok(files.includes("docs/QA_CHECKLIST.md"));
assert.ok(files.includes("out/extension.js"));
assert.ok(files.includes("syntaxes/txtjet.tmLanguage.json"));

console.log("package hygiene tests ok");
