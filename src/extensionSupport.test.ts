import assert from "node:assert/strict";
import {
  COMPLETION_TRIGGER_CHARACTERS,
  DIRECTIVE_VALUE_TRIGGER_CHARACTERS,
  directiveValueContextAt,
  isTxtJetPath,
  selectedTargetLanguageId,
  shouldOfferMarkerCompletions
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
assert.equal(isTxtJetPath("/workspace/EXAMPLE.TXTJET"), true);
assert.equal(isTxtJetPath("/workspace/example.txt"), false);
assert.equal(isTxtJetPath("vscode-remote://ssh-remote+host/workspace/example.txtjet"), true);

assert.equal(selectedTargetLanguageId("txtjet-html", "txtjet-java"), "txtjet-html");
assert.equal(selectedTargetLanguageId("txtjet", "txtjet-python"), "txtjet");
assert.equal(selectedTargetLanguageId("plaintext", "txtjet-python"), "txtjet-python");

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
