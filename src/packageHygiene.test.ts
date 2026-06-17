import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

const vsceBin = join("node_modules", "@vscode", "vsce", "vsce");
const packageText = execFileSync(process.execPath, [vsceBin, "ls", "--no-dependencies"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const files = packageText.trim().split(/\r?\n/).filter(Boolean);
const expectedRuntimeModules = readdirSync("src")
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => `out/${basename(file, ".ts")}.js`)
  .sort();

const forbidden = [
  /^\.DS_Store$/,
  /^\.playwright-cli\//,
  /^src\//,
  /^test-fixtures\//,
  /^node_modules\//,
  /^\.github\//,
  /^index\.html$/,
  /^styles\.css$/,
  /^script\.js$/,
  /^package-lock\.json$/,
  /^tsconfig\.json$/,
  /^out\/.*\.map$/,
  /^out\/.*\.test\.js$/,
  /^example\.txt$/,
  /^example\.txtjet$/,
  /^examples\/.*\.log$/,
  /^examples\/.*\.map$/,
  /^examples\/.*\.test\.js$/,
  /^examples\/.*\.vsix$/,
  /^examples\/private[-/]/,
  /^private-examples\//,
  /^.*\.vsix$/,
  /^.*\.log$/
];

const allowed = [
  /^package\.json$/,
  /^language-configuration\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^assets\/icon\.png$/,
  /^docs\/[A-Za-z0-9_-]+\.md$/,
  /^examples\/[A-Za-z0-9_.-]+\.txtjet$/,
  /^examples\/partials\/[A-Za-z0-9_.-]+\.txtjet$/,
  /^examples\/templates\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.skeleton$/,
  /^out\/[A-Za-z0-9_-]+\.js$/,
  /^snippets\/txtjet\.code-snippets$/,
  /^syntaxes\/[A-Za-z0-9_.-]+\.json$/
];

for (const pattern of forbidden) {
  assert.equal(files.some((file: string) => pattern.test(file)), false, `forbidden package path matched ${pattern}`);
}

for (const file of files) {
  assert.ok(allowed.some((pattern) => pattern.test(file)), `unexpected package path ${file}`);
}

assert.deepEqual(
  files.filter((file) => /^out\/[A-Za-z0-9_-]+\.js$/.test(file)).sort(),
  expectedRuntimeModules,
  "packaged runtime output must match current source modules"
);

assert.ok(files.includes("package.json"));
assert.ok(files.includes("README.md"));
assert.ok(files.includes("docs/INTELLISENSE_ROADMAP.md"));
assert.ok(files.includes("docs/QA_CHECKLIST.md"));
assert.ok(files.includes("out/extension.js"));
assert.ok(files.includes("syntaxes/txtjet.tmLanguage.json"));

console.log("package hygiene tests ok");
