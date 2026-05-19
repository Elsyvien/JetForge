import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { detectTargetLanguage, detectTargetLanguageFromFileName } from "./detector";
import {
  buildGeneratedJavaPreview,
  buildGeneratedOutputPreview,
  headerComment,
  resolveIncludePath,
  targetPreviewLanguage
} from "./templateModel";

const exampleRoot = "examples";
const exampleFiles = listTxtJetFiles(exampleRoot);

assert.ok(exampleFiles.length >= 10, "expected broad sanitized example coverage");

for (const file of exampleFiles) {
  const text = readFileSync(file, "utf8");
  const target = detectTargetLanguageFromFileName(file) === "txtjet"
    ? detectTargetLanguage(text)
    : detectTargetLanguageFromFileName(file);
  const output = headerComment("output", file, target) + buildGeneratedOutputPreview(text, target, {
    sourceFileName: file,
    expandIncludes: true,
    readInclude(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    }
  }).text;
  const java = buildGeneratedJavaPreview(text, file).text;

  assert.match(output, /Generated output preview/, `${file} output preview header missing`);
  assert.match(java, /Generated Java template preview|TxtJet generated Java template preview/, `${file} java preview header missing`);
  assert.ok(output.trim().length > 0, `${file} output preview empty`);
  assert.ok(java.includes("StringBuilder stringBuffer"), `${file} java preview generate body missing`);
  if (!file.includes("malformed") && !file.includes("diagnostics")) {
    assert.equal(output.includes("<%"), false, `${file} output preview leaked raw opening marker`);
    assert.equal(output.includes("%>"), false, `${file} output preview leaked raw closing marker`);
  }
}

const includeOutput = preview("examples/include-main.txtjet");
assert.ok(includeOutput.includes("Generated Include Sample"));
assert.ok(includeOutput.includes("<nav>"));
assert.ok(includeOutput.includes("txtjet include begin: partials/header.txtjet"));
assert.ok(includeOutput.includes("txtjet include end: partials/nav.txtjet"));

const javaOutput = preview("examples/sample-java.txtjet");
assert.ok(javaOutput.includes("private String txtjet_field;"));
assert.ok(javaOutput.includes("txtjet scriptlet:"));
assert.ok(javaOutput.includes("txtjet declaration:"));

const pythonOutput = preview("examples/sample-python.txtjet");
assert.ok(pythonOutput.includes("txtjet_color_toUpperCase"));
assert.ok(pythonOutput.includes("\"txtjet_color\""));

const cOutput = preview("examples/sample-c.txtjet");
assert.ok(cOutput.includes("GENERATED_STATUS_txtjet_name_toUpperCase"));
assert.ok(cOutput.includes("#define GENERATED_STATUS_COUNT txtjet_names_size"));

assert.equal(relative(".", resolveIncludePath("examples/include-main.txtjet", "partials/header.txtjet") ?? ""), "examples/partials/header.txtjet");
assert.equal(targetPreviewLanguage("txtjet-java"), "java");

console.log("preview example tests ok");

function preview(file: string): string {
  const text = readFileSync(file, "utf8");
  const target = detectTargetLanguageFromFileName(file) === "txtjet"
    ? detectTargetLanguage(text)
    : detectTargetLanguageFromFileName(file);
  return headerComment("output", file, target) + buildGeneratedOutputPreview(text, target, {
    sourceFileName: file,
    expandIncludes: true,
    readInclude(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    }
  }).text;
}

function listTxtJetFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTxtJetFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".txtjet") ? [relative(".", path)] : [];
  });
}
