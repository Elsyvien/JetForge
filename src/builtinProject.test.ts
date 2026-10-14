import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  builtinResultsText,
  runBuiltinTarget,
  runBuiltinTargets,
  validateBuiltinConfig,
} from "./builtinProject";
import {
  evaluateJetForgeCase,
  generateJetForgeProject,
  inspectJetForgeProject,
  JetForgeProjectConfig,
  loadJetForgeProject,
  runJetForgeGoldenTests,
  validateJetForgeProject,
} from "./headlessProject";

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "jetforge-v2-"));
  try {
    cpSync(resolve("compatibility-projects/builtin-compiler"), root, {
      recursive: true,
    });
    const configFile = join(root, ".jetforge.json");
    const source = readFileSync(configFile, "utf8");
    const config = (): JetForgeProjectConfig => JSON.parse(source);
    const project = loadJetForgeProject(root);
    assert.equal(validateJetForgeProject(project).ok, true);
    assert.equal(inspectJetForgeProject(project).ok, true);
    assert.equal(project.config.tests![0].mode, "builtin");
    assert.throws(() => generateJetForgeProject(project), /Builtin/);
    const compiled = await runBuiltinTargets(project, "compile");
    assert.equal(
      compiled.every((result) => result.ok),
      true,
      builtinResultsText(compiled),
    );
    assert.equal(existsSync(join(root, "generated/component-demo.xml")), false);
    const golden = await runJetForgeGoldenTests(project);
    assert.equal(golden.ok, true, JSON.stringify(golden));
    assert.equal(golden.passed, 2);
    const evaluated = await evaluateJetForgeCase(
      project,
      "component-demo-golden",
    );
    assert.equal(
      evaluated.content,
      readFileSync(join(root, "golden/component-demo.xml"), "utf8"),
    );
    const generated = await runBuiltinTargets(
      project,
      "generate",
      "component-demo",
    );
    assert.equal(generated[0].ok, true);
    assert.equal(
      readFileSync(join(root, "generated/component-demo.xml"), "utf8"),
      evaluated.content,
    );
    const before = readFileSync(join(root, "generated/component-demo.xml"));
    writeFileSync(configFile, source + "\n");
    const staleConfig = await runBuiltinTargets(project, "generate", "component-demo");
    assert.equal(staleConfig[0].ok, false);
    assert.equal(staleConfig[0].diagnostics[0].code, "STALE");
    assert.deepEqual(readFileSync(join(root, "generated/component-demo.xml")), before);
    writeFileSync(configFile, source);
    const original = readFileSync(
      join(root, "templates/partials/register.jetinc"),
      "utf8",
    );
    writeFileSync(
      join(root, "templates/partials/register.jetinc"),
      "<%= noSuchVariable %>",
    );
    const failed = await runBuiltinTargets(
      loadJetForgeProject(root),
      "generate",
      "component-demo",
    );
    assert.equal(failed[0].ok, false);
    assert.deepEqual(
      readFileSync(join(root, "generated/component-demo.xml")),
      before,
    );
    writeFileSync(join(root, "templates/partials/register.jetinc"), original);
    await assert.rejects(
      runBuiltinTarget(project, "missing", "evaluate"),
      /Unknown/,
    );
    await assert.rejects(
      runBuiltinTargets(loadJetForgeProject(resolve(".")), "compile"),
      /version 2/,
    );
    const changed = (mutate: (value: JetForgeProjectConfig) => void): void => {
      const value = config();
      mutate(value);
      assert.throws(() => validateBuiltinConfig(value, root));
    };
    changed((value) => {
      value.compiler!.dialect = "unsupported" as never;
    });
    changed((value) => {
      value.compiler!.command = "command";
    });
    changed((value) => {
      value.compiler!.release = 8;
    });
    changed((value) => {
      value.compiler!.timeoutMs = 5;
    });
    changed((value) => {
      value.compiler!.classpath = ["../outside.jar"];
    });
    changed((value) => {
      value.compiler!.sourceRoots = "wrong" as never;
    });
    changed((value) => {
      value.compiler!.modelProvider = "wrong name";
    });
    changed((value) => {
      value.includePaths = "wrong" as never;
    });
    changed((value) => {
      value.sourcePaths = Array(65).fill("templates");
    });
    changed((value) => {
      value.targets = [];
    });
    changed((value) => {
      value.targets![1].name = value.targets![0].name;
    });
    changed((value) => {
      value.targets![0].template = "templates/no.java";
    });
    changed((value) => {
      value.targets![0].fixture = "../escape.json";
    });
    changed((value) => {
      value.targets![1].output = value.targets![0].output;
    });
    changed((value) => {
      value.targets![0].output = value.targets![0].template;
    });
    changed((value) => {
      value.targets![0].output = ".jetforge.json";
    });
    changed((value) => {
      value.targets![0].output = value.tests![0].expected;
    });
    changed((value) => {
      value.tests![0].expected = value.targets![0].fixture!;
    });
    changed((value) => {
      value.tests![1].name = value.tests![0].name;
    });
    changed((value) => {
      value.tests![0].target = "missing";
    });
    changed((value) => {
      value.tests![0].mode = "command";
    });
    changed((value) => {
      delete value.tests![0].target;
      value.tests![0].template = "templates/component.xmljet";
      value.tests![0].mode = "builtin";
    });
    const cli = (args: string[]) =>
      spawnSync(
        process.execPath,
        [resolve("out/cli.js"), ...args, "--root", root],
        { encoding: "utf8" },
      );
    const doctor = cli(["doctor", "--format", "json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(
      JSON.parse(doctor.stdout).checks.some(
        (check: { id: string }) => check.id === "jdk",
      ),
      true,
    );
    assert.equal(cli(["compile", "--target", "component-demo"]).status, 0);
    assert.equal(cli(["evaluate", "--target", "component-demo"]).status, 0);
    const sarif = cli(["validate", "--compiler", "--format", "sarif"]);
    assert.equal(sarif.status, 0, sarif.stderr);
    assert.equal(JSON.parse(sarif.stdout).version, "2.1.0");
    assert.equal(
      cli(["generate", "--target", "component-demo", "--format", "json"])
        .status,
      0,
    );
    assert.equal(cli(["compile", "--target", "missing"]).status, 2);
    assert.equal(cli(["doctor", "--compiler"]).status, 2);
    assert.equal(cli(["test", "--target", "component-demo"]).status, 2);
    assert.equal(cli(["validate", "--target", "component-demo"]).status, 2);
    assert.equal(cli(["compile", "--format", "sarif"]).status, 2);
    assert.equal(cli(["test", "--format", "junit"]).status, 0);
    writeFileSync(configFile, source.replace('"version": 2', '"version": 1'));
    assert.throws(() => loadJetForgeProject(root), /version 2/);
    console.log("builtin project and CLI tests ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
