import { relative } from "node:path";
import {
  JetForgeDoctorReport,
  JetForgeGenerationResult,
  JetForgeGoldenRun,
  JetForgeValidationResult
} from "./headlessProject";

export function validationText(result: JetForgeValidationResult): string {
  if (result.ok) {
    return `JetForge validation passed: ${result.templates} template${result.templates === 1 ? "" : "s"}, 0 issues.`;
  }
  return [
    `JetForge validation failed: ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}.`,
    ...result.issues.map((issue) =>
      `${relative(result.root, issue.fileName)}:${issue.line}:${issue.column} [${issue.code}] ${issue.message}`
    )
  ].join("\n");
}

export function doctorText(report: JetForgeDoctorReport): string {
  return [
    `JetForge Workspace Doctor: ${report.failed} failed, ${report.warnings} warnings, ${report.passed} passed.`,
    ...report.checks.map((check) => {
      const marker = check.status === "pass" ? "PASS" : check.status === "warning" ? "WARN" : "FAIL";
      return `[${marker}] ${check.title}: ${check.detail}${check.fix ? ` Fix: ${check.fix}` : ""}`;
    })
  ].join("\n");
}

export function generationText(root: string, results: JetForgeGenerationResult[]): string {
  return [
    `JetForge generated ${results.length} output file${results.length === 1 ? "" : "s"}.`,
    ...results.map((entry) => `${relative(root, entry.source)} -> ${relative(root, entry.output)} (${entry.bytes} bytes)`)
  ].join("\n");
}

export function goldenText(run: JetForgeGoldenRun): string {
  return [
    `JetForge golden tests: ${run.passed} passed, ${run.failed} failed, ${run.errors} errors, ${run.updated} updated.`,
    ...run.results.flatMap((result) => {
      const lines = [`[${result.status.toUpperCase()}] ${result.name} (${result.durationMs} ms)`];
      if (result.firstDifference) {
        lines.push(`  ${result.firstDifference}`);
      }
      if (result.error) {
        lines.push(`  ${result.error}`);
      }
      return lines;
    })
  ].join("\n");
}

export function validationSarif(result: JetForgeValidationResult): object {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "JetForge",
          informationUri: "https://elsyvien.github.io/JetForge/",
          rules: Array.from(new Set(result.issues.map((issue) => issue.code))).sort().map((code) => ({
            id: code,
            shortDescription: { text: `TxtJet ${code}` }
          }))
        }
      },
      results: result.issues.map((issue) => ({
        ruleId: issue.code,
        level: "error",
        message: { text: issue.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: relative(result.root, issue.fileName).replace(/\\/g, "/") },
            region: { startLine: issue.line, startColumn: issue.column }
          }
        }]
      }))
    }]
  };
}

export function goldenJunit(run: JetForgeGoldenRun): string {
  const failures = run.failed + run.errors;
  const time = run.results.reduce((sum, result) => sum + result.durationMs, 0) / 1000;
  const cases = run.results.map((result) => {
    const failure = result.status === "failed" || result.status === "error"
      ? `<failure message="${xmlAttribute(result.error ?? result.firstDifference ?? result.status)}">${xmlText(result.error ?? result.firstDifference ?? result.status)}</failure>`
      : "";
    return `  <testcase classname="JetForge.Golden" name="${xmlAttribute(result.name)}" time="${(result.durationMs / 1000).toFixed(3)}">${failure}</testcase>`;
  });
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<testsuite name="JetForge Golden Output" tests="${run.results.length}" failures="${failures}" time="${time.toFixed(3)}">`,
    ...cases,
    "</testsuite>",
    ""
  ].join("\n");
}

function xmlAttribute(value: string): string {
  return xmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
