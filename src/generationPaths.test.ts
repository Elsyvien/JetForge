import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatedOutputPath, generatedRelativePath, isolatedValidationOutputPath } from "./generationPaths";

const workspaceRoot = join(tmpdir(), "txtjet-generation-workspace");
assert.equal(
  generatedRelativePath(join(workspaceRoot, "a", "component.txtjet"), workspaceRoot, "java"),
  join("a", "component.txtjet.java")
);
assert.equal(
  generatedRelativePath(join(workspaceRoot, "b", "component.txtjet"), workspaceRoot, "java"),
  join("b", "component.txtjet.java")
);
assert.notEqual(
  generatedRelativePath(join(workspaceRoot, "a", "component.txtjet"), workspaceRoot, "java"),
  generatedRelativePath(join(workspaceRoot, "b", "component.txtjet"), workspaceRoot, "java")
);
assert.equal(
  generatedRelativePath(join(workspaceRoot, "partials", "header.jetinc"), workspaceRoot, "txt"),
  join("partials", "header.jetinc.txt")
);
assert.equal(
  generatedRelativePath(join(tmpdir(), "outside", "standalone.propertiesjet"), workspaceRoot, "xml"),
  "standalone.propertiesjet.xml"
);
assert.notEqual(
  generatedRelativePath(join(workspaceRoot, "component.txtjet"), workspaceRoot, "java"),
  generatedRelativePath(join(workspaceRoot, "component.javajet"), workspaceRoot, "java")
);
assert.throws(
  () => generatedRelativePath(join(workspaceRoot, "component.txtjet"), workspaceRoot, "../xml"),
  /Invalid generated output extension/
);
assert.equal(
  isolatedValidationOutputPath(join(workspaceRoot, "generated", "component.txtjet.xml"), "ipxact", 42, 3),
  join(workspaceRoot, "generated", "component.txtjet.ipxact-validation-42-3.xml")
);
assert.notEqual(
  isolatedValidationOutputPath("component.java", "compiler", 42, 1),
  isolatedValidationOutputPath("component.java", "compiler", 42, 2)
);
assert.throws(() => isolatedValidationOutputPath("component.java", "compiler", 42, 0), /safe positive integers/);

if (process.platform !== "win32") {
  const root = mkdtempSync(join(tmpdir(), "txtjet-generation-paths-"));
  const sourceRoot = join(root, "source");
  const outputRoot = join(root, "generated");
  const outsideRoot = join(root, "outside");
  mkdirSync(join(sourceRoot, "linked"), { recursive: true });
  mkdirSync(outputRoot);
  mkdirSync(outsideRoot);
  symlinkSync(outsideRoot, join(outputRoot, "linked"));
  assert.equal(
    generatedOutputPath(join(sourceRoot, "linked", "component.txtjet"), sourceRoot, outputRoot, "java"),
    undefined
  );
  rmSync(root, { recursive: true, force: true });
}

console.log("generation path tests ok");
