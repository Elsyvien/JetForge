import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  effectiveCompletionTarget,
  effectiveJavaCompletionTarget,
  isJavaKeywordCompletionName,
  javaCompletionContextAt,
  javaFallbackCompletionLabels,
  localJavaDefinitionAndReferenceRangesAt,
  localJavaDefinitionRangesAt,
  localJavaHoverSignaturesAt,
  localJavaSignatureHelpAt,
  mapJavaPreviewRangeToSource,
  projectSourceOffsetToJavaPreview,
  targetFallbackCompletionLabels
} from "./javaIntelliSenseBridge";

const template = `<%@ jet package="demo" class="BridgeDemo" imports="java.util.List" %>
<%
List<String> names = List.of("a");
names.
%>
Hello <%= names.get(0) %>
<%!
private String helper(String value) {
    return value;
}
%>`;

const scriptletSource = template.indexOf("names.");
const scriptletProjection = projectSourceOffsetToJavaPreview(template, "/workspace/bridge.txtjet", scriptletSource + "names.".length);
assert.ok(scriptletProjection, "scriptlet Java position should project");
assert.equal(scriptletProjection.block.kind, "scriptlet");
assert.ok(scriptletProjection.preview.text.slice(scriptletProjection.previewOffset - 6, scriptletProjection.previewOffset).includes("names."));

const expressionSource = template.indexOf("names.get");
const expressionProjection = projectSourceOffsetToJavaPreview(template, "/workspace/bridge.txtjet", expressionSource + 5);
assert.ok(expressionProjection, "expression Java position should project");
assert.equal(expressionProjection.block.kind, "expression");
assert.ok(expressionProjection.preview.text.slice(expressionProjection.previewOffset - 5, expressionProjection.previewOffset + 4).includes("names"));

const declarationSource = template.indexOf("helper");
const declarationProjection = projectSourceOffsetToJavaPreview(template, "/workspace/bridge.txtjet", declarationSource + 2);
assert.ok(declarationProjection, "declaration Java position should project");
assert.equal(declarationProjection.block.kind, "declaration");
assert.ok(declarationProjection.preview.text.slice(declarationProjection.previewOffset - 2, declarationProjection.previewOffset + 8).includes("helper"));

const directiveProjection = projectSourceOffsetToJavaPreview(template, "/workspace/bridge.txtjet", template.indexOf("package"));
assert.equal(directiveProjection, undefined);

const outerProjection = projectSourceOffsetToJavaPreview(template, "/workspace/bridge.txtjet", template.indexOf("Hello"));
assert.equal(outerProjection, undefined);

const sourceRange = mapJavaPreviewRangeToSource(
  template,
  "/workspace/bridge.txtjet",
  { start: scriptletProjection.previewOffset - 6, end: scriptletProjection.previewOffset }
);
assert.ok(sourceRange, "scriptlet preview range should map back to source");
assert.equal(template.slice(sourceRange.start, sourceRange.end), "names.");

const expressionRange = mapJavaPreviewRangeToSource(
  template,
  "/workspace/bridge.txtjet",
  { start: expressionProjection.previewOffset - 5, end: expressionProjection.previewOffset }
);
assert.ok(expressionRange, "expression preview range should map back to source");
assert.equal(template.slice(expressionRange.start, expressionRange.end), "names");

const unmappedRange = mapJavaPreviewRangeToSource(template, "/workspace/bridge.txtjet", { start: 0, end: 1 });
assert.equal(unmappedRange, undefined);

const multilineBridgeTemplate = `<%@ jet package="demo" class="MultilineBridge" %>
<%
if (ready) {
    names.add("x");
}
%>
<%!
private String helper(
    String value
) {
    return value;
}
%>`;
const multilineSource = multilineBridgeTemplate.indexOf("names.add") + "names.add".length;
const multilineProjection = projectSourceOffsetToJavaPreview(multilineBridgeTemplate, "/workspace/multiline.txtjet", multilineSource);
assert.ok(multilineProjection, "multiline scriptlet Java position should project");
assert.ok(multilineProjection.preview.text.slice(multilineProjection.previewOffset - "names.add".length, multilineProjection.previewOffset).includes("names.add"));
const multilineBackRange = mapJavaPreviewRangeToSource(
  multilineBridgeTemplate,
  "/workspace/multiline.txtjet",
  { start: multilineProjection.previewOffset - "names.add".length, end: multilineProjection.previewOffset }
);
assert.ok(multilineBackRange, "multiline scriptlet preview range should map back");
assert.equal(multilineBridgeTemplate.slice(multilineBackRange.start, multilineBackRange.end), "names.add");

const trimmedExpressionTemplate = `<%@ jet package="demo" class="TrimmedExpression" %>
<%=
  helper(name)
%>`;
const trimmedExpressionSource = trimmedExpressionTemplate.indexOf("helper(name)") + "helper".length;
const trimmedExpressionProjection = projectSourceOffsetToJavaPreview(trimmedExpressionTemplate, "/workspace/expression.txtjet", trimmedExpressionSource);
assert.ok(trimmedExpressionProjection, "trimmed multiline expression should project");
const trimmedExpressionRange = mapJavaPreviewRangeToSource(
  trimmedExpressionTemplate,
  "/workspace/expression.txtjet",
  { start: trimmedExpressionProjection.previewOffset - "helper".length, end: trimmedExpressionProjection.previewOffset }
);
assert.ok(trimmedExpressionRange, "trimmed multiline expression should map back");
assert.equal(trimmedExpressionTemplate.slice(trimmedExpressionRange.start, trimmedExpressionRange.end), "helper");

const skeletonBridgeTemplate = `<%@ jet package="demo" class="SkeletonBridge" skeleton="layout.skeleton" %>
<%
helper("x");
%>
<%!
private String helper(String value) {
    return value;
}
%>`;
const skeletonOptions = {
  readSkeleton() {
    return "${packageDeclaration}\n\npublic final class ${class} {\n${members}\n${generateMethod}\n}\n";
  }
};
const skeletonSource = skeletonBridgeTemplate.indexOf("helper(\"x\")") + "helper".length;
const skeletonProjection = projectSourceOffsetToJavaPreview(skeletonBridgeTemplate, "/workspace/skeleton.txtjet", skeletonSource, skeletonOptions);
assert.ok(skeletonProjection, "skeleton-rendered Java preview position should project");
assert.ok(skeletonProjection.preview.text.includes("public final class SkeletonBridge"));
const skeletonBackRange = mapJavaPreviewRangeToSource(
  skeletonBridgeTemplate,
  "/workspace/skeleton.txtjet",
  { start: skeletonProjection.previewOffset - "helper".length, end: skeletonProjection.previewOffset },
  skeletonOptions
);
assert.ok(skeletonBackRange, "skeleton-rendered Java preview range should map back");
assert.equal(skeletonBridgeTemplate.slice(skeletonBackRange.start, skeletonBackRange.end), "helper");

assert.equal(javaCompletionContextAt(template, scriptletSource, "txtjet-java")?.kind, "template-java");
assert.equal(javaCompletionContextAt(template, declarationSource, "txtjet-java")?.kind, "template-java");
assert.equal(javaCompletionContextAt(template, expressionSource, "txtjet-java")?.kind, "template-java");

assert.ok(javaFallbackCompletionLabels(template, scriptletSource + "names.".length, "txtjet-java").includes("get"));
assert.ok(javaFallbackCompletionLabels(template, declarationSource, "txtjet-java").includes("return"));
assert.ok(javaFallbackCompletionLabels(template, expressionSource + "names.".length, "txtjet-java").includes("get"));

const helperCallTemplate = `<%@ jet package="demo" class="Definitions" %>
<%
helper("x");
this.helper("y");
service.helper("z");
%>
<%= helper(name) %>
<%!
private String helper(String value) {
    return value;
}
private String helper(Object value) {
    return String.valueOf(value);
}
%>`;
const helperDefinitions = localJavaDefinitionRangesAt(helperCallTemplate, helperCallTemplate.indexOf("helper(\"x\")") + 2);
assert.equal(helperDefinitions.length, 2);
assert.deepEqual(helperDefinitions.map((range) => helperCallTemplate.slice(range.start, range.end)), ["helper", "helper"]);
assert.deepEqual(localJavaHoverSignaturesAt(helperCallTemplate, helperCallTemplate.indexOf("helper(\"x\")") + 2), [
  "private String helper(String value)",
  "private String helper(Object value)"
]);
assert.equal(localJavaDefinitionRangesAt(helperCallTemplate, helperCallTemplate.indexOf("this.helper") + "this.helper".length).length, 2);
assert.equal(localJavaDefinitionRangesAt(helperCallTemplate, helperCallTemplate.indexOf("helper(name)") + 2).length, 2);
assert.deepEqual(localJavaDefinitionRangesAt(helperCallTemplate, helperCallTemplate.indexOf("service.helper") + "service.helper".length), []);
assert.deepEqual(localJavaHoverSignaturesAt(helperCallTemplate, helperCallTemplate.indexOf("service.helper") + "service.helper".length), []);
assert.deepEqual(localJavaDefinitionRangesAt(helperCallTemplate, helperCallTemplate.indexOf("package")), []);
const helperRefs = localJavaDefinitionAndReferenceRangesAt(helperCallTemplate, helperCallTemplate.indexOf("helper(\"x\")") + 2);
assert.equal(helperRefs.length, 5);
assert.equal(helperRefs.filter((range) => helperCallTemplate.slice(range.start, range.end) === "helper").length, 5);
const helperDefinitionRefs = localJavaDefinitionAndReferenceRangesAt(helperCallTemplate, helperCallTemplate.indexOf("helper(String value)") + 2);
assert.equal(helperDefinitionRefs.length, 5);
assert.equal(helperDefinitionRefs.filter((range) => helperCallTemplate.slice(range.start, range.end) === "helper").length, 5);

const signatureHelpTemplate = `<%@ jet package="demo" class="Signatures" %>
<%
helperPair(first, combine(second, third),
this.helperPair(one, two
service.helperPair(nope,
%>
<%!
private String helperPair(String first, String second, String third) {
    return first;
}
private String helperPair(Object first, Object second, Object third) {
    return String.valueOf(first);
}
%>`;
const signatureHelp = localJavaSignatureHelpAt(
  signatureHelpTemplate,
  signatureHelpTemplate.indexOf("third),") + "third),".length
);
assert.deepEqual(signatureHelp?.signatures, [
  "private String helperPair(String first, String second, String third)",
  "private String helperPair(Object first, Object second, Object third)"
]);
assert.equal(signatureHelp?.activeParameter, 2);
assert.equal(
  localJavaSignatureHelpAt(signatureHelpTemplate, signatureHelpTemplate.indexOf("this.helperPair(one, two") + "this.helperPair(one, two".length)?.activeParameter,
  1
);
assert.equal(
  localJavaSignatureHelpAt(signatureHelpTemplate, signatureHelpTemplate.indexOf("service.helperPair(nope") + "service.helperPair(nope".length),
  undefined
);

const scriptletMethodShape = `<%
private String localOnly(String value) {
    return value;
}
localOnly("x");
%>`;
assert.deepEqual(localJavaDefinitionRangesAt(scriptletMethodShape, scriptletMethodShape.lastIndexOf("localOnly") + 2), []);

const maskedCallTemplate = `<%@ jet package="demo" class="Masked" %>
<%
// helper("x");
String literal = "helper(y)";
%>
<%!
private String helper(String value) {
    return value;
}
%>`;
assert.deepEqual(localJavaDefinitionRangesAt(maskedCallTemplate, maskedCallTemplate.indexOf("// helper") + 4), []);
assert.deepEqual(localJavaDefinitionRangesAt(maskedCallTemplate, maskedCallTemplate.indexOf("\"helper") + 2), []);
assert.equal(localJavaSignatureHelpAt(maskedCallTemplate, maskedCallTemplate.indexOf("// helper") + 10), undefined);

assert.equal(effectiveJavaCompletionTarget("txtjet", "txtjet-java"), "txtjet-java");
assert.equal(effectiveJavaCompletionTarget("txtjet", "txtjet-html"), "txtjet");
assert.equal(effectiveJavaCompletionTarget("txtjet-html", "txtjet-java"), "txtjet-html");
assert.equal(isJavaKeywordCompletionName("return"), true);
assert.equal(isJavaKeywordCompletionName("BridgeDemo"), false);
assert.equal(effectiveCompletionTarget("txtjet", "txtjet-python"), "txtjet-python");
assert.equal(effectiveCompletionTarget("txtjet", "txtjet-c"), "txtjet-c");
assert.equal(effectiveCompletionTarget("txtjet-html", "txtjet-python"), "txtjet-html");

const sampleJava = readFileSync("examples/sample-java.txtjet", "utf8");
const sampleOuterOffset = sampleJava.indexOf("package generated.sample");
assert.equal(javaCompletionContextAt(sampleJava, sampleOuterOffset, "txtjet-java")?.kind, "generated-java");
assert.equal(javaCompletionContextAt(sampleJava, sampleOuterOffset, "txtjet-html"), undefined);
assert.ok(javaFallbackCompletionLabels(sampleJava, sampleOuterOffset, "txtjet-java").includes("return"));
assert.deepEqual(javaFallbackCompletionLabels(sampleJava, sampleOuterOffset, "txtjet-html"), []);

const sampleJavaWithMath = sampleJava.replace("class Main {", "class Main {\n    Math.p");
const sampleMathOffset = sampleJavaWithMath.indexOf("Math.p") + "Math.p".length;
assert.equal(javaCompletionContextAt(sampleJavaWithMath, sampleMathOffset, "txtjet-java")?.kind, "generated-java");
assert.ok(javaFallbackCompletionLabels(sampleJavaWithMath, sampleMathOffset, "txtjet-java").includes("pow"));

const pythonTemplate = `<%@ jet package="demo" class="PySample" %>
items = []
items.ap
name = "Ada"
name.up`;
const pythonItemsOffset = pythonTemplate.indexOf("items.ap") + "items.ap".length;
const pythonNameOffset = pythonTemplate.indexOf("name.up") + "name.up".length;
assert.equal(javaCompletionContextAt(pythonTemplate, pythonItemsOffset, "txtjet-python")?.kind, "generated-python");
assert.ok(targetFallbackCompletionLabels(pythonTemplate, pythonItemsOffset, "txtjet-python").includes("append"));
assert.ok(targetFallbackCompletionLabels(pythonTemplate, pythonNameOffset, "txtjet-python").includes("upper"));
assert.ok(targetFallbackCompletionLabels(pythonTemplate, pythonTemplate.indexOf("items ="), "txtjet-python").includes("def"));
assert.deepEqual(targetFallbackCompletionLabels(pythonTemplate, pythonItemsOffset, "txtjet-html"), []);

const cppTemplate = `<%@ jet package="demo" class="CppSample" %>
#include <vector>
std::co
std::vector<int> values;
values.pu`;
const cppStdOffset = cppTemplate.indexOf("std::co") + "std::co".length;
const cppVectorOffset = cppTemplate.indexOf("values.pu") + "values.pu".length;
assert.equal(javaCompletionContextAt(cppTemplate, cppStdOffset, "txtjet-c")?.kind, "generated-c");
assert.ok(targetFallbackCompletionLabels(cppTemplate, cppStdOffset, "txtjet-c").includes("cout"));
assert.ok(targetFallbackCompletionLabels(cppTemplate, cppVectorOffset, "txtjet-c").includes("push_back"));
assert.ok(targetFallbackCompletionLabels(cppTemplate, cppTemplate.indexOf("#include"), "txtjet-c").includes("return"));
assert.deepEqual(targetFallbackCompletionLabels(cppTemplate, cppStdOffset, "txtjet-html"), []);

console.log("java IntelliSense bridge tests ok");
