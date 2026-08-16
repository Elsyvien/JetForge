import * as assert from "node:assert/strict";
import { createJavaWorkspaceIndex } from "./javaWorkspaceIntelligence";
import {
  formatRefactorPlanMarkdown,
  planHelperExtraction,
  planImportCleanup,
  planWorkspaceClassRename
} from "./refactorPlans";

const serviceFile = "/workspace/Service.txtjet";
const consumerFile = "/workspace/Consumer.txtjet";
const service = `<%@ jet package="demo" class="Service" imports="java.util.List" %>
<%! public String name() { return "service"; } %>`;
const consumer = `<%@ jet package="demo" class="Consumer" imports="demo.Service, demo.Service, java.util.Map" %>
<% Service service = new demo.Service(); stringBuffer.append(service.name()); %>`;
const index = createJavaWorkspaceIndex([
  { fileName: serviceFile, text: service },
  { fileName: consumerFile, text: consumer }
]);

const rename = planWorkspaceClassRename(index, serviceFile, "CatalogService");
assert.equal(rename.edits.filter((edit) => edit.fileName === serviceFile).length, 1);
assert.ok(rename.edits.some((edit) => edit.newText === "CatalogService"));
assert.ok(rename.edits.some((edit) => edit.newText === "demo.CatalogService"));
for (let left = 0; left < rename.edits.length; left += 1) {
  for (let right = left + 1; right < rename.edits.length; right += 1) {
    const a = rename.edits[left];
    const b = rename.edits[right];
    assert.ok(a.fileName !== b.fileName || a.range.end <= b.range.start || b.range.end <= a.range.start);
  }
}

assert.throws(() => planWorkspaceClassRename(index, serviceFile, "1Invalid"), /valid Java identifier/);
assert.throws(() => planWorkspaceClassRename(index, serviceFile, "Consumer"), /already declares/);

const imports = planImportCleanup(consumerFile, consumer);
assert.equal(imports.edits[0].newText, "demo.Service, java.util.Map");

const helperSource = `<%@ jet package="demo" class="HelperTemplate" %>\n<% stringBuffer.append("hello"); %>`;
const statement = "stringBuffer.append(\"hello\");";
const statementStart = helperSource.indexOf(statement);
const helper = planHelperExtraction(consumerFile, helperSource, {
  start: statementStart,
  end: statementStart + statement.length
}, "renderGreeting");
assert.equal(helper.edits.length, 2);
assert.ok(helper.edits.some((edit) => edit.newText === "renderGreeting();"));
assert.ok(helper.edits.some((edit) => edit.newText.includes("private void renderGreeting()")));

const localStatement = "service.name()";
const localStart = consumer.indexOf(localStatement);
assert.throws(() => planHelperExtraction(consumerFile, consumer, {
  start: localStart,
  end: localStart + localStatement.length
}, "unsafeHelper"), /local values/);

const markdown = formatRefactorPlanMarkdown(imports, () => consumer, (fileName) => fileName);
assert.match(markdown, /```diff/);
assert.match(markdown, /-demo.Service, demo.Service, java.util.Map/);
assert.match(markdown, /\+demo.Service, java.util.Map/);

console.log("refactor plan tests ok");
