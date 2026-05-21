import assert from "node:assert/strict";
import { formatTxtJetBlock } from "./formatter";
import { parseTxtJetTemplate } from "./templateModel";

assert.equal(formatFirst("<%=  name  %>"), " name ");
assert.equal(formatFirst("<% if (ready) { %>"), " if (ready) { ");
assert.equal(formatFirst("<%@ jet   package=\"demo\" class='Demo' %>"), " jet package=\"demo\" class=\"Demo\" ");
assert.equal(formatFirst("<%@ include file=missing.txtjet %>"), undefined);
assert.equal(formatFirst("<%@ include file=\"a.txtjet\" file=\"b.txtjet\" %>"), undefined);
assert.equal(formatFirst("<%@ 123bad value=\"x\" %>"), undefined);
assert.equal(formatFirst("<%@ %>"), undefined);

console.log("formatter tests ok");

function formatFirst(text: string): string | undefined {
  const block = parseTxtJetTemplate(text).blocks[0];
  return block ? formatTxtJetBlock(block) : undefined;
}
