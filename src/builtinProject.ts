import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BuiltinCompileRequest,
  publishBuiltinOutput,
  runBuiltinCompiler,
} from "./builtinCompiler";
import { BuiltinCompilerResult, BUILTIN_DIALECT } from "./compilerProtocol";
import { isPathInsideAnyRoot, isTxtJetPath } from "./extensionSupport";
import type { JetForgeProject, JetForgeProjectConfig } from "./headlessProject";

export interface BuiltinTarget {
  name: string;
  template: string;
  fixture?: string;
  output: string;
  modelProvider?: string;
}
export interface BuiltinTargetResult extends BuiltinCompilerResult {
  target: string;
  template: string;
  outputFile: string;
}
export type BuiltinRunOptions = Pick<
  BuiltinCompileRequest,
  "signal" | "readFile" | "isCurrent" | "javaHome" | "runtimeRoot"
>;

export function isBuiltinProject(project: JetForgeProject): boolean {
  return (
    project.config.version === 2 &&
    project.config.compiler?.backend === "builtin"
  );
}

/** v2 is deliberately strict; normalize target-backed tests for the existing golden runner. */
export function validateBuiltinConfig(
  config: JetForgeProjectConfig,
  root: string,
): void {
  if (
    config.compiler?.backend !== "builtin" ||
    config.compiler.dialect !== BUILTIN_DIALECT
  ) {
    throw new Error(
      'Version 2 requires compiler.backend="builtin" and compiler.dialect="jetforge-v1".',
    );
  }
  const path = (value: unknown, label: string): string => {
    if (
      typeof value !== "string" ||
      !value ||
      /[\0\r\n]/.test(value) ||
      !isPathInsideAnyRoot(resolve(root, value), [root])
    ) {
      throw new Error(`${label} must be a project-contained path.`);
    }
    return value;
  };
  for (const key of [
    "sourcePaths",
    "excludePaths",
    "includePaths",
    "skeletonPaths",
  ] as const) {
    const values = config[key];
    if (values !== undefined && !Array.isArray(values)) {
      throw new Error(`${key} must be an array.`);
    }
    if (values && values.length > 64) {
      throw new Error(`${key} is limited to 64 roots.`);
    }
    for (const value of values ?? []) {
      path(value, key);
    }
  }
  for (const key of ["classpath", "sourceRoots"] as const) {
    const values = config.compiler[key];
    if (values !== undefined && !Array.isArray(values)) {
      throw new Error(`compiler.${key} must be an array.`);
    }
    if (values && values.length > 64) {
      throw new Error(`compiler.${key} is limited to 64 roots.`);
    }
    for (const value of values ?? []) {
      path(value, `compiler.${key}`);
    }
  }
  if (config.compiler.command !== undefined) {
    throw new Error(
      "A builtin compiler cannot also configure compiler.command.",
    );
  }
  if (
    config.compiler.release !== undefined &&
    (!Number.isInteger(config.compiler.release) || config.compiler.release < 21)
  ) {
    throw new Error("compiler.release must be an integer of at least 21.");
  }
  if (
    config.compiler.timeoutMs !== undefined &&
    (!Number.isFinite(config.compiler.timeoutMs) ||
      config.compiler.timeoutMs < 1000 ||
      config.compiler.timeoutMs > 600000)
  ) {
    throw new Error("compiler.timeoutMs must be between 1000 and 600000.");
  }
  if (
    !Array.isArray(config.targets) ||
    config.targets.length === 0 ||
    config.targets.length > 256
  ) {
    throw new Error("Version 2 requires 1 to 256 named targets.");
  }
  const names = new Set<string>();
  const outputs = new Set<string>();
  const outputPaths: string[] = [];
  for (const target of config.targets) {
    if (
      !target ||
      typeof target !== "object" ||
      typeof target.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(target.name) ||
      names.has(target.name)
    ) {
      throw new Error(
        "Target names must be unique and contain letters, numbers, dots, hyphens or underscores.",
      );
    }
    names.add(target.name);
    path(target.template, "target.template");
    if (
      !isTxtJetPath(target.template) ||
      target.template.toLowerCase().endsWith(".jetinc")
    ) {
      throw new Error("target.template must be a root TxtJet template.");
    }
    if (target.fixture !== undefined) {
      path(target.fixture, "target.fixture");
    }
    path(target.output, "target.output");
    const output = resolve(root, target.output).toLowerCase();
    if (outputs.has(output)) {
      throw new Error("Builtin targets must have distinct output paths.");
    }
    const actualOutput = resolve(root, target.output);
    if (
      outputPaths.some(
        (previous) =>
          isPathInsideAnyRoot(actualOutput, [previous]) ||
          isPathInsideAnyRoot(previous, [actualOutput]),
      )
    ) {
      throw new Error(
        "Builtin output paths must not alias or contain another output path.",
      );
    }
    outputPaths.push(actualOutput);
    outputs.add(output);
    if (
      resolve(root, target.output) === resolve(root, target.template) ||
      (target.fixture &&
        resolve(root, target.output) === resolve(root, target.fixture))
    ) {
      throw new Error(
        "A target output cannot overwrite its template or fixture.",
      );
    }
    for (const provider of [
      config.compiler.modelProvider,
      target.modelProvider,
    ]) {
      if (
        provider !== undefined &&
        (typeof provider !== "string" ||
          !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(provider))
      ) {
        throw new Error("modelProvider must be a qualified Java class name.");
      }
    }
  }
  const testNames = new Set<string>();
  for (const test of config.tests ?? []) {
    if (
      !test ||
      typeof test.name !== "string" ||
      !test.name ||
      testNames.has(test.name)
    ) {
      throw new Error("Golden case names must be unique and nonempty.");
    }
    testNames.add(test.name);
    path(test.expected, "test.expected");
    if (
      test.mode !== undefined &&
      !["preview", "command", "builtin"].includes(test.mode)
    ) {
      throw new Error("Unknown golden case mode.");
    }
    if (test.target) {
      const target = config.targets.find((entry) => entry.name === test.target);
      if (!target) {
        throw new Error(`Unknown golden target: ${test.target}.`);
      }
      if (test.mode !== undefined && test.mode !== "builtin") {
        throw new Error("Target-backed tests use builtin mode.");
      }
      test.mode = "builtin";
      test.template = target.template;
      test.fixture = target.fixture;
    } else {
      path(test.template, "test.template");
      if (test.mode === "builtin") {
        throw new Error("Builtin golden cases require a named target.");
      }
    }
  }
  const inputs = [
    resolve(root, ".jetforge.json"),
    ...config.targets
      .flatMap((target) => [
        target.template,
        ...(target.fixture ? [target.fixture] : []),
      ])
      .map((input) => resolve(root, input)),
  ];
  for (const target of config.targets) {
    const output = resolve(root, target.output);
    const reserved = [
      ...inputs,
      ...(config.tests ?? []).map((test) => resolve(root, test.expected)),
    ];
    if (reserved.some((input) => isPathInsideAnyRoot(output, [input]))) {
      throw new Error(
        "Target outputs cannot overwrite inputs or golden baselines.",
      );
    }
  }
  for (const test of config.tests ?? []) {
    if (
      inputs.some((input) =>
        isPathInsideAnyRoot(resolve(root, test.expected), [input]),
      )
    ) {
      throw new Error("Golden baselines cannot overwrite compiler inputs.");
    }
  }
}

export async function runBuiltinTarget(
  project: JetForgeProject,
  name: string,
  mode: "compile" | "evaluate",
  options: BuiltinRunOptions = {},
): Promise<BuiltinTargetResult> {
  if (!isBuiltinProject(project)) {
    throw new Error(
      "Select a version 2 project with the builtin compiler backend.",
    );
  }
  const target = project.config.targets!.find((entry) => entry.name === name);
  if (!target) {
    throw new Error(`Unknown builtin target: ${name}.`);
  }
  const compiler = project.config.compiler!;
  const configCurrent = (): boolean => {
    try {
      return (
        project.configText === undefined ||
        (options.readFile?.(project.configPath) ??
          project.readFile?.(project.configPath) ??
          readFileSync(project.configPath, "utf8")) === project.configText
      );
    } catch {
      return false;
    }
  };
  const result = await runBuiltinCompiler({
    root: project.root,
    template: target.template,
    fixture: target.fixture,
    modelProvider: target.modelProvider ?? compiler.modelProvider,
    mode,
    release: compiler.release,
    classpath: compiler.classpath,
    sourceRoots: compiler.sourceRoots,
    timeoutMs: compiler.timeoutMs,
    includePaths: project.config.includePaths,
    skeletonPaths: project.config.skeletonPaths,
    extraInputs: existsSync(project.configPath) ? [project.configPath] : [],
    readFile: project.readFile,
    ...options,
    isCurrent: () => configCurrent() && options.isCurrent?.() !== false,
  });
  return {
    ...result,
    target: name,
    template: resolve(project.root, target.template),
    outputFile: resolve(project.root, target.output),
  };
}

export async function runBuiltinTargets(
  project: JetForgeProject,
  mode: "compile" | "evaluate" | "generate",
  name?: string,
  options: BuiltinRunOptions = {},
): Promise<BuiltinTargetResult[]> {
  if (!isBuiltinProject(project)) {
    throw new Error("Builtin execution requires a version 2 project.");
  }
  const names = name
    ? [name]
    : (project.config.targets ?? []).map((target) => target.name);
  const results: BuiltinTargetResult[] = [];
  for (const target of names) {
    const result = await runBuiltinTarget(
      project,
      target,
      mode === "compile" ? "compile" : "evaluate",
      options,
    );
    if (mode === "generate" && result.ok) {
      try {
        publishBuiltinOutput(project.root, result.outputFile, result);
      } catch (error) {
        result.ok = false;
        result.diagnostics.push({
          code: "OUTPUT_ERROR",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    results.push(result);
    if (options.signal?.aborted) {
      break;
    }
  }
  return results;
}

export function builtinResultsText(results: BuiltinTargetResult[]): string {
  return results
    .map((result) =>
      [
        `[${result.ok ? "PASS" : "FAIL"}] ${result.target}: ${result.mode} (${result.durationMs} ms)`,
        ...result.diagnostics.map(
          (problem) =>
            `${problem.fileName ?? "generator"}:${problem.line ?? problem.javaLine ?? 1}:${problem.column ?? 1} [${problem.code}] ${problem.message}`,
        ),
        ...(result.stdout ? [`stdout:\n${result.stdout}`] : []),
        ...(result.stderr ? [`stderr:\n${result.stderr}`] : []),
        ...(result.output !== undefined ? [result.output] : []),
      ].join("\n"),
    )
    .join("\n\n");
}
