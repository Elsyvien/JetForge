import assert from "node:assert/strict";
import {
  buildCompilerOutputProvenance,
  MAX_PROVENANCE_ORIGINS_PER_LINE,
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

const boundaryPreview = buildGeneratedOutputPreview("foo<%= x %>bar", "txtjet", {
  sourceFileName: root
});
const barOffset = boundaryPreview.text.indexOf("bar");
assert.equal(primaryProvenance(provenanceAtPreviewOffset(boundaryPreview, barOffset))?.kind, "root");
assert.equal(primaryProvenance(provenanceAtPreviewOffset(boundaryPreview, boundaryPreview.text.length))?.kind, "root");

const crlfPreview = buildGeneratedOutputPreview("alpha\r\nomega\r\n", "txtjet", {
  sourceFileName: root
});
const lfCompilerPreview = buildCompilerOutputProvenance("alpha\nomega\n", crlfPreview);
assert.equal(previewLineProvenance(lfCompilerPreview)[0].origins[0].kind, "root");
assert.equal(previewLineProvenance(lfCompilerPreview)[1].origins[0].kind, "root");

const provenanceLineCount = 20000;
const provenanceText = "x\n".repeat(provenanceLineCount);
const linearProvenanceStart = performance.now();
const linearProvenance = previewLineProvenance({
  text: provenanceText,
  mappings: [],
  provenance: Array.from({ length: provenanceLineCount }, (_, line) => ({
    preview: { start: line * 2, end: line * 2 + 1 },
    kind: "root" as const,
    confidence: "direct" as const,
    source: { start: line, end: line + 1 }
  }))
});
const linearProvenanceElapsedMs = performance.now() - linearProvenanceStart;
assert.equal(linearProvenance[provenanceLineCount - 1].origins[0]?.source?.start, provenanceLineCount - 1);
assert.ok(
  linearProvenanceElapsedMs < 1500,
  `line provenance sweep took ${linearProvenanceElapsedMs.toFixed(1)} ms; expected below 1500 ms`
);

const overlappingOrigins = Array.from({ length: MAX_PROVENANCE_ORIGINS_PER_LINE + 20 }, (_, index) => ({
  preview: { start: 0, end: 3 },
  kind: "include" as const,
  confidence: "include-expanded" as const,
  sourceFileName: `/workspace/include-${index}.jetinc`
}));
const limitedOrigins = previewLineProvenance({ text: "a\nb", mappings: [], provenance: overlappingOrigins });
assert.equal(limitedOrigins[0].origins.length, MAX_PROVENANCE_ORIGINS_PER_LINE + 1);
assert.match(limitedOrigins[0].origins.at(-1)?.label ?? "", /limited to 128 origins/);

console.log("provenance tests ok");
