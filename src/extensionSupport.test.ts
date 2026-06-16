import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPLETION_TRIGGER_CHARACTERS,
  compilerTimeoutMs,
  DEFAULT_COMPILER_TIMEOUT_MS,
  DIRECTIVE_VALUE_TRIGGER_CHARACTERS,
  MAX_COMPILER_TIMEOUT_MS,
  MIN_COMPILER_TIMEOUT_MS,
  directiveValueContextAt,
  isPathInsideAnyRoot,
  isTxtJetPath,
  selectedTargetLanguageId,
  shellSingleQuote,
  shouldOfferMarkerCompletions,
  stripTxtJetSuffix
} from "./extensionSupport";

assert.deepEqual(COMPLETION_TRIGGER_CHARACTERS, ["<"]);
assert.deepEqual(DIRECTIVE_VALUE_TRIGGER_CHARACTERS, ["\"", "'", "/", "\\", "."]);

assert.equal(shouldOfferMarkerCompletions("<"), true);
assert.equal(shouldOfferMarkerCompletions("prefix <"), true);
assert.equal(shouldOfferMarkerCompletions("prefix"), false);
assert.equal(shouldOfferMarkerCompletions("@"), false);
assert.equal(shouldOfferMarkerCompletions(" "), false);

assert.equal(isTxtJetPath("/workspace/example.txtjet"), true);
assert.equal(isTxtJetPath("/workspace/example.jet"), true);
assert.equal(isTxtJetPath("/workspace/example.javajet"), true);
assert.equal(isTxtJetPath("/workspace/example.htmljet"), true);
assert.equal(isTxtJetPath("/workspace/example.xmljet"), true);
assert.equal(isTxtJetPath("/workspace/example.cjet"), true);
assert.equal(isTxtJetPath("/workspace/example.pythonjet"), true);
assert.equal(isTxtJetPath("/workspace/example.propertiesjet"), true);
assert.equal(isTxtJetPath("/workspace/example.jetinc"), true);
assert.equal(isTxtJetPath("/workspace/EXAMPLE.TXTJET"), true);
assert.equal(isTxtJetPath("/workspace/example.txt"), false);
assert.equal(isTxtJetPath("vscode-remote://ssh-remote+host/workspace/example.txtjet"), true);

assert.equal(stripTxtJetSuffix("component.txtjet"), "component");
assert.equal(stripTxtJetSuffix("component.javajet"), "component");
assert.equal(stripTxtJetSuffix("component.propertiesjet"), "component");
assert.equal(stripTxtJetSuffix("component.jetinc"), "component");
assert.equal(stripTxtJetSuffix("component.TXTJET"), "component");
assert.equal(stripTxtJetSuffix("component.txt"), "component.txt");

assert.equal(isPathInsideAnyRoot("/workspace/templates/partial.txtjet", ["/workspace"]), true);
assert.equal(isPathInsideAnyRoot("/workspace-shared/partial.txtjet", ["/workspace"]), false);
assert.equal(isPathInsideAnyRoot("/outside/partial.txtjet", ["/workspace/templates"]), false);
if (process.platform !== "win32") {
  const pathSafetyRoot = mkdtempSync(join(tmpdir(), "txtjet-path-safety-"));
  const workspaceRoot = join(pathSafetyRoot, "workspace");
  const outsideRoot = join(pathSafetyRoot, "outside");
  mkdirSync(workspaceRoot);
  mkdirSync(outsideRoot);
  symlinkSync(outsideRoot, join(workspaceRoot, "linked"));
  assert.equal(isPathInsideAnyRoot(join(workspaceRoot, "linked", "partial.txtjet"), [workspaceRoot]), false);
  rmSync(pathSafetyRoot, { recursive: true, force: true });
}

assert.equal(selectedTargetLanguageId("txtjet-html", "txtjet-java"), "txtjet-html");
assert.equal(selectedTargetLanguageId("txtjet", "txtjet-python"), "txtjet");
assert.equal(selectedTargetLanguageId("plaintext", "txtjet-python"), "txtjet-python");

assert.equal(shellSingleQuote("/tmp/template.txtjet"), "'/tmp/template.txtjet'");
assert.equal(shellSingleQuote("/tmp/with spaces/$HOME/`name`.txtjet"), "'/tmp/with spaces/$HOME/`name`.txtjet'");
assert.equal(shellSingleQuote("/tmp/it's.txtjet"), "'/tmp/it'\\''s.txtjet'");

assert.equal(compilerTimeoutMs(undefined), DEFAULT_COMPILER_TIMEOUT_MS);
assert.equal(compilerTimeoutMs(Number.NaN), DEFAULT_COMPILER_TIMEOUT_MS);
assert.equal(compilerTimeoutMs(500), MIN_COMPILER_TIMEOUT_MS);
assert.equal(compilerTimeoutMs(12345.9), 12345);
assert.equal(compilerTimeoutMs(900000), MAX_COMPILER_TIMEOUT_MS);

const includeDirective = "<%@ include file=\"partials/head\" %>";
assert.deepEqual(directiveValueContextAt(includeDirective, includeDirective.indexOf("head") + 4), {
  directiveName: "include",
  attributeName: "file",
  value: "partials/head",
  valueRange: {
    start: includeDirective.indexOf("partials/head"),
    end: includeDirective.indexOf("partials/head") + "partials/head".length
  },
  quote: "\"",
  prefix: "partials/head"
});

const skeletonDirective = "<%@ jet class=\"Demo\" skeleton='templates/base' %>";
assert.deepEqual(directiveValueContextAt(skeletonDirective, skeletonDirective.indexOf("base") + 2), {
  directiveName: "jet",
  attributeName: "skeleton",
  value: "templates/base",
  valueRange: {
    start: skeletonDirective.indexOf("templates/base"),
    end: skeletonDirective.indexOf("templates/base") + "templates/base".length
  },
  quote: "'",
  prefix: "templates/ba"
});

assert.equal(directiveValueContextAt("<%@ include file=\"done\" %>", "<%@ include file=\"done\" %>".length), undefined);
assert.equal(directiveValueContextAt("<%= value %>", 4), undefined);

console.log("extension support tests ok");
