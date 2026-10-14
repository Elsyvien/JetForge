import assert from "node:assert/strict";
import { resolve } from "node:path";
import { compileTxtJet } from "./txtjetCompiler";
import {
  compilerLocationAt,
  compilerOffsetAt,
  mapJavaDiagnostic,
} from "./compilerSourceMap";
import {
  buildGeneratedJavaPreview,
  parseTxtJetTemplate,
} from "./templateModel";
import { scanTxtJetIssues } from "./scanner";

const root = resolve("compiler-fixture");
const template = resolve(root, "main.txtjet");
const sources = new Map<string, string>([
  [
    template,
    '<%@ jet package="demo" class="Component" imports="java.util.Map;java.util.List" %><%-- ignored <% anything %> --%>Hi<%@ include file="parts/item.jetinc" %>',
  ],
  [
    resolve(root, "parts/item.jetinc"),
    '<%! String upper(String v) { return v.toUpperCase(); } %><% for (String n : List.of("a")) { %><%= upper(n) %><% } %>',
  ],
]);
const compile = (text: string) =>
  compileTxtJet({
    fileName: template,
    readFile: (path) => (path === template ? text : sources.get(path)),
  });
const unit = compile(sources.get(template)!);
assert.deepEqual(unit.diagnostics, []);
assert.match(unit.java, /generate\(Object argument\)/);
assert.match(unit.java, /String upper/);
assert.match(unit.java, /List.of/);
assert.doesNotMatch(unit.java, /ignored|anything/);
assert.equal(unit.dependencies.size, 2);
const include = resolve(root, "parts/item.jetinc");
const expression = unit.mappings.find(
  (mapping) =>
    mapping.fileName === include &&
    unit.java
      .slice(mapping.generated.start, mapping.generated.end)
      .includes("upper(n)"),
)!;
const location = compilerLocationAt(unit.java, expression.generated.start + 1);
const mapped = mapJavaDiagnostic(unit, {
  code: "JAVA_COMPILE",
  message: "error",
  severity: "error",
  javaLine: location.line,
  column: location.column,
});
assert.equal(mapped.fileName, include);
assert.equal(mapped.range?.start, expression.source.start + 1);
assert.equal(
  compilerOffsetAt(unit.java, location.line, location.column),
  expression.generated.start + 1,
);
assert.equal(compilerOffsetAt("a", 999), 1);
assert.equal(
  mapJavaDiagnostic(unit, {
    code: "JAVA_COMPILE",
    message: "x",
    severity: "error",
  }).fileName,
  undefined,
);
assert.equal(
  mapJavaDiagnostic(unit, {
    code: "JAVA_COMPILE",
    message: "x",
    severity: "error",
    javaLine: 1,
  }).fileName,
  undefined,
);
assert.equal(
  parseTxtJetTemplate("<%-- a %> b --%>text").blocks[0].kind,
  "comment",
);
assert.match(
  buildGeneratedJavaPreview("<%= argument %>", "builtin", {
    generateArgument: true,
  }).text,
  /generate\(Object argument\) throws Exception/,
);
assert.deepEqual(scanTxtJetIssues("<%-- a %> b --%>text"), []);
assert.ok(scanTxtJetIssues("<%-- missing").length);
assert.ok(compile('<%@ jet class="1wrong" %>text').diagnostics.length);
assert.ok(
  compile('<%@ jet builder="StringBuilder" %>').diagnostics.some(
    (problem) => problem.code === "UNSUPPORTED_SYNTAX",
  ),
);
assert.ok(
  compile('<%@ include file="missing.jetinc" %>').diagnostics.some(
    (problem) => problem.code === "REFERENCE_ERROR",
  ),
);
sources.set(
  resolve(root, "parts/item.jetinc"),
  '<%@ include file="../main.txtjet" %>',
);
assert.ok(
  compile('<%@ include file="parts/item.jetinc" %>').diagnostics.some(
    (problem) => /cycle/.test(problem.message),
  ),
);
sources.set(resolve(root, "parts/item.jetinc"), '<%@ jet class="Other" %>');
assert.ok(
  compile('<%@ include file="parts/item.jetinc" %>').diagnostics.some(
    (problem) => problem.code === "UNSUPPORTED_SYNTAX",
  ),
);
sources.set(
  resolve(root, "base.skeleton"),
  "${packageDeclaration}\n${imports}\npublic class ${class} {\n${members}\n${generateMethod}\n}",
);
assert.deepEqual(
  compile('<%@ jet skeleton="base.skeleton" %>value').diagnostics,
  [],
);
sources.set(
  resolve(root, "base.skeleton"),
  "public class CLASS { public String generate(Object argument) {} }",
);
assert.ok(
  compile('<%@ jet skeleton="base.skeleton" %>').diagnostics.some(
    (problem) => problem.code === "UNSUPPORTED_SYNTAX",
  ),
);
assert.ok(
  compile('<%@ jet skeleton="missing.skeleton" %>').diagnostics.some(
    (problem) => problem.code === "REFERENCE_ERROR",
  ),
);
sources.set(
  resolve(root, "base.skeleton"),
  "${class}${class}${generateMethod}${unknown}",
);
assert.ok(compile('<%@ jet skeleton="base.skeleton" %>').diagnostics.length);
sources.set(
  resolve(root, "base.skeleton"),
  "public class ${class} { ${generateMethod} }",
);
assert.ok(
  compile('<%@ jet skeleton="base.skeleton" %><%! int value; %>').diagnostics
    .length,
);
assert.ok(compile('\u0000\u0001\t\n\r"\\').java.includes("\\000"));
assert.ok(compile("x".repeat(20000)).java.includes("stringBuffer.append"));
assert.ok(
  compile("x".repeat(5 * 1024 * 1024)).diagnostics.some(
    (problem) => problem.code === "RESOURCE_LIMIT",
  ),
);
assert.ok(
  compile("%>".repeat(100001)).diagnostics.some(
    (problem) => problem.code === "RESOURCE_LIMIT",
  ),
);
assert.ok(
  compileTxtJet({ fileName: template, readFile: () => undefined }).diagnostics
    .length,
);
console.log("txtjet compiler frontend tests ok");
