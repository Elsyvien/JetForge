#!/usr/bin/env node

import { resolve } from "node:path";
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
  validationText
} from "./headlessReports";

type CliFormat = "text" | "json" | "sarif" | "junit";

interface CliOptions {
  command?: "doctor" | "validate" | "generate" | "test";
  root: string;
  config: string;
  format: CliFormat;
  update: boolean;
  help: boolean;
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
        write(options.format === "json" ? report : doctorText(report));
        process.exitCode = report.ok ? 0 : 1;
        return;
      }
      case "validate": {
        assertFormat(options.format, ["text", "json", "sarif"], "validate");
        const result = validateJetForgeProject(project);
        write(options.format === "json" ? result : options.format === "sarif" ? validationSarif(result) : validationText(result));
        process.exitCode = result.ok ? 0 : 1;
        return;
      }
      case "generate": {
        assertFormat(options.format, ["text", "json"], "generate");
        const results = generateJetForgeProject(project);
        write(options.format === "json" ? { root: project.root, results } : generationText(project.root, results));
        process.exitCode = 0;
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
    help: false
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
    if (value === "--root" || value === "--config" || value === "--format") {
      const next = args[index + 1];
      if (!next) {
        throw new Error(`${value} requires a value.`);
      }
      index += 1;
      if (value === "--root") {
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
  return value === "doctor" || value === "validate" || value === "generate" || value === "test";
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
    "",
    "Command-mode golden cases can use ${file}, ${workspaceFolder}, ${outputFile}, and ${fixture}."
  ].join("\n");
}
