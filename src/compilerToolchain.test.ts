import assert from "node:assert/strict";
import {
  compilerCommandGuidance,
  formatCompilerToolchainReport,
  formatWorkspaceValidationReport,
  summarizeWorkspaceValidation
} from "./compilerToolchain";

const configured = compilerCommandGuidance("jetc ${file} --root ${workspaceFolder} --output ${outputFile}");
assert.equal(configured.hasFilePlaceholder, true);
assert.equal(configured.hasWorkspaceFolderPlaceholder, true);
assert.equal(configured.hasOutputFilePlaceholder, true);
assert.deepEqual(configured.warnings, []);

const wrapper = compilerCommandGuidance("./compile-current-workspace");
assert.equal(wrapper.warnings.length, 2);
assert.match(wrapper.warnings[0], /\$\{file\}/);
assert.match(wrapper.warnings[1], /\$\{outputFile\}/);

const summary = summarizeWorkspaceValidation(5, [
  { outcome: "completed", failed: false, mappedDiagnostics: 0, compilerProblems: 0 },
  { outcome: "completed", failed: true, mappedDiagnostics: 2, compilerProblems: 3 },
  { outcome: "skipped", failed: false, mappedDiagnostics: 0, compilerProblems: 0, reason: "unconfigured" },
  { outcome: "cancelled", failed: false, mappedDiagnostics: 0, compilerProblems: 0 }
]);
assert.deepEqual(summary, {
  total: 5,
  processed: 4,
  completed: 2,
  clean: 1,
  failed: 1,
  withDiagnostics: 1,
  unmappedProblems: 1,
  mappedDiagnostics: 2,
  skipped: 1,
  cancelled: 1,
  remaining: 1
});
assert.match(formatWorkspaceValidationReport(summary), /status: cancelled/);
assert.match(formatWorkspaceValidationReport(summary), /diagnostics\.unmapped: 1/);

const report = formatCompilerToolchainReport({
  status: "failed",
  workspaceFolder: "/workspace",
  template: "/workspace/demo.txtjet",
  durationMs: 12.6,
  outputProduced: false,
  stdoutBytes: 0,
  stderrBytes: 40,
  error: "compiler failed\nwith details"
});
assert.match(report, /durationMs: 13/);
assert.match(report, /error: compiler failed with details/);

console.log("compiler toolchain tests ok");
