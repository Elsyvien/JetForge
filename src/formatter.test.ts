import assert from "node:assert/strict";
import { formatTxtJetBlock, MAX_FORMAT_NESTING_DEPTH } from "./formatter";
import { parseTxtJetTemplate } from "./templateModel";

assert.equal(formatFirst("<%=  name  %>"), " name ");
assert.equal(formatFirst("<% if (ready) { %>"), " if (ready) { ");
assert.equal(formatFirst("<%@ jet   package=\"demo\" class='Demo' %>"), " jet package=\"demo\" class=\"Demo\" ");
assert.equal(formatFirst("<%@ include file=missing.txtjet %>"), undefined);
assert.equal(formatFirst("<%@ include file=\"a.txtjet\" file=\"b.txtjet\" %>"), undefined);
assert.equal(formatFirst("<%@ 123bad value=\"x\" %>"), undefined);
assert.equal(formatFirst("<%@ %>"), undefined);
assert.match(formatFirst(`<%\n${"if (ready) {\n".repeat(12)}${"}\n".repeat(12)}%>`) ?? "", /if \(ready\)/);
assert.equal(
  formatFirst(`<%\n${"if (ready) {\n".repeat(MAX_FORMAT_NESTING_DEPTH)}%>`),
  undefined,
  "formatter must reject nesting that would exceed its allocation budget"
);
assert.equal(
  formatFirst(`<%\n${"x".repeat(1024 * 1024)}\n%>`),
  undefined,
  "formatter must reject output beyond its cumulative character budget"
);

console.log("formatter tests ok");

function formatFirst(text: string): string | undefined {
  const block = parseTxtJetTemplate(text).blocks[0];
  return block ? formatTxtJetBlock(block) : undefined;
}
