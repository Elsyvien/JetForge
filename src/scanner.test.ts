import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanTxtJetIssues } from "./scanner";

assert.deepEqual(scanTxtJetIssues("<% code(); %>"), []);
assert.equal(scanTxtJetIssues("<% code();").at(0)?.code, "unclosed-block");
assert.equal(scanTxtJetIssues("text %>").at(0)?.code, "unexpected-close");
assert.equal(scanTxtJetIssues("<%@ %>").at(0)?.code, "empty-directive");
assert.equal(scanTxtJetIssues("<%@ 123bad value=\"x\" %>").at(0)?.code, "malformed-directive");
assert.equal(scanTxtJetIssues("<%@ jet package=\"example class=\"Demo\" %>").at(0)?.code, "unterminated-directive-string");
assert.deepEqual(scanTxtJetIssues("<%@ jet package=\"example\" class=\"Demo\" %>"), []);
assert.deepEqual(scanTxtJetIssues(fixture("valid")).map((issue) => issue.code), []);
assert.deepEqual(scanTxtJetIssues(fixture("malformed")).map((issue) => issue.code), [
  "unexpected-close",
  "empty-directive",
  "malformed-directive",
  "unterminated-directive-string",
  "unclosed-block"
]);

console.log("scanner tests ok");

function fixture(name: string): string {
  return readFileSync(`test-fixtures/scanner/${name}.txtjet`, "utf8");
}
