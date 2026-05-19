import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanTxtJetDirectiveIssues, scanTxtJetIssues } from "./scanner";

assert.deepEqual(scanTxtJetIssues("<% code(); %>"), []);
assert.equal(scanTxtJetIssues("<% code();").at(0)?.code, "unclosed-block");
assert.equal(scanTxtJetIssues("text %>").at(0)?.code, "unexpected-close");
assert.equal(scanTxtJetIssues("<%@ %>").at(0)?.code, "empty-directive");
assert.equal(scanTxtJetIssues("<%@ 123bad value=\"x\" %>").at(0)?.code, "malformed-directive");
assert.equal(scanTxtJetIssues("<%@ jet package=\"example class=\"Demo\" %>").at(0)?.code, "unterminated-directive-string");
assert.deepEqual(scanTxtJetIssues("<%@ jet package=\"example\" class=\"Demo\" %>"), []);
assert.deepEqual(scanTxtJetIssues("<%@ jet package='example' class='Demo' %>"), []);
assert.equal(scanTxtJetIssues("<%@ jet package='example %>").at(0)?.code, "unterminated-directive-string");
assert.deepEqual(scanTxtJetIssues("a<%= one %>b<% two(); %>c<%! int value; %>"), []);
assert.deepEqual(scanTxtJetIssues("<%@ jet package=\"a\\\"b\" class='Demo' %>"), []);
assert.deepEqual(scanTxtJetIssues("prefix <% if (ready) { %> body <% } %> suffix"), []);
assert.deepEqual(scanTxtJetIssues("<%@ include file=\"part.txtjet\" %>\n<%@ jet package=\"demo\" class=\"Demo\" %>"), []);
assert.deepEqual(scanTxtJetIssues(fixture("valid")).map((issue) => issue.code), []);
assert.deepEqual(scanTxtJetIssues(fixture("malformed")).map((issue) => issue.code), [
  "unexpected-close",
  "empty-directive",
  "malformed-directive",
  "unterminated-directive-string",
  "unclosed-block"
]);

assert.deepEqual(scanTxtJetDirectiveIssues("<%@ jet package=\"demo\" %>\n<%@ jet class=\"Demo\" %>").map((issue) => issue.code), [
  "duplicate-jet-directive"
]);
assert.deepEqual(scanTxtJetDirectiveIssues("<%@ include %>").map((issue) => issue.code), ["missing-include-file"]);
assert.deepEqual(scanTxtJetDirectiveIssues("<%@ include file=\"missing.txtjet\" %>", () => false).map((issue) => issue.code), [
  "unresolved-include-file"
]);
assert.deepEqual(scanTxtJetDirectiveIssues("<%@ unknown value=\"x\" %>").map((issue) => issue.code), ["unknown-directive"]);
assert.deepEqual(scanTxtJetDirectiveIssues("<%@ jet package=\"a\\\"b\" class='Demo' %>").map((issue) => issue.code), []);
assert.deepEqual(scanTxtJetDirectiveIssues("<%@ include file=missing.txtjet %>").map((issue) => issue.code), [
  "malformed-directive-attribute",
  "missing-include-file"
]);

console.log("scanner tests ok");

function fixture(name: string): string {
  return readFileSync(`test-fixtures/scanner/${name}.txtjet`, "utf8");
}
