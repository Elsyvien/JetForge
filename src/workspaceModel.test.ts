import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  createTxtJetWorkspaceModel,
  isExcludedTxtJetWorkspacePath,
  TXTJET_WORKSPACE_EXCLUDE_GLOB,
  workspaceEntryKind
} from "./workspaceModel";

const root = resolve("workspace");
const main = join(root, "templates", "main.javajet");
const fragment = join(root, "templates", "partials", "header.jetinc");
const shared = join(root, "shared", "footer.txtjet");
const skeleton = join(root, "templates", "base.skeleton");
const ipxact = join(root, "ipxact", "component.propertiesjet");
const model = createTxtJetWorkspaceModel(
  [
    {
      fileName: main,
      text: [
        '<%@ jet package="demo" class="Main" skeleton="base" %>',
        '<%@ include file="partials/header" %>',
        '<%@ include file="footer" %>',
        '<%@ include file="missing" %>'
      ].join("\n")
    },
    {
      fileName: fragment,
      text: "header <%= title %>"
    },
    {
      fileName: shared,
      text: "footer"
    },
    {
      fileName: skeleton,
      text: "${packageDeclaration}\npublic class ${class} {\n${generateMethod}\n}"
    },
    {
      fileName: ipxact,
      text: '<%@ jet ipxact="true" %>\ncomponent.name=value'
    }
  ],
  {
    includePathsForFile(fileName) {
      return fileName === main ? [join(root, "shared")] : [];
    },
    skeletonPathsForFile(fileName) {
      return fileName === main ? [join(root, "templates")] : [];
    },
    ipxactEnabled: true
  }
);

assert.equal(workspaceEntryKind("example.txtjet"), "template");
assert.equal(workspaceEntryKind("component.propertiesjet"), "template");
assert.equal(workspaceEntryKind("partial.jetinc"), "include");
assert.equal(workspaceEntryKind("base.skeleton"), "skeleton");
assert.equal(model.templates.length, 3);
assert.equal(model.includes.length, 1);
assert.equal(model.skeletons.length, 1);
assert.deepEqual(model.ipxactTemplates.map((entry) => entry.fileName), [ipxact]);
assert.equal(model.entry(main)?.targetLanguage, "txtjet-java");

const includeReferences = model.referencesFrom(main, "include");
assert.equal(includeReferences.length, 3);
assert.equal(includeReferences.find((reference) => reference.referenceFile === "partials/header")?.resolvedFileName, fragment);
assert.equal(includeReferences.find((reference) => reference.referenceFile === "footer")?.resolvedFileName, shared);
assert.equal(includeReferences.find((reference) => reference.referenceFile === "missing")?.resolvedFileName, undefined);
assert.equal(model.unresolvedReferences.length, 1);
assert.equal(model.unresolvedReferences[0].referenceFile, "missing");
assert.equal(model.referenceExists(main, "partials/header", "include"), true);
assert.equal(model.referenceExists(main, "missing", "include"), false);
assert.deepEqual(model.includingTemplates(fragment).map((entry) => entry.fileName), [main]);
assert.deepEqual(model.entry(skeleton)?.skeletonUsedBy, [main]);

const circular = createTxtJetWorkspaceModel([
  { fileName: join(root, "a.txtjet"), text: '<%@ include file="b.txtjet" %>' },
  { fileName: join(root, "b.txtjet"), text: '<%@ include file="a.txtjet" %>' }
]);
assert.deepEqual(circular.includingTemplates(join(root, "a.txtjet")).map((entry) => entry.fileName), [join(root, "b.txtjet")]);
assert.deepEqual(circular.includingTemplates(join(root, "b.txtjet")).map((entry) => entry.fileName), [join(root, "a.txtjet")]);

const privateTemplate = join(root, "private-examples", "secret.txtjet");
const localToolTemplate = join(root, ".playwright-cli", "scratch.txtjet");
const ignored = createTxtJetWorkspaceModel([
  { fileName: privateTemplate, text: "secret" },
  { fileName: localToolTemplate, text: "scratch" },
  { fileName: join(root, "visible.txtjet"), text: "visible" }
]);
assert.equal(isExcludedTxtJetWorkspacePath(privateTemplate), true);
assert.equal(isExcludedTxtJetWorkspacePath(localToolTemplate), true);
assert.equal(isExcludedTxtJetWorkspacePath(join(root, "visible.txtjet")), false);
assert.equal(ignored.entry(privateTemplate), undefined);
assert.equal(ignored.entry(localToolTemplate), undefined);
assert.equal(ignored.templates.length, 1);
assert.equal(ignored.ipxactTemplates.length, 0);

assert.match(TXTJET_WORKSPACE_EXCLUDE_GLOB, /\.playwright-cli/);
assert.match(TXTJET_WORKSPACE_EXCLUDE_GLOB, /\.antigravitycli/);
assert.match(TXTJET_WORKSPACE_EXCLUDE_GLOB, /private-examples/);

console.log("workspace model tests ok");
