import assert from "node:assert/strict";
import { scanTxtJetIssues } from "./scanner";

assert.deepEqual(scanTxtJetIssues("<% code(); %>"), []);
assert.equal(scanTxtJetIssues("<% code();").at(0)?.code, "unclosed-block");
assert.equal(scanTxtJetIssues("text %>").at(0)?.code, "unexpected-close");
assert.equal(scanTxtJetIssues("<%@ %>").at(0)?.code, "empty-directive");
assert.equal(scanTxtJetIssues("<%@ 123bad value=\"x\" %>").at(0)?.code, "malformed-directive");
assert.equal(scanTxtJetIssues("<%@ jet package=\"example class=\"Demo\" %>").at(0)?.code, "unterminated-directive-string");
assert.deepEqual(scanTxtJetIssues("<%@ jet package=\"example\" class=\"Demo\" %>"), []);

console.log("scanner tests ok");
