import assert from "node:assert/strict";
import {
  activeParameterIndex,
  innermostOpenParen,
  maskJavaCommentsAndStrings,
  signatureParameterCount
} from "./javaSyntax";

const java = [
  "call(\"ignored, text\", nested(1, 2), value); // trailing call(hidden)",
  "/* multi-line",
  "   ignoredCall() */",
  "char marker = ')';"
].join("\n");
const masked = maskJavaCommentsAndStrings(java);

assert.equal(masked.length, java.length);
assert.deepEqual(
  Array.from(masked.matchAll(/\n/g), (match) => match.index),
  Array.from(java.matchAll(/\n/g), (match) => match.index)
);
assert.equal(masked.includes("ignored"), false);
assert.equal(masked.includes("hidden"), false);
assert.equal(masked.includes("nested"), true);
assert.equal(masked.includes("marker"), true);

const invocation = "outer(first, nested(second, third), final";
assert.equal(innermostOpenParen(invocation, invocation.length), invocation.indexOf("("));
assert.equal(activeParameterIndex(invocation.slice(invocation.indexOf("(") + 1)), 2);

assert.equal(signatureParameterCount("void empty()"), 0);
assert.equal(signatureParameterCount("void simple(String value, int count)"), 2);
assert.equal(signatureParameterCount("void generic(Map<String, Integer> values, List<String> names)"), 2);
assert.equal(signatureParameterCount("void annotated(@Pair(left = 1, right = 2) String value, int count)"), 2);
assert.equal(signatureParameterCount('void quoted(@Named("left,right") String value)'), 1);

console.log("Java syntax tests ok");
