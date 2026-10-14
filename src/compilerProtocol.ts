import { TxtJetRange } from "./templateModel";

export const COMPILER_PROTOCOL_VERSION = 1;
export const BUILTIN_DIALECT = "jetforge-v1";
export const MINIMUM_JDK_VERSION = 21;
export const MAX_COMPILER_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_COMPILER_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_COMPILER_LOG_BYTES = 256 * 1024;

export type CompilerErrorCode =
  | "TEMPLATE_SYNTAX"
  | "UNSUPPORTED_SYNTAX"
  | "REFERENCE_ERROR"
  | "RESOURCE_LIMIT"
  | "JDK_UNAVAILABLE"
  | "JAVA_COMPILE"
  | "MODEL_LOAD"
  | "TEMPLATE_RUNTIME"
  | "TIMEOUT"
  | "CANCELLED"
  | "STALE"
  | "RUNNER_ERROR"
  | "OUTPUT_ERROR";

export interface CompilerDiagnostic {
  code: CompilerErrorCode;
  message: string;
  severity: "error" | "warning";
  fileName?: string;
  range?: TxtJetRange;
  line?: number;
  column?: number;
  javaLine?: number;
  javaOffset?: number;
}

export interface CompilerMapping {
  generated: TxtJetRange;
  source: TxtJetRange;
  fileName: string;
  /** Only copied Java is suitable for exact column mapping. */
  exact: boolean;
}

export interface CompilerUnit {
  java: string;
  qualifiedName: string;
  className: string;
  packageName: string;
  mappings: CompilerMapping[];
  diagnostics: CompilerDiagnostic[];
  dependencies: Map<string, string>;
}

export interface BuiltinCompilerResult {
  ok: boolean;
  mode: "compile" | "evaluate";
  diagnostics: CompilerDiagnostic[];
  output?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  fingerprint?: string;
  /** Local publication guard; functions are deliberately absent from JSON reports. */
  inputsCurrent?: () => boolean;
  canWriteOutput?: (destination: string) => boolean;
}
