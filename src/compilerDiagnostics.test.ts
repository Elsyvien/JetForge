import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  DEFAULT_COMPILER_PROBLEM_MATCHER,
  mapCompilerProblemsToSource,
  parseCompilerProblems
} from "./compilerDiagnostics";
import { buildGeneratedJavaPreview } from "./templateModel";

const output = [
  "generated/sample.java:4:9: error: cannot find symbol",
  "generated/sample.java:5:13: warning: unchecked conversion",
  "generated/sample.java:6:1: plain message",
  "not a compiler diagnostic"
].join("\n");
const parsed = parseCompilerProblems(output, DEFAULT_COMPILER_PROBLEM_MATCHER);
assert.deepEqual(parsed.map((problem) => problem.severity), ["error", "warning", "warning"]);
assert.deepEqual(parsed.map((problem) => problem.message), [
  "cannot find symbol",
  "unchecked conversion",
  "plain message"
]);
assert.deepEqual(parseCompilerProblems("broken", "["), []);

const sourceFile = resolve("workspace", "template.txtjet");
const generatedFile = resolve("workspace", "generated", "sample.java");
const template = [
  "<%@ jet package=\"demo\" class=\"Sample\" %>",
  "<%",
  "missingCall();",
  "%>",
  "hello"
].join("\n");
const preview = buildGeneratedJavaPreview(template, sourceFile);
const previewLine = preview.text.slice(0, preview.text.indexOf("missingCall")).split("\n").length;
const mapped = mapCompilerProblemsToSource(
  [{
    file: join("generated", "sample.java"),
    line: previewLine,
    column: 1,
    severity: "error",
    message: "cannot find symbol"
  }],
  sourceFile,
  template,
  preview,
  generatedFile,
  resolve("workspace")
);
assert.equal(mapped.length, 1);
assert.equal(mapped[0].mappedFrom, "generated-java");
assert.match(template.slice(mapped[0].sourceRange.start, mapped[0].sourceRange.end), /missingCall/);

const direct = mapCompilerProblemsToSource(
  [{
    file: sourceFile,
    line: 3,
    column: 1,
    severity: "warning",
    message: "source warning"
  }],
  sourceFile,
  template,
  preview,
  generatedFile,
  resolve("workspace")
);
assert.equal(direct.length, 1);
assert.equal(direct[0].mappedFrom, "source");
assert.match(template.slice(direct[0].sourceRange.start, direct[0].sourceRange.end), /missingCall/);

console.log("compiler diagnostics tests ok");
