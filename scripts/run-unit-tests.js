"use strict";

const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const outputDirectory = join(__dirname, "..", "out");
const tests = readdirSync(outputDirectory)
  .filter((name) => name.endsWith(".test.js") && name !== "extensionHost.test.js")
  .sort();

for (const test of tests) {
  const result = spawnSync(process.execPath, [join(outputDirectory, test)], {
    cwd: join(__dirname, ".."),
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
