import assert from "node:assert/strict";
import {
  buildCompilerOutputProvenance,
  previewLineProvenance,
  primaryProvenance,
  provenanceAtPreviewOffset
} from "./provenance";
import { buildGeneratedJavaPreview, buildGeneratedOutputPreview } from "./templateModel";

const root = "/workspace/main.txtjet";
const include = "/workspace/parts/item.jetinc";
const output = buildGeneratedOutputPreview(
  '<component>\n<%@ include file="parts/item.jetinc" %>\n<%= name %>\n</component>',
  "txtjet-xml",
  {
    sourceFileName: root,
    expandIncludes: true,
    readInclude(path) {
      assert.equal(path, include);
      return "<item>\n<%= value %>\n</item>";
    }
  }
);

const lines = previewLineProvenance(output);
assert.equal(lines.length, output.text.split("\n").length);
assert.ok(lines.every((line) => line.origins.length > 0), "every preview line needs provenance");
assert.ok(lines.some((line) => line.origins.some((origin) =>
  origin.kind === "root" && origin.sourceFileName === root
)));
assert.ok(lines.some((line) => line.origins.some((origin) =>
  origin.kind === "include" && origin.sourceFileName === include
)));
assert.ok(lines.some((line) => line.origins.some((origin) =>
  origin.kind === "expression" && origin.sourceFileName === include
)));

const rootExpression = output.text.indexOf("${name}");
const rootExpressionOrigin = primaryProvenance(provenanceAtPreviewOffset(output, rootExpression));
assert.equal(rootExpressionOrigin?.kind, "expression");
assert.equal(rootExpressionOrigin?.sourceFileName, root);
assert.equal(rootExpressionOrigin?.confidence, "approximate");
assert.ok(output.provenance.some((origin) => origin.kind === "root" && origin.confidence === "direct"));
assert.ok(output.provenance.some((origin) => origin.kind === "include" && origin.confidence === "include-expanded"));

const skeletonFile = "/workspace/layout.skeleton";
const java = buildGeneratedJavaPreview(
  '<%@ jet package="demo" class="Sample" skeleton="layout.skeleton" %>\nhello <%= name %>',
  root,
  {
    sourceFileName: root,
    readSkeleton(path) {
      assert.equal(path, skeletonFile);
      return "${packageDeclaration}\npublic final class ${class} {\n${generateMethod}\n}\n";
    }
  }
);
assert.ok(java.provenance.some((origin) =>
  origin.kind === "skeleton"
  && origin.sourceFileName === skeletonFile
  && origin.confidence === "skeleton-rendered"
  && origin.label === "${class}"
));
assert.ok(java.provenance.some((origin) => origin.kind === "expression"));
assert.ok(previewLineProvenance(java).every((line) => line.origins.length > 0));

const compilerPreview = buildCompilerOutputProvenance(
  "<component>\nresolved-value\ncompiler-only\n</component>",
  output
);
const compilerLines = previewLineProvenance(compilerPreview);
assert.equal(compilerLines[0].origins[0].kind, "root");
assert.equal(compilerLines[1].origins[0].kind, "unmapped");
assert.equal(compilerLines[2].origins[0].kind, "unmapped");
assert.equal(compilerLines[3].origins[0].kind, "root");
assert.ok(compilerLines.every((line) => line.origins.length > 0));

console.log("provenance tests ok");
