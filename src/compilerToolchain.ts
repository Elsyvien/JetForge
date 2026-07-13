export type CompilerValidationOutcome = "completed" | "skipped" | "cancelled";

export interface CompilerValidationResult {
  outcome: CompilerValidationOutcome;
  failed: boolean;
  mappedDiagnostics: number;
  compilerProblems: number;
  reason?: string;
}

export interface WorkspaceValidationSummary {
  total: number;
  processed: number;
  completed: number;
  clean: number;
  failed: number;
  withDiagnostics: number;
  unmappedProblems: number;
  mappedDiagnostics: number;
  skipped: number;
  cancelled: number;
  remaining: number;
}

export interface CompilerCommandGuidance {
  hasFilePlaceholder: boolean;
  hasWorkspaceFolderPlaceholder: boolean;
  hasOutputFilePlaceholder: boolean;
  warnings: string[];
}

export interface CompilerToolchainReport {
  status: "success" | "failed" | "cancelled";
  workspaceFolder: string;
  template: string;
  durationMs: number;
  outputProduced: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  error?: string;
}

export function compilerCommandGuidance(command: string): CompilerCommandGuidance {
  const hasFilePlaceholder = command.includes("${file}");
  const hasWorkspaceFolderPlaceholder = command.includes("${workspaceFolder}");
  const hasOutputFilePlaceholder = command.includes("${outputFile}");
  const warnings: string[] = [];
  if (!hasFilePlaceholder) {
    warnings.push("The command does not use ${file}; make sure the compiler can discover the input template from its working directory.");
  }
  if (!hasOutputFilePlaceholder) {
    warnings.push("The command does not use ${outputFile}; JetForge cannot verify or open the generated artifact automatically.");
  }
  return {
    hasFilePlaceholder,
    hasWorkspaceFolderPlaceholder,
    hasOutputFilePlaceholder,
    warnings
  };
}

export function summarizeWorkspaceValidation(
  total: number,
  results: CompilerValidationResult[]
): WorkspaceValidationSummary {
  const completedResults = results.filter((result) => result.outcome === "completed");
  const mappedDiagnostics = completedResults.reduce((sum, result) => sum + result.mappedDiagnostics, 0);
  return {
    total,
    processed: results.length,
    completed: completedResults.length,
    clean: completedResults.filter((result) =>
      !result.failed && result.compilerProblems === 0 && result.mappedDiagnostics === 0
    ).length,
    failed: completedResults.filter((result) => result.failed).length,
    withDiagnostics: completedResults.filter((result) => result.mappedDiagnostics > 0).length,
    unmappedProblems: completedResults.reduce(
      (sum, result) => sum + Math.max(0, result.compilerProblems - result.mappedDiagnostics),
      0
    ),
    mappedDiagnostics,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    cancelled: results.filter((result) => result.outcome === "cancelled").length,
    remaining: Math.max(0, total - results.length)
  };
}

export function formatWorkspaceValidationReport(summary: WorkspaceValidationSummary): string {
  return [
    "TxtJet workspace compiler validation",
    `status: ${workspaceValidationStatus(summary)}`,
    `templates.total: ${summary.total}`,
    `templates.processed: ${summary.processed}`,
    `templates.completed: ${summary.completed}`,
    `templates.clean: ${summary.clean}`,
    `templates.failed: ${summary.failed}`,
    `templates.withMappedDiagnostics: ${summary.withDiagnostics}`,
    `diagnostics.mapped: ${summary.mappedDiagnostics}`,
    `diagnostics.unmapped: ${summary.unmappedProblems}`,
    `templates.skipped: ${summary.skipped}`,
    `templates.cancelled: ${summary.cancelled}`,
    `templates.remaining: ${summary.remaining}`
  ].join("\n");
}

export function formatCompilerToolchainReport(report: CompilerToolchainReport): string {
  return [
    "TxtJet compiler toolchain test",
    `status: ${report.status}`,
    `workspaceFolder: ${report.workspaceFolder}`,
    `template: ${report.template}`,
    `durationMs: ${Math.max(0, Math.round(report.durationMs))}`,
    `outputProduced: ${report.outputProduced}`,
    `stdoutBytes: ${Math.max(0, report.stdoutBytes)}`,
    `stderrBytes: ${Math.max(0, report.stderrBytes)}`,
    ...(report.error ? [`error: ${singleLine(report.error)}`] : [])
  ].join("\n");
}

function workspaceValidationStatus(summary: WorkspaceValidationSummary): string {
  if (summary.cancelled > 0 || summary.remaining > 0) {
    return "cancelled";
  }
  if (summary.completed === 0) {
    return "not-run";
  }
  if (summary.failed > 0 || summary.withDiagnostics > 0 || summary.unmappedProblems > 0) {
    return "issues";
  }
  return "success";
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
