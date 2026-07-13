import assert from "node:assert/strict";
import { VersionedPreviewCache } from "./previewCache";

const cache = new VersionedPreviewCache<object>(2);
let builds = 0;
const build = (): object => ({ build: ++builds });

const first = cache.getOrCreate("file:///template.txtjet", 1, "output", build);
assert.equal(cache.getOrCreate("file:///template.txtjet", 1, "output", build), first);
assert.equal(builds, 1);

const secondVersion = cache.getOrCreate("file:///template.txtjet", 2, "output", build);
assert.notEqual(secondVersion, first);
assert.equal(builds, 2);

cache.getOrCreate("file:///template.txtjet", 2, "java", build);
cache.getOrCreate("file:///template.txtjet", 1, "output", build);
assert.equal(builds, 4, "bounded eviction should rebuild the oldest cache generation");

cache.invalidate();
cache.getOrCreate("file:///template.txtjet", 2, "output", build);
assert.equal(builds, 5);

console.log("preview cache tests ok");
