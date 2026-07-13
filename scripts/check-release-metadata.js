const { existsSync, readFileSync } = require("node:fs");
const { basename, resolve } = require("node:path");

function fail(message) {
  throw new Error(`Release metadata check failed: ${message}`);
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} requires a value`);
  }
  return value;
}

const root = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lockfile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const read = (file) => readFileSync(resolve(root, file), "utf8").replace(/\r\n?/g, "\n");
const version = manifest.version;
const extensionId = `${manifest.publisher}.${manifest.name}`;
const expectedVsix = `${manifest.name}-${version}.vsix`;
const versionExpression = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireOnlyCurrentReferences(file, label, pattern) {
  const references = [...read(file).matchAll(pattern)].map((match) => match[1]);
  if (references.length === 0) {
    fail(`${file} must reference the current ${label} ${version}`);
  }
  const stale = [...new Set(references.filter((reference) => reference !== version))];
  if (stale.length > 0) {
    fail(`${file} contains stale ${label} version references: ${stale.join(", ")}`);
  }
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version is not a supported semantic version: ${version}`);
}
if (lockfile.version !== version || lockfile.packages?.[""]?.version !== version) {
  fail(`package-lock.json versions must both equal ${version}`);
}
if (!read("CHANGELOG.md").startsWith(`# Changelog\n\n## ${version}\n`)) {
  fail(`CHANGELOG.md must start with a ${version} release section`);
}
const vsixReference = new RegExp(`${escapeRegExp(manifest.name)}-(${versionExpression})\\.vsix`, "g");
const installedReference = new RegExp(`${escapeRegExp(extensionId)}@(${versionExpression})`, "g");
requireOnlyCurrentReferences("README.md", "VSIX", vsixReference);
requireOnlyCurrentReferences("docs/QA_CHECKLIST.md", "VSIX", vsixReference);
requireOnlyCurrentReferences("docs/QA_CHECKLIST.md", "installed extension", installedReference);

const tag = requiredArgument("--tag");
if (tag && tag !== `v${version}`) {
  fail(`tag ${tag} does not match package version v${version}`);
}

const vsixPath = requiredArgument("--vsix");
if (vsixPath) {
  const absoluteVsixPath = resolve(vsixPath);
  if (!existsSync(absoluteVsixPath)) {
    fail(`VSIX does not exist: ${absoluteVsixPath}`);
  }
  if (basename(absoluteVsixPath) !== expectedVsix) {
    fail(`VSIX must be named ${expectedVsix}, received ${basename(absoluteVsixPath)}`);
  }
}

console.log(`release metadata ok: ${extensionId}@${version}`);
