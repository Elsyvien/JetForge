import assert from "node:assert/strict";
import {
  createJavaWorkspaceIndex,
  referencedWorkspaceJavaClasses,
  workspaceJavaClassDependencies,
  workspaceJavaCompletionsAt,
  workspaceJavaDefinitionsAt,
  workspaceJavaHoverAt,
  workspaceJavaSignatureHelpAt
} from "./javaWorkspaceIntelligence";

const serviceFile = "/workspace/templates/Service.txtjet";
const consumerFile = "/workspace/templates/Consumer.txtjet";
const externalFile = "/workspace/shared/ExternalService.txtjet";

const service = `<%@ jet package="demo" class="Service" %>
<%!
public String render(String name) {
    return name;
}
public String render(String name, int count) {
    return name.repeat(count);
}
public static Service create() {
    return new Service();
}
private void resetSecret() {
}
%>`;

const external = `<%@ jet package="shared" class="ExternalService" %>
<%!
public void execute() {
}
%>`;

const consumer = `<%@ jet package="demo" class="Consumer" imports="shared.ExternalService" %>
<%!
private Service service = new Service();
private ExternalService external = new ExternalService();
%>
<%
service.ren
this.service.render("x", 2);
Service.cre
Service.create().ren
external.exe
%>`;

const index = createJavaWorkspaceIndex([
  { fileName: serviceFile, text: service },
  { fileName: consumerFile, text: consumer },
  { fileName: externalFile, text: external }
]);

assert.deepEqual(index.classes.map((entry) => entry.qualifiedName), ["demo.Consumer", "demo.Service", "shared.ExternalService"]);
assert.deepEqual(index.classForFile(serviceFile)?.methods.map((method) => method.name), ["render", "render", "create", "resetSecret"]);

const instanceCompletionOffset = consumer.indexOf("service.ren") + "service.ren".length;
const instanceCompletions = workspaceJavaCompletionsAt(index, consumerFile, consumer, instanceCompletionOffset);
assert.equal(instanceCompletions.length, 2);
assert.ok(instanceCompletions.every((completion) => completion.label === "render"));
assert.ok(instanceCompletions.every((completion) => completion.detail.includes("demo.Service")));
assert.equal(instanceCompletions.some((completion) => completion.label === "resetSecret"), false);
assert.equal(consumer.slice(instanceCompletions[0].range.start, instanceCompletions[0].range.end), "ren");

const staticCompletionOffset = consumer.indexOf("Service.cre") + "Service.cre".length;
const staticCompletions = workspaceJavaCompletionsAt(index, consumerFile, consumer, staticCompletionOffset);
assert.deepEqual(staticCompletions.map((completion) => completion.label), ["create"]);

const chainedCompletionOffset = consumer.indexOf("Service.create().ren") + "Service.create().ren".length;
const chainedCompletions = workspaceJavaCompletionsAt(index, consumerFile, consumer, chainedCompletionOffset);
assert.equal(chainedCompletions.length, 2);
assert.ok(chainedCompletions.every((completion) => completion.label === "render"));

const externalCompletionOffset = consumer.indexOf("external.exe") + "external.exe".length;
assert.deepEqual(
  workspaceJavaCompletionsAt(index, consumerFile, consumer, externalCompletionOffset).map((completion) => completion.label),
  ["execute"]
);

const transitive = `<%@ jet package="demo" class="Service" %>\n<%! private ExternalService external = new ExternalService(); %>`;
const transitiveIndex = createJavaWorkspaceIndex([
  { fileName: serviceFile, text: transitive },
  { fileName: consumerFile, text: consumer },
  { fileName: externalFile, text: external }
]);
assert.deepEqual(
  workspaceJavaClassDependencies(transitiveIndex, consumerFile).map((dependency) =>
    `${dependency.sourceClass.qualifiedName}->${dependency.targetClass.qualifiedName}`
  ),
  ["demo.Consumer->demo.Service", "demo.Consumer->shared.ExternalService", "demo.Service->shared.ExternalService"]
);

const definitionOffset = consumer.indexOf("service.render") + "service.".length + 2;
const definitions = workspaceJavaDefinitionsAt(index, consumerFile, consumer, definitionOffset);
assert.equal(definitions.length, 2);
assert.ok(definitions.every((definition) => definition.fileName === serviceFile));
assert.ok(definitions.every((definition) => service.slice(definition.range.start, definition.range.end) === "render"));

const classDefinitionOffset = consumer.indexOf("new Service") + "new ".length + 2;
const classDefinitions = workspaceJavaDefinitionsAt(index, consumerFile, consumer, classDefinitionOffset);
assert.equal(classDefinitions.length, 1);
assert.equal(classDefinitions[0].fileName, serviceFile);
assert.equal(service.slice(classDefinitions[0].range.start, classDefinitions[0].range.end), "Service");

const hover = workspaceJavaHoverAt(index, consumerFile, consumer, definitionOffset);
assert.ok(hover?.title.includes("demo.Service"));
assert.equal(hover?.signatures.length, 2);

const signatureOffset = consumer.indexOf("service.render(\"x\", 2") + "service.render(\"x\", ".length;
const signatureHelp = workspaceJavaSignatureHelpAt(index, consumerFile, consumer, signatureOffset);
assert.equal(signatureHelp?.activeParameter, 1);
assert.equal(signatureHelp?.signatures.length, 2);

assert.deepEqual(
  referencedWorkspaceJavaClasses(index, consumerFile, consumer).map((entry) => entry.qualifiedName),
  ["demo.Service", "shared.ExternalService"]
);

const unimportedConsumer = `<%@ jet package="other" class="OtherConsumer" %>\n<% Ext %>`;
const unimportedFile = "/workspace/other/OtherConsumer.txtjet";
const unimportedIndex = createJavaWorkspaceIndex([
  { fileName: externalFile, text: external },
  { fileName: unimportedFile, text: unimportedConsumer }
]);
const classCompletionOffset = unimportedConsumer.indexOf("Ext") + "Ext".length;
const classCompletion = workspaceJavaCompletionsAt(unimportedIndex, unimportedFile, unimportedConsumer, classCompletionOffset)[0];
assert.equal(classCompletion.label, "ExternalService");
assert.equal(classCompletion.insertText, "shared.ExternalService");

console.log("Java workspace intelligence tests ok");
