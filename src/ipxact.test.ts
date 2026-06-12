import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  globMatchesPath,
  hasIpxactMetadata,
  isIpxactTemplate,
  mapIpxactProblemsToSource
} from "./ipxact";
import { buildGeneratedOutputPreview } from "./templateModel";

assert.equal(hasIpxactMetadata('<%@ jet ipxact="true" %>'), true);
assert.equal(hasIpxactMetadata('<%@ jet ipxact="yes" %>'), true);
assert.equal(hasIpxactMetadata('<%@ jet ipxact="false" %>'), false);
assert.equal(hasIpxactMetadata("<%@ jet %>"), false);

assert.equal(isIpxactTemplate("/workspace/templates/component.txtjet", '<%@ jet ipxact="true" %>', { enabled: true }), true);
assert.equal(isIpxactTemplate("/workspace/templates/component.txtjet", '<%@ jet ipxact="true" %>', { enabled: false }), false);
assert.equal(isIpxactTemplate("/workspace/ipxact/component.txtjet", "<component/>", {
  enabled: true,
  templateGlobs: ["ipxact/**/*.txtjet"]
}), true);
assert.equal(isIpxactTemplate("/workspace/other/component.txtjet", "<component/>", {
  enabled: true,
  templateGlobs: ["ipxact/**/*.txtjet"]
}), false);

assert.equal(globMatchesPath("ipxact/**/*.txtjet", "/workspace/ipxact/component.txtjet"), true);
assert.equal(globMatchesPath("ipxact/**/*.txtjet", "/workspace/ipxact/vendor/component.txtjet"), true);
assert.equal(globMatchesPath("ipxact/**/*.txtjet", "/Users/max/project/ipxact/vendor/component.txtjet"), true);
assert.equal(globMatchesPath("**/*.ipxact.txtjet", "/workspace/templates/demo.ipxact.txtjet"), true);
assert.equal(globMatchesPath("**/*.ipxact.txtjet", "/workspace/templates/demo.txtjet"), false);

const workspace = resolve("workspace");
const generated = join(workspace, "generated-ipxact", "component.xml");
const template = [
  '<%@ jet ipxact="true" %>',
  "<component>",
  "  <vendor><%= vendor %></vendor>",
  "</component>"
].join("\n");
const preview = buildGeneratedOutputPreview(template, "txtjet-xml");
const line = preview.text.slice(0, preview.text.indexOf("<vendor>")).split("\n").length;
const mapped = mapIpxactProblemsToSource(
  [{
    file: join("generated-ipxact", "component.xml"),
    line,
    column: 3,
    severity: "error",
    message: "schema violation"
  }],
  preview,
  generated,
  workspace
);
assert.equal(mapped.length, 1);
assert.equal(mapped[0].mappedFrom, "generated-output");
assert.match(template.slice(mapped[0].sourceRange.start, mapped[0].sourceRange.end), /vendor/);

const misleadingSameBasename = mapIpxactProblemsToSource(
  [{
    file: join("other-output", "component.xml"),
    line,
    column: 3,
    severity: "error",
    message: "wrong generated file"
  }],
  preview,
  generated,
  workspace
);
assert.equal(misleadingSameBasename.length, 0);

const bareGeneratedBasename = mapIpxactProblemsToSource(
  [{
    file: "component.xml",
    line,
    column: 3,
    severity: "error",
    message: "bare generated filename"
  }],
  preview,
  generated,
  workspace
);
assert.equal(bareGeneratedBasename.length, 1);

const directiveLine = preview.text.slice(0, preview.text.indexOf("txtjet directive")).split("\n").length;
const unmapped = mapIpxactProblemsToSource(
  [{
    file: generated,
    line: directiveLine,
    column: 1,
    severity: "warning",
    message: "directive comment should not map"
  }],
  preview,
  generated,
  workspace
);
assert.equal(unmapped.length, 0);

console.log("ipxact tests ok");
