import assert from "node:assert/strict";
import {
  classifyTxtJetRegionAt,
  classifyTxtJetRegions
} from "./regionClassifier";

const mixedXml = `<root attr="<%= value %>">
<%@ include file="item.xmljet" %>
<% if (ready) { %>
<item>text</item>
<%! private int count; %>
</root>`;

const regions = classifyTxtJetRegions(mixedXml, "txtjet-xml");

assert.ok(regions.some((region) =>
  region.kind === "generated-output"
  && mixedXml.slice(region.range.start, region.range.end).includes("<root attr=\"")
  && region.targetLanguage === "txtjet-xml"
));
assert.ok(regions.some((region) =>
  region.kind === "directive"
  && mixedXml.slice(region.range.start, region.range.end).includes("include file")
));
assert.ok(regions.some((region) =>
  region.kind === "template-java"
  && region.blockKind === "scriptlet"
  && mixedXml.slice(region.range.start, region.range.end).includes("if (ready)")
));
assert.ok(regions.some((region) =>
  region.kind === "template-java"
  && region.blockKind === "expression"
  && mixedXml.slice(region.range.start, region.range.end).includes("value")
));
assert.ok(regions.some((region) =>
  region.kind === "template-java"
  && region.blockKind === "declaration"
  && mixedXml.slice(region.range.start, region.range.end).includes("private int count")
));
assert.equal(regions.filter((region) => region.kind === "marker").length, 8);

assert.equal(classifyTxtJetRegionAt(mixedXml, mixedXml.indexOf("<root"), "txtjet-xml")?.kind, "generated-output");
assert.equal(classifyTxtJetRegionAt(mixedXml, mixedXml.indexOf("<%="), "txtjet-xml")?.kind, "marker");
assert.equal(classifyTxtJetRegionAt(mixedXml, mixedXml.indexOf("value"), "txtjet-xml")?.kind, "template-java");
assert.equal(classifyTxtJetRegionAt(mixedXml, mixedXml.indexOf("include"), "txtjet-xml")?.kind, "directive");
assert.equal(classifyTxtJetRegionAt(mixedXml, mixedXml.indexOf("<item>"), "txtjet-xml")?.kind, "generated-output");

const htmlWithComment = `<!-- <%= title %> --><a href="<%= href %>">Link</a>`;
const htmlRegions = classifyTxtJetRegions(htmlWithComment, "txtjet-html");
assert.ok(htmlRegions.some((region) =>
  region.kind === "generated-output"
  && htmlWithComment.slice(region.range.start, region.range.end).includes("<!-- ")
));
assert.equal(classifyTxtJetRegionAt(htmlWithComment, htmlWithComment.indexOf("href"), "txtjet-html")?.kind, "generated-output");
assert.equal(classifyTxtJetRegionAt(htmlWithComment, htmlWithComment.indexOf("title"), "txtjet-html")?.kind, "template-java");

console.log("region classifier tests ok");
