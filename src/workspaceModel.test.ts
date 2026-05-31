import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  createTxtJetWorkspaceModel,
  workspaceEntryKind
} from "./workspaceModel";

const root = resolve("workspace");
const main = join(root, "templates", "main.javajet");
const fragment = join(root, "templates", "partials", "header.jetinc");
const shared = join(root, "shared", "footer.txtjet");
const skeleton = join(root, "templates", "base.skeleton");
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
    }
  ],
  {
    includePathsForFile(fileName) {
      return fileName === main ? [join(root, "shared")] : [];
    },
    skeletonPathsForFile(fileName) {
      return fileName === main ? [join(root, "templates")] : [];
    }
  }
);

assert.equal(workspaceEntryKind("example.txtjet"), "template");
assert.equal(workspaceEntryKind("partial.jetinc"), "include");
assert.equal(workspaceEntryKind("base.skeleton"), "skeleton");
assert.equal(model.templates.length, 2);
assert.equal(model.includes.length, 1);
assert.equal(model.skeletons.length, 1);
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

console.log("workspace model tests ok");
