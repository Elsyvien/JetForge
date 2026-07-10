import assert from "node:assert/strict";
import { ValidationRunCoordinator } from "./validationRuns";

const runs = new ValidationRunCoordinator();
const first = runs.begin("file:///workspace/template.txtjet", 1);
assert.equal(runs.isCurrent("file:///workspace/template.txtjet", first, 1), true);

const second = runs.begin("file:///workspace/template.txtjet", 1);
assert.equal(first.signal.aborted, true);
assert.equal(runs.isCurrent("file:///workspace/template.txtjet", first, 1), false);
assert.equal(runs.isCurrent("file:///workspace/template.txtjet", second, 1), true);
assert.equal(runs.isCurrent("file:///workspace/template.txtjet", second, 2), false);
assert.equal(runs.isCurrent("file:///workspace/template.txtjet", second, 1, true), false);

runs.invalidate("file:///workspace/template.txtjet");
assert.equal(second.signal.aborted, true);
assert.equal(runs.isCurrent("file:///workspace/template.txtjet", second, 1), false);

const unrelated = runs.begin("file:///workspace/other.txtjet", 4);
runs.finish("file:///workspace/other.txtjet", unrelated);
assert.equal(runs.isCurrent("file:///workspace/other.txtjet", unrelated, 4), true);

const active = runs.begin("file:///workspace/active.txtjet", 7);
runs.dispose();
assert.equal(active.signal.aborted, true);

console.log("validation run tests ok");
