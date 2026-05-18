import assert from "node:assert/strict";
import { buildTxtJetCodeActionEdit } from "./codeActions";
import { scanTxtJetIssues } from "./scanner";

assert.deepEqual(fix("text %>", "unexpected-close")?.edit, {
  start: 5,
  end: 7,
  newText: ""
});

assert.deepEqual(fix("<% code();", "unclosed-block")?.edit, {
  start: 10,
  end: 10,
  newText: "%>"
});

assert.deepEqual(fix("<%@ %>", "empty-directive")?.edit, {
  start: 3,
  end: 4,
  newText: " jet "
});

assert.deepEqual(fix("<%@ 123bad value=\"x\" %>", "malformed-directive")?.edit, {
  start: 4,
  end: 10,
  newText: "jet"
});

assert.deepEqual(fix("<%@ jet package=\"example %>", "unterminated-directive-string")?.edit, {
  start: 25,
  end: 25,
  newText: "\""
});

assert.deepEqual(fix("<%@ jet package='example %>", "unterminated-directive-string")?.edit, {
  start: 25,
  end: 25,
  newText: "'"
});

console.log("code action tests ok");

function fix(text: string, code: ReturnType<typeof scanTxtJetIssues>[number]["code"]) {
  const issue = scanTxtJetIssues(text).find((candidate) => candidate.code === code);
  assert.ok(issue, `Expected ${code}`);
  return buildTxtJetCodeActionEdit(text, issue);
}
