import assert from "node:assert/strict";
import {
  buildGeneratedJavaPreview,
  buildGeneratedOutputPreview,
  mapPreviewRangeToSource,
  mapSourceRangeToPreview,
  parseTxtJetTemplate,
  resolveIncludePath,
  targetPreviewLanguage
} from "./templateModel";

const template = `<%@ jet package="example.txtjet.samples" class="JavaSample" imports="java.util.List, java.util.Map" %>
<%
    List<String> fields = List.of("id");
%>
public class GeneratedRecord {
<% for (String field : fields) { %>
    private String <%= field %>;
<% } %>
<%!
    private String helper() {
        return "x";
    }
%>
}`;

const model = parseTxtJetTemplate(template);
assert.equal(model.jetDirective?.attributes.package, "example.txtjet.samples");
assert.equal(model.jetDirective?.attributes.class, "JavaSample");
assert.equal(parseTxtJetTemplate("<%@ jet package=\"a\\\"b\" class='Demo' %>").jetDirective?.attributes.package, "a\"b");
assert.deepEqual(model.blocks.map((block) => block.kind), [
  "directive",
  "outer",
  "scriptlet",
  "outer",
  "scriptlet",
  "outer",
  "expression",
  "outer",
  "scriptlet",
  "outer",
  "declaration",
  "outer"
]);

const outputPreview = buildGeneratedOutputPreview(template);
assert.ok(outputPreview.text.includes("public class GeneratedRecord"));
assert.ok(outputPreview.text.includes("${field}"));
assert.ok(outputPreview.text.includes("# txtjet directive: jet package="));
assert.equal(outputPreview.mappings.length, model.blocks.length);
assert.ok(outputPreview.mappings.some((mapping) => mapping.kind === "placeholder"));

const javaOutputPreview = buildGeneratedOutputPreview(template, "txtjet-java");
assert.ok(javaOutputPreview.text.includes("private String txtjet_field;"));
assert.ok(javaOutputPreview.text.includes("/* txtjet directive: jet package="));
assert.ok(javaOutputPreview.text.includes(" * List<String> fields = List.of(\"id\");"));
assert.ok(javaOutputPreview.text.includes(" * private String helper() {"));
assert.equal(javaOutputPreview.text.includes("${field}"), false);

assert.ok(buildGeneratedOutputPreview("value = <%= colors.get(0) %>", "txtjet-python").text.includes("txtjet_colors_get_0"));
assert.ok(buildGeneratedOutputPreview("#define COUNT <%= names.size() %>", "txtjet-c").text.includes("txtjet_names_size"));
assert.ok(buildGeneratedOutputPreview("<% if (show) { %><h1><%= title %></h1>", "txtjet-html").text.includes("<!-- txtjet scriptlet:"));
assert.ok(buildGeneratedOutputPreview("<h1><%= title %></h1>", "txtjet-html").text.includes("${title}"));

const javaPreview = buildGeneratedJavaPreview(template);
assert.ok(javaPreview.text.includes("package example.txtjet.samples;"));
assert.ok(javaPreview.text.includes("import java.util.List;"));
assert.ok(javaPreview.text.includes("public class JavaSample"));
assert.ok(javaPreview.text.includes("StringBuilder stringBuffer = new StringBuilder();"));
assert.ok(javaPreview.text.includes("stringBuffer.append(field);"));
assert.ok(javaPreview.text.includes("private String helper()"));
assert.ok(javaPreview.mappings.some((mapping) => mapping.kind === "append"));

const outerSourceStart = template.indexOf("public class GeneratedRecord");
const outerPreviewRange = mapSourceRangeToPreview(javaPreview.mappings, { start: outerSourceStart, end: outerSourceStart });
assert.ok(outerPreviewRange, "outer source should map to generated Java append");
assert.match(javaPreview.text.slice(outerPreviewRange.start, outerPreviewRange.end), /stringBuffer\.append/);
assert.equal(mapPreviewRangeToSource(javaPreview.mappings, outerPreviewRange)?.start, model.blocks[3].range.start);

const scriptletSourceStart = template.indexOf("for (String field");
const scriptletPreviewRange = mapSourceRangeToPreview(javaPreview.mappings, { start: scriptletSourceStart, end: scriptletSourceStart + 3 });
assert.ok(scriptletPreviewRange, "scriptlet source should map to generated Java scriptlet");
assert.match(javaPreview.text.slice(scriptletPreviewRange.start, scriptletPreviewRange.end), /for \(String field/);

const expressionSourceStart = template.indexOf("field %>");
const expressionPreviewRange = mapSourceRangeToPreview(javaPreview.mappings, { start: expressionSourceStart, end: expressionSourceStart });
assert.ok(expressionPreviewRange, "expression source should map to generated Java append expression");
assert.match(javaPreview.text.slice(expressionPreviewRange.start, expressionPreviewRange.end), /stringBuffer\.append\(field\)/);

const declarationSourceStart = template.indexOf("private String helper");
const declarationPreviewRange = mapSourceRangeToPreview(javaPreview.mappings, { start: declarationSourceStart, end: declarationSourceStart + 7 });
assert.ok(declarationPreviewRange, "declaration source should map to generated Java class member");
assert.match(javaPreview.text.slice(declarationPreviewRange.start, declarationPreviewRange.end), /private String helper/);

const multilineTemplate = "<%@ jet %>\n<%\nif (ready) {\n    run();\n}\n%>";
const multilinePreview = buildGeneratedJavaPreview(multilineTemplate);
const multilineSourceStart = multilineTemplate.indexOf("run();");
const multilinePreviewRange = mapSourceRangeToPreview(multilinePreview.mappings, { start: multilineSourceStart, end: multilineSourceStart });
assert.ok(multilinePreviewRange, "multiline scriptlet should map");
assert.match(multilinePreview.text.slice(multilinePreviewRange.start, multilinePreviewRange.end), /run\(\);/);

const emptyPreview = buildGeneratedJavaPreview("<%@ jet %><%%><%=%>");
assert.ok(emptyPreview.text.includes("stringBuffer.append(\"\");"));
const emptyScriptlet = emptyPreview.mappings.find((mapping) => mapping.kind === "scriptlet" && mapping.preview.start === mapping.preview.end);
assert.ok(emptyScriptlet, "empty scriptlet mapping missing");
assert.ok(
  mapSourceRangeToPreview(emptyPreview.mappings, { start: emptyScriptlet.source.start, end: emptyScriptlet.source.start }),
  "empty scriptlet cursor should map"
);

const malformedPreview = buildGeneratedJavaPreview("<%@ jet package=\"demo\" class=\"Broken\" %>\n<% if (ready) {");
assert.ok(malformedPreview.text.includes("public class Broken"));
assert.ok(mapSourceRangeToPreview(malformedPreview.mappings, { start: malformedPreview.text.length, end: malformedPreview.text.length }) === undefined);

const fallbackJavaPreview = buildGeneratedJavaPreview("<%@ jet package=\"123\" class=\"123\" %>hello");
assert.ok(fallbackJavaPreview.text.includes("package txtjet.generated;"));
assert.ok(fallbackJavaPreview.text.includes("public class GeneratedTxtJetTemplate"));

assert.equal(targetPreviewLanguage("txtjet-java"), "java");
assert.equal(targetPreviewLanguage("txtjet-html"), "html");
assert.equal(targetPreviewLanguage("txtjet"), "plaintext");

assert.equal(resolveIncludePath("/workspace/templates/main.txtjet", "parts/header.txtjet"), "/workspace/templates/parts/header.txtjet");
assert.equal(resolveIncludePath("/workspace/templates/main.txtjet", "/tmp/header.txtjet"), undefined);
assert.equal(resolveIncludePath("/workspace/templates/main.txtjet", ""), undefined);

console.log("template model tests ok");
