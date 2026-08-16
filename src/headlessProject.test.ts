import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateJetForgeCase,
  generateJetForgeProject,
  inspectJetForgeProject,
  loadJetForgeProject,
  runJetForgeGoldenTests,
  validateJetForgeProject
} from "./headlessProject";
import { goldenJunit, validationSarif } from "./headlessReports";

void run();

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "jetforge-headless-"));
  try {
  mkdirSync(join(root, "templates", "partials"), { recursive: true });
  mkdirSync(join(root, "fixtures"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "templates", "partials", "header.jetinc"), "// header\n", "utf8");
  writeFileSync(join(root, "templates", "sample.javajet"), [
    '<%@ jet package="demo" class="Sample" %>',
    '<%@ include file="partials/header.jetinc" %>',
    "public class Sample {}",
    ""
  ].join("\n"), "utf8");
  writeFileSync(join(root, "templates", "fixture.txtjet"), '<%@ jet package="demo" class="Fixture" %>\nHello <%= model.name %>!\n', "utf8");
  writeFileSync(join(root, "fixtures", "ada.json"), '{"name":"Ada"}\n', "utf8");
  writeFileSync(join(root, "scripts", "evaluate.js"), [
    'const fs = require("node:fs");',
    'const [, , input, fixture, output] = process.argv;',
    'const data = JSON.parse(fs.readFileSync(fixture, "utf8"));',
    'const text = fs.readFileSync(input, "utf8").replace(/<%@[^%]*%>\\s*/g, "").replace(/<%=\\s*model\\.name\\s*%>/g, data.name);',
    'fs.writeFileSync(output, text, "utf8");'
  ].join("\n"), "utf8");
  writeFileSync(join(root, ".jetforge.json"), JSON.stringify({
    version: 1,
    sourcePaths: ["templates"],
    outputDirectory: "generated",
    tests: [
      {
        name: "preview",
        template: "templates/sample.javajet",
        expected: "expected/sample.java",
        targetLanguage: "txtjet-java"
      },
      {
        name: "fixture",
        template: "templates/fixture.txtjet",
        fixture: "fixtures/ada.json",
        expected: "expected/fixture.txt",
        mode: "command",
        command: "node scripts/evaluate.js ${file} ${fixture} ${outputFile}"
      }
    ]
  }, null, 2), "utf8");

  const project = loadJetForgeProject(root);
  assert.equal(project.model.templates.length, 2);
  assert.equal(project.model.includes.length, 1);
  assert.equal(project.model.unresolvedReferences.length, 0);
  assert.equal(validateJetForgeProject(project).ok, true);
  assert.equal(inspectJetForgeProject(project).failed, 0);

  const generated = generateJetForgeProject(project);
  assert.equal(generated.length, 2);
  const sampleOutput = generated.find((entry) => entry.source.endsWith("sample.javajet"));
  assert.ok(sampleOutput);
  assert.match(readFileSync(sampleOutput.output, "utf8"), /header/);

  const updated = await runJetForgeGoldenTests(project, true);
  assert.equal(updated.updated, 2);
  assert.equal(updated.ok, true);
  const passing = await runJetForgeGoldenTests(loadJetForgeProject(root));
  assert.equal(passing.passed, 2);
  assert.equal(passing.ok, true);
  assert.match(goldenJunit(passing), /tests="2" failures="0"/);
  const evaluated = await evaluateJetForgeCase(loadJetForgeProject(root), "fixture");
  assert.match(evaluated.content, /Hello Ada!/);
  assert.equal(evaluated.testCase.mode, "command");

  writeFileSync(join(root, "templates", "sample.javajet"), readFileSync(join(root, "templates", "sample.javajet"), "utf8") + "changed\n", "utf8");
  const failing = await runJetForgeGoldenTests(loadJetForgeProject(root));
  assert.equal(failing.failed, 1);
  assert.match(failing.results.find((entry) => entry.name === "preview")?.firstDifference ?? "", /First difference/);

  const sarif = validationSarif(validateJetForgeProject(loadJetForgeProject(root))) as { version: string; runs: unknown[] };
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs.length, 1);

  assert.throws(() => {
    writeFileSync(join(root, ".jetforge.json"), JSON.stringify({ sourcePaths: ["../escape"] }), "utf8");
    loadJetForgeProject(root);
  }, /escapes the workspace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log("headless project tests ok");
}
