import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  DEFAULT_COMPILER_PROBLEM_MATCHER,
  mapCompilerProblemsToSource,
  parseCompilerProblems
} from "./compilerDiagnostics";
import { buildGeneratedJavaPreview, buildGeneratedOutputPreview } from "./templateModel";

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
const eclipseJetStyle = parseCompilerProblems(
  "generated/sample.java:8:17: The method missingCall() is undefined for the type Sample",
  DEFAULT_COMPILER_PROBLEM_MATCHER
);
assert.equal(eclipseJetStyle.length, 1);
assert.equal(eclipseJetStyle[0].severity, "warning");
assert.equal(eclipseJetStyle[0].message, "The method missingCall() is undefined for the type Sample");
const wrapperStyle = parseCompilerProblems(
  "[txtjet] generated/sample.java:9:5: error: wrapped compiler failure",
  "^\\[txtjet\\]\\s+(?<file>.*?):(?<line>\\d+):(?<column>\\d+):\\s*(?<severity>error|warning|info|information|hint):\\s*(?<message>.+)$"
);
assert.equal(wrapperStyle.length, 1);
assert.equal(wrapperStyle[0].file, "generated/sample.java");
assert.equal(wrapperStyle[0].severity, "error");
assert.equal(wrapperStyle[0].message, "wrapped compiler failure");
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
const outputPreview = buildGeneratedOutputPreview(template);
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
  outputPreview,
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
  outputPreview,
  generatedFile,
  resolve("workspace")
);
assert.equal(direct.length, 1);
assert.equal(direct[0].mappedFrom, "source");
assert.match(template.slice(direct[0].sourceRange.start, direct[0].sourceRange.end), /missingCall/);

const unrelated = mapCompilerProblemsToSource(
  [{
    file: join("generated", "other.java"),
    line: 1,
    column: 1,
    severity: "error",
    message: "unrelated generated file"
  }],
  sourceFile,
  template,
  preview,
  outputPreview,
  generatedFile,
  resolve("workspace")
);
assert.equal(unrelated.length, 0);

const misleadingSameBasename = mapCompilerProblemsToSource(
  [{
    file: join("other-output", "sample.java"),
    line: previewLine,
    column: 1,
    severity: "error",
    message: "wrong generated file"
  }],
  sourceFile,
  template,
  preview,
  outputPreview,
  generatedFile,
  resolve("workspace")
);
assert.equal(misleadingSameBasename.length, 0);

const bareGeneratedBasename = mapCompilerProblemsToSource(
  [{
    file: "sample.java",
    line: previewLine,
    column: 1,
    severity: "error",
    message: "bare generated filename"
  }],
  sourceFile,
  template,
  preview,
  outputPreview,
  generatedFile,
  resolve("workspace")
);
assert.equal(bareGeneratedBasename.length, 1);

const outputLine = outputPreview.text.slice(0, outputPreview.text.indexOf("hello")).split("\n").length;
const mappedOutput = mapCompilerProblemsToSource(
  [{
    file: join("generated", "sample.java"),
    line: outputLine,
    column: 1,
    severity: "error",
    message: "generated output failure"
  }],
  sourceFile,
  template,
  preview,
  outputPreview,
  generatedFile,
  resolve("workspace")
);
assert.equal(mappedOutput.length, 1);
assert.equal(mappedOutput[0].mappedFrom, "generated-output");
assert.match(template.slice(mappedOutput[0].sourceRange.start, mappedOutput[0].sourceRange.end), /hello/);

const unmappedPreviewHeader = mapCompilerProblemsToSource(
  [{
    file: join("generated", "sample.java"),
    line: 1,
    column: 1,
    severity: "error",
    message: "header cannot map safely"
  }],
  sourceFile,
  template,
  preview,
  outputPreview,
  generatedFile,
  resolve("workspace")
);
assert.equal(unmappedPreviewHeader.length, 0);

console.log("compiler diagnostics tests ok");
