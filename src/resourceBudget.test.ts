import assert from "node:assert/strict";
import { ResourceBudget, ResourceLimitError } from "./resourceBudget";

const budget = new ResourceBudget({ files: 2, bytes: 5 });
budget.consume("files");
budget.consume("files");
budget.consume("bytes", 3);
budget.consume("bytes", 2);
assert.equal(budget.usage("files"), 2);
assert.equal(budget.usage("bytes"), 5);
assert.throws(() => budget.consume("files"), (error: unknown) =>
  error instanceof ResourceLimitError && error.resource === "files" && error.limit === 2
);
assert.equal(budget.usage("files"), 2, "a rejected reservation must not mutate usage");
assert.throws(() => budget.consume("bytes", -1), /Invalid bytes budget amount/);

console.log("resource budget tests ok");
