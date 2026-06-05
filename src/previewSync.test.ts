import assert from "node:assert/strict";
import { synchronizedPreviewRange } from "./previewSync";
import { buildGeneratedJavaPreview, buildGeneratedOutputPreview } from "./templateModel";

const template = [
  "<%@ jet %>",
  "hello",
  "<%",
  "run();",
  "%>",
  "<%= value %>"
].join("\n");

const output = buildGeneratedOutputPreview(template, "txtjet-xml");
const outerStart = template.indexOf("hello");
const outputRange = synchronizedPreviewRange(output.mappings, { start: outerStart, end: outerStart + 1 }, "source-to-preview");
assert.ok(outputRange);
assert.match(output.text.slice(outputRange.start, outputRange.end), /hello/);
const sourceRange = synchronizedPreviewRange(output.mappings, outputRange, "preview-to-source");
assert.ok(sourceRange);
assert.match(template.slice(sourceRange.start, sourceRange.end), /hello/);

const java = buildGeneratedJavaPreview(template);
const scriptletStart = template.indexOf("run();");
const javaRange = synchronizedPreviewRange(java.mappings, { start: scriptletStart, end: scriptletStart + 3 }, "source-to-preview");
assert.ok(javaRange);
assert.match(java.text.slice(javaRange.start, javaRange.end), /run\(\)/);

const directiveStart = template.indexOf("<%@");
assert.equal(synchronizedPreviewRange(output.mappings, { start: directiveStart, end: directiveStart + 1 }, "source-to-preview"), undefined);

console.log("preview sync tests ok");
