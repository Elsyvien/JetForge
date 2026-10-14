#!/usr/bin/env node

import { resolve } from "node:path";
import { builtinResultsText, isBuiltinProject, runBuiltinTargets } from "./builtinProject";
import { detectJavaToolchain } from "./javaToolchain";
import {
  generateJetForgeProject,
  inspectJetForgeProject,
  loadJetForgeProject,
  runJetForgeGoldenTests,
  validateJetForgeProject
} from "./headlessProject";
import {
  doctorText,
  generationText,
  goldenJunit,
  goldenText,
  validationSarif,
  compilerValidationSarif,
  validationText
} from "./headlessReports";

type CliFormat = "text" | "json" | "sarif" | "junit";

interface CliOptions {
  command?: "doctor" | "validate" | "generate" | "test" | "compile" | "evaluate";
  root: string;
  config: string;
  format: CliFormat;
  update: boolean;
  help: boolean;
  target?: string;
  compiler: boolean;
}

void main(process.argv.slice(2));

async function main(args: string[]): Promise<void> {
  try {
    const options = parseArguments(args);
    if (options.help || !options.command) {
      process.stdout.write(`${usage()}\n`);
      process.exitCode = options.help ? 0 : 2;
      return;
    }
    const project = loadJetForgeProject(options.root, options.config);
    switch (options.command) {
      case "doctor": {
        assertFormat(options.format, ["text", "json"], "doctor");
        const report = inspectJetForgeProject(project);
        if (isBuiltinProject(project)) {
          try {
            const jdk = await detectJavaToolchain();
            const release = project.config.compiler?.release ?? 21;
            if (release > jdk.version) {
              throw new Error(`Project Java release ${release} requires JDK ${release} or newer; selected ${jdk.description}.`);
            }
            report.checks.push({ id: "jdk", status: "pass", title: "Built-in compiler JDK", detail: `${jdk.description}; project release ${release}` }); report.passed++;
          }
          catch (error) { report.checks.push({ id: "jdk", status: "fail", title: "Built-in compiler JDK unavailable", detail: error instanceof Error ? error.message : String(error) }); report.failed++; report.ok = false; }
        }
        write(options.format === "json" ? report : doctorText(report));
        process.exitCode = report.ok ? 0 : 1;
        return;
      }
      case "validate": {
        assertFormat(options.format, ["text", "json", "sarif"], "validate");
        const result = validateJetForgeProject(project);
        if (options.compiler) {
          const compilerResults = await runBuiltinTargets(project, "compile", options.target);
          const ok = result.ok && compilerResults.every(entry => entry.ok);
          write(options.format === "json" ? { ...result, ok, compilerResults } : options.format === "sarif"
            ? compilerValidationSarif(result, compilerResults) : `${validationText(result)}\n${builtinResultsText(compilerResults)}`);
          process.exitCode = ok ? 0 : 1; return;
        }
        write(options.format === "json" ? result : options.format === "sarif" ? validationSarif(result) : validationText(result));
        process.exitCode = result.ok ? 0 : 1;
        return;
      }
      case "generate": {
        assertFormat(options.format, ["text", "json"], "generate");
        if (isBuiltinProject(project)) {
          const results = await runBuiltinTargets(project, "generate", options.target);
          write(options.format === "json" ? { root: project.root, results } : builtinResultsText(results));
          process.exitCode = results.every(entry => entry.ok) ? 0 : 1;
          return;
        }
        const results = generateJetForgeProject(project);
        write(options.format === "json" ? { root: project.root, results } : generationText(project.root, results));
        process.exitCode = 0;
        return;
      }
      case "compile":
      case "evaluate": {
        assertFormat(options.format, ["text", "json"], options.command);
        const results = await runBuiltinTargets(project, options.command, options.target);
        write(options.format === "json" ? { root: project.root, results } : builtinResultsText(results));
        process.exitCode = results.every(entry => entry.ok) ? 0 : 1;
        return;
      }
      case "test": {
        assertFormat(options.format, ["text", "json", "junit"], "test");
        const run = await runJetForgeGoldenTests(project, options.update);
        write(options.format === "json" ? run : options.format === "junit" ? goldenJunit(run) : goldenText(run));
        process.exitCode = run.ok ? 0 : 1;
        return;
      }
    }
  } catch (error) {
    process.stderr.write(`JetForge: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    config: ".jetforge.json",
    format: "text",
    update: false,
    help: false,
    compiler: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--update") {
      options.update = true;
      continue;
    }
    if (value === "--compiler") { options.compiler = true; continue; }
    if (value === "--root" || value === "--config" || value === "--format" || value === "--target") {
      const next = args[index + 1];
      if (!next) {
        throw new Error(`${value} requires a value.`);
      }
      index += 1;
      if (value === "--target") { options.target = next; }
      else if (value === "--root") {
        options.root = resolve(next);
      } else if (value === "--config") {
        options.config = next;
      } else if (isFormat(next)) {
        options.format = next;
      } else {
        throw new Error(`Unsupported output format: ${next}.`);
      }
      continue;
    }
    if (!value.startsWith("-") && !options.command && isCommand(value)) {
      options.command = value;
      continue;
    }
    throw new Error(`Unknown argument: ${value}.`);
  }
  if (options.update && options.command !== "test") {
    throw new Error("--update is only valid with jetforge test.");
  }
  if (options.compiler && options.command !== "validate") { throw new Error("--compiler is only valid with validate."); }
  if (options.target && !["compile", "evaluate", "generate", "validate"].includes(options.command ?? "")) { throw new Error("--target is valid with compile, evaluate, generate and validate --compiler."); }
  if (options.target && options.command === "validate" && !options.compiler) { throw new Error("validate --target requires --compiler."); }
  return options;
}

function write(value: object | string): void {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function assertFormat(format: CliFormat, supported: CliFormat[], command: string): void {
  if (!supported.includes(format)) {
    throw new Error(`${command} does not support --format ${format}. Choose ${supported.join(", ")}.`);
  }
}

function isCommand(value: string): value is NonNullable<CliOptions["command"]> {
  return value === "doctor" || value === "validate" || value === "generate" || value === "test" || value === "compile" || value === "evaluate";
}

function isFormat(value: string): value is CliFormat {
  return value === "text" || value === "json" || value === "sarif" || value === "junit";
}

function usage(): string {
  return [
    "JetForge headless template tooling",
    "",
    "Usage:",
    "  jetforge doctor   [--root DIR] [--config FILE] [--format text|json]",
    "  jetforge validate [--root DIR] [--config FILE] [--format text|json|sarif]",
    "  jetforge generate [--root DIR] [--config FILE] [--format text|json]",
    "  jetforge test     [--root DIR] [--config FILE] [--update] [--format text|json|junit]",
    "  jetforge compile  [--target NAME] [--root DIR] [--config FILE] [--format text|json]",
    "  jetforge evaluate [--target NAME] [--root DIR] [--config FILE] [--format text|json]",
    "  Version 2: generate supports --target; validate --compiler checks generated Java.",
    "",
    "Command-mode golden cases can use ${file}, ${workspaceFolder}, ${outputFile}, and ${fixture}."
  ].join("\n");
}
