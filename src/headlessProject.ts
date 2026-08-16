import { exec } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { detectTargetLanguage, detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import { compilerCommandGuidance } from "./compilerToolchain";
import { isPathInsideAnyRoot, isTxtJetPath, shellArgumentQuote } from "./extensionSupport";
import { generatedOutputPath } from "./generationPaths";
import { scanTxtJetDirectiveIssues, scanTxtJetIssues, TxtJetIssue } from "./scanner";
import {
  buildGeneratedOutputPreview,
  targetOutputExtension
} from "./templateModel";
import {
  createTxtJetWorkspaceModel,
  isExcludedTxtJetWorkspacePath,
  TxtJetWorkspaceFile,
  TxtJetWorkspaceModel
} from "./workspaceModel";

const execAsync = promisify(exec);
const DEFAULT_CONFIG_NAME = ".jetforge.json";
const MAX_PROJECT_FILES = 10000;
const MAX_COMMAND_BUFFER = 4 * 1024 * 1024;

export type JetForgeGoldenMode = "preview" | "command";

export interface JetForgeCompilerConfig {
  command: string;
  timeoutMs?: number;
}

export interface JetForgeGoldenCase {
  name: string;
  template: string;
  expected: string;
  mode?: JetForgeGoldenMode;
  targetLanguage?: TxtJetTargetLanguage;
  command?: string;
  fixture?: string;
  timeoutMs?: number;
}

export interface JetForgeProjectConfig {
  version?: 1;
  sourcePaths?: string[];
  excludePaths?: string[];
  includePaths?: string[];
  skeletonPaths?: string[];
  outputDirectory?: string;
  compiler?: JetForgeCompilerConfig;
  tests?: JetForgeGoldenCase[];
}

export interface JetForgeProject {
  root: string;
  configPath: string;
  configExists: boolean;
  config: JetForgeProjectConfig;
  files: TxtJetWorkspaceFile[];
  model: TxtJetWorkspaceModel;
}

export interface JetForgeValidationIssue extends TxtJetIssue {
  fileName: string;
  line: number;
  column: number;
}

export interface JetForgeValidationResult {
  root: string;
  templates: number;
  issues: JetForgeValidationIssue[];
  ok: boolean;
}

export interface JetForgeDoctorCheck {
  id: string;
  status: "pass" | "warning" | "fail";
  title: string;
  detail: string;
  fix?: string;
}

export interface JetForgeDoctorReport {
  root: string;
  configPath: string;
  checks: JetForgeDoctorCheck[];
  passed: number;
  warnings: number;
  failed: number;
  ok: boolean;
}

export interface JetForgeGenerationResult {
  source: string;
  output: string;
  bytes: number;
}

export interface JetForgeGoldenResult {
  name: string;
  status: "passed" | "failed" | "updated" | "error";
  expectedPath: string;
  actualBytes: number;
  expectedBytes?: number;
  firstDifference?: string;
  durationMs: number;
  error?: string;
}

export interface JetForgeGoldenRun {
  root: string;
  results: JetForgeGoldenResult[];
  passed: number;
  failed: number;
  updated: number;
  errors: number;
  ok: boolean;
}

export interface JetForgeEvaluationResult {
  testCase: JetForgeGoldenCase;
  content: string;
  durationMs: number;
}

export function loadJetForgeProject(rootDirectory: string, configFile = DEFAULT_CONFIG_NAME): JetForgeProject {
  const root = normalize(resolve(rootDirectory));
  const configPath = resolveProjectPath(root, configFile, true);
  const configExists = existsSync(configPath);
  const config = configExists ? parseProjectConfig(configPath) : {};
  const includePaths = safeConfiguredRoots(root, config.includePaths);
  const skeletonPaths = safeConfiguredRoots(root, config.skeletonPaths);
  const files = discoverProjectFiles(root, config.sourcePaths, config.excludePaths);
  const model = createTxtJetWorkspaceModel(files, {
    includePathsForFile: () => includePaths,
    skeletonPathsForFile: () => skeletonPaths
  });
  return { root, configPath, configExists, config, files, model };
}

export function validateJetForgeProject(project: JetForgeProject): JetForgeValidationResult {
  const issues: JetForgeValidationIssue[] = [];
  for (const entry of project.model.templates.concat(project.model.includes)) {
    if (entry.text === undefined) {
      continue;
    }
    const sourceIssues = [
      ...scanTxtJetIssues(entry.text),
      ...scanTxtJetDirectiveIssues(entry.text, {
        includeExists: (reference) => project.model.referenceExists(entry.fileName, reference, "include"),
        skeletonExists: (reference) => project.model.referenceExists(entry.fileName, reference, "skeleton")
      })
    ];
    const seen = new Set<string>();
    for (const issue of sourceIssues) {
      const key = `${issue.code}:${issue.start}:${issue.end}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const location = offsetLocation(entry.text, issue.start);
      issues.push({ ...issue, fileName: entry.fileName, ...location });
    }
  }
  issues.sort((left, right) => left.fileName.localeCompare(right.fileName) || left.start - right.start);
  return { root: project.root, templates: project.model.templates.length, issues, ok: issues.length === 0 };
}

export function inspectJetForgeProject(project: JetForgeProject): JetForgeDoctorReport {
  const checks: JetForgeDoctorCheck[] = [];
  checks.push(project.configExists ? {
    id: "config",
    status: "pass",
    title: "Project configuration found",
    detail: relative(project.root, project.configPath) || basename(project.configPath)
  } : {
    id: "config",
    status: "warning",
    title: "No .jetforge.json configuration",
    detail: "Editor-only defaults work, but tests and repeatable headless generation need a checked-in project contract.",
    fix: "Create .jetforge.json with version, outputDirectory, compiler, and tests entries."
  });

  checks.push(project.model.templates.length > 0 ? {
    id: "templates",
    status: "pass",
    title: `${project.model.templates.length} template${project.model.templates.length === 1 ? "" : "s"} indexed`,
    detail: `${project.model.includes.length} includes and ${project.model.skeletons.length} skeletons are available to the workspace model.`
  } : {
    id: "templates",
    status: "fail",
    title: "No TxtJet templates found",
    detail: "JetForge did not find a recognized template suffix below the workspace root.",
    fix: "Add a .txtjet, .jet, or target-specific template file."
  });

  checks.push(project.model.unresolvedReferences.length === 0 ? {
    id: "references",
    status: "pass",
    title: "All include and skeleton references resolve",
    detail: "The workspace dependency model contains no unresolved edges."
  } : {
    id: "references",
    status: "fail",
    title: `${project.model.unresolvedReferences.length} unresolved reference${project.model.unresolvedReferences.length === 1 ? "" : "s"}`,
    detail: project.model.unresolvedReferences.slice(0, 5).map((entry) =>
      `${relative(project.root, entry.sourceFileName)} -> ${entry.referenceFile}`
    ).join(", "),
    fix: "Create the missing files or add workspace-contained includePaths/skeletonPaths."
  });

  const compiler = project.config.compiler?.command?.trim();
  if (!compiler) {
    checks.push({
      id: "compiler",
      status: "warning",
      title: "No headless compiler configured",
      detail: "Preview-mode generation works, but real evaluation and compiler-mode golden tests are unavailable.",
      fix: "Set compiler.command in .jetforge.json and include ${file} and ${outputFile}."
    });
  } else {
    const guidance = compilerCommandGuidance(compiler);
    checks.push({
      id: "compiler",
      status: guidance.hasFilePlaceholder && guidance.hasOutputFilePlaceholder ? "pass" : "warning",
      title: "Compiler command configured",
      detail: guidance.warnings.length === 0 ? "The command exposes deterministic input and output placeholders." : guidance.warnings.join(" "),
      fix: guidance.warnings.length === 0 ? undefined : "Add ${file} and ${outputFile} placeholders."
    });
  }

  const output = configuredOutputRoot(project);
  checks.push(output ? {
    id: "output",
    status: "pass",
    title: "Generated output remains workspace-contained",
    detail: relative(project.root, output) || "."
  } : {
    id: "output",
    status: "fail",
    title: "Generated output path escapes the workspace",
    detail: String(project.config.outputDirectory),
    fix: "Use a relative outputDirectory inside the workspace."
  });

  const tests = project.config.tests ?? [];
  const duplicateNames = duplicateValues(tests.map((entry) => entry.name));
  const invalidTests = tests.filter((entry) => !goldenCasePathsAreSafe(project.root, entry));
  if (tests.length === 0) {
    checks.push({
      id: "golden-tests",
      status: "warning",
      title: "No golden output cases configured",
      detail: "Generated output changes are not yet protected by project-owned baselines.",
      fix: "Add tests entries to .jetforge.json, then run jetforge test --update."
    });
  } else if (duplicateNames.length > 0 || invalidTests.length > 0) {
    checks.push({
      id: "golden-tests",
      status: "fail",
      title: "Golden test configuration is unsafe or ambiguous",
      detail: `Duplicate names: ${duplicateNames.join(", ") || "none"}; invalid paths: ${invalidTests.map((entry) => entry.name).join(", ") || "none"}.`,
      fix: "Use unique names and workspace-contained template, fixture, and expected paths."
    });
  } else {
    checks.push({
      id: "golden-tests",
      status: "pass",
      title: `${tests.length} golden output case${tests.length === 1 ? "" : "s"} configured`,
      detail: `${tests.filter((entry) => (entry.mode ?? "preview") === "command").length} case(s) execute a real fixture-aware command.`
    });
  }

  const validation = validateJetForgeProject(project);
  checks.push(validation.ok ? {
    id: "validation",
    status: "pass",
    title: "Local template validation is clean",
    detail: `${validation.templates} template${validation.templates === 1 ? "" : "s"} scanned.`
  } : {
    id: "validation",
    status: "fail",
    title: `${validation.issues.length} local validation issue${validation.issues.length === 1 ? "" : "s"}`,
    detail: validation.issues.slice(0, 5).map((issue) =>
      `${relative(project.root, issue.fileName)}:${issue.line}:${issue.column} ${issue.message}`
    ).join(" | "),
    fix: "Run jetforge validate for the complete machine-readable report."
  });

  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  return { root: project.root, configPath: project.configPath, checks, passed, warnings, failed, ok: failed === 0 };
}

export function generateJetForgeProject(project: JetForgeProject): JetForgeGenerationResult[] {
  const outputRoot = configuredOutputRoot(project);
  if (!outputRoot) {
    throw new Error("Configured outputDirectory must remain inside the workspace.");
  }
  const results: JetForgeGenerationResult[] = [];
  for (const entry of project.model.templates) {
    if (entry.text === undefined) {
      continue;
    }
    const target = detectedTarget(entry.fileName, entry.text);
    const output = generatedOutputPath(entry.fileName, project.root, outputRoot, targetOutputExtension(target));
    if (!output) {
      throw new Error(`Generated output escaped the configured directory for ${entry.fileName}.`);
    }
    const preview = buildGeneratedOutputPreview(entry.text, target, previewOptions(project, entry.fileName));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, preview.text, "utf8");
    results.push({ source: entry.fileName, output, bytes: Buffer.byteLength(preview.text) });
  }
  return results;
}

export async function runJetForgeGoldenTests(
  project: JetForgeProject,
  update = false,
  selectedNames?: ReadonlySet<string>
): Promise<JetForgeGoldenRun> {
  const results: JetForgeGoldenResult[] = [];
  for (const testCase of (project.config.tests ?? []).filter((entry) => !selectedNames || selectedNames.has(entry.name))) {
    const started = Date.now();
    const expectedPath = safeProjectPath(project.root, testCase.expected);
    try {
      validateGoldenCase(project, testCase);
      const actual = await renderGoldenCase(project, testCase);
      if (update) {
        mkdirSync(dirname(expectedPath), { recursive: true });
        writeFileSync(expectedPath, actual, "utf8");
        results.push({
          name: testCase.name,
          status: "updated",
          expectedPath,
          actualBytes: Buffer.byteLength(actual),
          durationMs: Date.now() - started
        });
        continue;
      }
      if (!existsSync(expectedPath)) {
        results.push({
          name: testCase.name,
          status: "failed",
          expectedPath,
          actualBytes: Buffer.byteLength(actual),
          firstDifference: "Baseline does not exist. Run jetforge test --update to create it.",
          durationMs: Date.now() - started
        });
        continue;
      }
      const expected = readFileSync(expectedPath, "utf8");
      const matches = normalizedOutput(actual) === normalizedOutput(expected);
      results.push({
        name: testCase.name,
        status: matches ? "passed" : "failed",
        expectedPath,
        actualBytes: Buffer.byteLength(actual),
        expectedBytes: Buffer.byteLength(expected),
        firstDifference: matches ? undefined : firstDifference(expected, actual),
        durationMs: Date.now() - started
      });
    } catch (error) {
      results.push({
        name: testCase.name || "unnamed",
        status: "error",
        expectedPath,
        actualBytes: 0,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const passed = results.filter((entry) => entry.status === "passed").length;
  const failed = results.filter((entry) => entry.status === "failed").length;
  const updated = results.filter((entry) => entry.status === "updated").length;
  const errors = results.filter((entry) => entry.status === "error").length;
  return { root: project.root, results, passed, failed, updated, errors, ok: failed === 0 && errors === 0 };
}

export async function evaluateJetForgeCase(project: JetForgeProject, name: string): Promise<JetForgeEvaluationResult> {
  const testCase = (project.config.tests ?? []).find((entry) => entry.name === name);
  if (!testCase) {
    throw new Error(`Unknown JetForge test case: ${name}.`);
  }
  validateGoldenCase(project, testCase);
  const started = Date.now();
  const content = await renderGoldenCase(project, testCase);
  return { testCase, content, durationMs: Date.now() - started };
}

export function formatDoctorMarkdown(report: JetForgeDoctorReport): string {
  const lines = [
    "# JetForge Workspace Doctor",
    "",
    `Workspace: \`${report.root}\``,
    "",
    `**${report.failed} failed · ${report.warnings} warnings · ${report.passed} passed**`,
    ""
  ];
  for (const check of report.checks) {
    const marker = check.status === "pass" ? "✅" : check.status === "warning" ? "⚠️" : "❌";
    lines.push(`## ${marker} ${check.title}`, "", check.detail, "");
    if (check.fix) {
      lines.push(`**Suggested fix:** ${check.fix}`, "");
    }
  }
  return lines.join("\n");
}

export function formatGoldenMarkdown(run: JetForgeGoldenRun): string {
  const lines = [
    "# JetForge Golden Output Tests",
    "",
    `**${run.passed} passed · ${run.failed} failed · ${run.errors} errors · ${run.updated} updated**`,
    ""
  ];
  for (const result of run.results) {
    const marker = result.status === "passed" ? "✅" : result.status === "updated" ? "📝" : "❌";
    lines.push(`- ${marker} **${result.name}** — ${result.status} (${result.durationMs} ms)`);
    if (result.firstDifference) {
      lines.push(`  - ${result.firstDifference}`);
    }
    if (result.error) {
      lines.push(`  - ${result.error}`);
    }
  }
  return lines.join("\n");
}

function parseProjectConfig(configPath: string): JetForgeProjectConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  const config = parsed as JetForgeProjectConfig;
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`Unsupported JetForge project version: ${String(config.version)}.`);
  }
  if (config.tests !== undefined && !Array.isArray(config.tests)) {
    throw new Error("JetForge tests must be an array.");
  }
  return config;
}

function discoverProjectFiles(root: string, sourcePaths: string[] | undefined, excludePaths: string[] | undefined): TxtJetWorkspaceFile[] {
  const files: TxtJetWorkspaceFile[] = [];
  const sources = (sourcePaths?.length ? sourcePaths : ["."]).map((entry) => safeProjectPath(root, entry));
  const excluded = (excludePaths ?? []).map((entry) => safeProjectPath(root, entry));
  const visit = (directory: string): void => {
    if (excluded.some((entry) => directory === entry || isPathInsideAnyRoot(directory, [entry]))) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fileName = join(directory, entry.name);
      if (isExcludedTxtJetWorkspacePath(fileName)) {
        continue;
      }
      if (excluded.some((excludedPath) => fileName === excludedPath || isPathInsideAnyRoot(fileName, [excludedPath]))) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(fileName);
        continue;
      }
      if (!entry.isFile() || (!isTxtJetPath(fileName) && !fileName.toLowerCase().endsWith(".skeleton"))) {
        continue;
      }
      files.push({ fileName: normalize(fileName), text: readFileSync(fileName, "utf8") });
      if (files.length > MAX_PROJECT_FILES) {
        throw new Error(`JetForge stopped after ${MAX_PROJECT_FILES} workspace files.`);
      }
    }
  };
  for (const source of sources) {
    if (!existsSync(source)) {
      throw new Error(`Configured source path does not exist: ${relative(root, source)}`);
    }
    if (lstatSync(source).isDirectory()) {
      visit(source);
    } else if (isTxtJetPath(source) || source.toLowerCase().endsWith(".skeleton")) {
      files.push({ fileName: source, text: readFileSync(source, "utf8") });
    }
  }
  return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function safeConfiguredRoots(root: string, paths: string[] | undefined): string[] {
  return (paths ?? []).map((entry) => safeProjectPath(root, entry));
}

function configuredOutputRoot(project: JetForgeProject): string | undefined {
  try {
    return safeProjectPath(project.root, project.config.outputDirectory ?? "generated");
  } catch {
    return undefined;
  }
}

function previewOptions(project: JetForgeProject, sourceFileName: string) {
  return {
    sourceFileName,
    expandIncludes: true,
    includePaths: safeConfiguredRoots(project.root, project.config.includePaths),
    readInclude(fileName: string): string | undefined {
      const normalized = normalize(fileName);
      if (!isPathInsideAnyRoot(normalized, [project.root, ...safeConfiguredRoots(project.root, project.config.includePaths)])) {
        return undefined;
      }
      return existsSync(normalized) && lstatSync(normalized).isFile() ? readFileSync(normalized, "utf8") : undefined;
    }
  };
}

function detectedTarget(fileName: string, text: string): TxtJetTargetLanguage {
  const fileTarget = detectTargetLanguageFromFileName(fileName);
  return fileTarget === "txtjet" ? detectTargetLanguage(text) : fileTarget;
}

function validateGoldenCase(project: JetForgeProject, testCase: JetForgeGoldenCase): void {
  if (!testCase.name?.trim()) {
    throw new Error("Golden test name cannot be empty.");
  }
  if (!goldenCasePathsAreSafe(project.root, testCase)) {
    throw new Error("Golden test paths must remain inside the workspace.");
  }
  const template = safeProjectPath(project.root, testCase.template);
  if (!existsSync(template) || !lstatSync(template).isFile()) {
    throw new Error(`Template does not exist: ${testCase.template}`);
  }
  if ((testCase.mode ?? "preview") === "command" && !(testCase.command ?? project.config.compiler?.command)?.trim()) {
    throw new Error("Command-mode golden tests require a case command or compiler.command.");
  }
}

async function renderGoldenCase(project: JetForgeProject, testCase: JetForgeGoldenCase): Promise<string> {
  const templatePath = safeProjectPath(project.root, testCase.template);
  const templateText = readFileSync(templatePath, "utf8");
  if ((testCase.mode ?? "preview") === "preview") {
    const target = testCase.targetLanguage ?? detectedTarget(templatePath, templateText);
    return buildGeneratedOutputPreview(templateText, target, previewOptions(project, templatePath)).text;
  }

  const outputRoot = safeProjectPath(project.root, ".jetforge/run");
  mkdirSync(outputRoot, { recursive: true });
  const outputFile = join(outputRoot, `${safeFileStem(testCase.name)}.actual`);
  const fixturePath = testCase.fixture ? safeProjectPath(project.root, testCase.fixture) : "";
  const commandTemplate = testCase.command ?? project.config.compiler?.command ?? "";
  const command = substituteCommand(commandTemplate, {
    file: templatePath,
    workspaceFolder: project.root,
    outputFile,
    fixture: fixturePath
  });
  const timeout = boundedTimeout(testCase.timeoutMs ?? project.config.compiler?.timeoutMs);
  if (existsSync(outputFile)) {
    unlinkSync(outputFile);
  }
  try {
    await execAsync(command, {
      cwd: project.root,
      timeout,
      maxBuffer: MAX_COMMAND_BUFFER,
      windowsHide: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Evaluation command failed: ${message}`);
  }
  if (!existsSync(outputFile)) {
    throw new Error("Evaluation command completed without writing ${outputFile}.");
  }
  const rendered = readFileSync(outputFile, "utf8");
  unlinkSync(outputFile);
  return rendered;
}

function substituteCommand(command: string, values: Record<string, string>): string {
  let result = command;
  for (const [name, value] of Object.entries(values)) {
    result = result.split(`\${${name}}`).join(shellArgumentQuote(value));
  }
  return result;
}

function goldenCasePathsAreSafe(root: string, testCase: JetForgeGoldenCase): boolean {
  try {
    safeProjectPath(root, testCase.template);
    safeProjectPath(root, testCase.expected);
    if (testCase.fixture) {
      safeProjectPath(root, testCase.fixture);
    }
    return true;
  } catch {
    return false;
  }
}

function safeProjectPath(root: string, value: string): string {
  return resolveProjectPath(root, value, false);
}

function resolveProjectPath(root: string, value: string, allowAbsoluteConfig: boolean): string {
  if (!value || /[\0\r\n]/.test(value)) {
    throw new Error("Project paths cannot be empty or contain control characters.");
  }
  const candidate = normalize(isAbsolute(value) ? value : resolve(root, value));
  if (isAbsolute(value) && allowAbsoluteConfig && candidate === normalize(value)) {
    if (!isPathInsideAnyRoot(candidate, [root])) {
      throw new Error(`Path escapes the workspace: ${value}`);
    }
    return candidate;
  }
  if (!isPathInsideAnyRoot(candidate, [root])) {
    throw new Error(`Path escapes the workspace: ${value}`);
  }
  return candidate;
}

function offsetLocation(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function normalizedOutput(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function firstDifference(expected: string, actual: string): string {
  const expectedLines = normalizedOutput(expected).split("\n");
  const actualLines = normalizedOutput(actual).split("\n");
  const count = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < count; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `First difference at line ${index + 1}: expected ${JSON.stringify(expectedLines[index] ?? "<EOF>")}, received ${JSON.stringify(actualLines[index] ?? "<EOF>")}.`;
    }
  }
  return "Output differs.";
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return Array.from(duplicates).sort();
}

function safeFileStem(value: string): string {
  const stem = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "golden-case";
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 60000;
  }
  return Math.min(600000, Math.max(1000, Math.trunc(value!)));
}
