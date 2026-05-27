import { basename, isAbsolute, normalize, resolve } from "node:path";
import { mapPreviewRangeToSource, TxtJetGeneratedPreview, TxtJetRange } from "./templateModel";

export type TxtJetCompilerDiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface TxtJetCompilerProblem {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: TxtJetCompilerDiagnosticSeverity;
}

export interface TxtJetMappedCompilerProblem extends TxtJetCompilerProblem {
  sourceRange: TxtJetRange;
  mappedFrom: "source" | "generated-java";
}

export const DEFAULT_COMPILER_PROBLEM_MATCHER =
  "^(?<file>.*?):(?<line>\\d+):(?<column>\\d+):(?:\\s*(?<severity>error|warning|info|information|hint):)?\\s*(?<message>.+)$";

export function parseCompilerProblems(output: string, matcher: string = DEFAULT_COMPILER_PROBLEM_MATCHER): TxtJetCompilerProblem[] {
  const pattern = compileMatcher(matcher);
  if (!pattern) {
    return [];
  }

  return output.split(/\r?\n/).flatMap((line) => {
    const match = pattern.exec(line);
    if (!match) {
      return [];
    }

    const groups = match.groups ?? {};
    const file = groups.file ?? match[1];
    const lineNumber = Number(groups.line ?? match[2]);
    const columnNumber = Number(groups.column ?? match[3]);
    const severityText = groups.severity ?? match[4];
    const message = groups.message ?? match[5] ?? match[4];
    if (!file || !Number.isFinite(lineNumber) || !Number.isFinite(columnNumber) || !message) {
      return [];
    }

    return [{
      file,
      line: Math.max(1, lineNumber),
      column: Math.max(1, columnNumber),
      message: message.trim(),
      severity: compilerSeverity(severityText)
    }];
  });
}

export function mapCompilerProblemsToSource(
  problems: TxtJetCompilerProblem[],
  sourceFileName: string,
  sourceText: string,
  generatedJavaPreview: TxtJetGeneratedPreview,
  generatedFileName: string,
  workspaceFolder: string
): TxtJetMappedCompilerProblem[] {
  return problems.flatMap<TxtJetMappedCompilerProblem>((problem) => {
    const resolvedProblemFile = resolveProblemFile(problem.file, workspaceFolder);
    if (sameFile(resolvedProblemFile, sourceFileName)) {
      return [{
        ...problem,
        sourceRange: lineColumnRange(sourceText, problem.line, problem.column),
        mappedFrom: "source" as const
      }];
    }

    if (!sameFile(resolvedProblemFile, generatedFileName) && basename(resolvedProblemFile) !== basename(generatedFileName)) {
      return [];
    }

    const previewOffset = lineColumnOffset(generatedJavaPreview.text, problem.line, problem.column);
    const mappedRange = mapPreviewRangeToSource(generatedJavaPreview.mappings, {
      start: previewOffset,
      end: previewOffset
    });
    if (!mappedRange) {
      return [];
    }

    return [{
      ...problem,
      sourceRange: mappedRange,
      mappedFrom: "generated-java" as const
    }];
  });
}

function compileMatcher(matcher: string): RegExp | undefined {
  try {
    return new RegExp(matcher);
  } catch {
    return undefined;
  }
}

function compilerSeverity(value: string | undefined): TxtJetCompilerDiagnosticSeverity {
  switch (value?.toLowerCase()) {
    case "error":
      return "error";
    case "info":
    case "information":
      return "information";
    case "hint":
      return "hint";
    case "warning":
    default:
      return "warning";
  }
}

function resolveProblemFile(fileName: string, workspaceFolder: string): string {
  return normalize(isAbsolute(fileName) ? fileName : resolve(workspaceFolder, fileName));
}

function sameFile(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function lineColumnRange(text: string, line: number, column: number): TxtJetRange {
  const start = lineColumnOffset(text, line, column);
  const lineEnd = text.indexOf("\n", start);
  return {
    start,
    end: Math.max(start, lineEnd === -1 ? text.length : lineEnd)
  };
}

function lineColumnOffset(text: string, line: number, column: number): number {
  const targetLine = Math.max(1, line);
  const targetColumn = Math.max(1, column);
  let currentLine = 1;
  let lineStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (currentLine === targetLine) {
      return Math.min(lineStart + targetColumn - 1, lineEndOffset(text, lineStart));
    }
    if (text[index] === "\n") {
      currentLine += 1;
      lineStart = index + 1;
    }
  }

  return currentLine === targetLine
    ? Math.min(lineStart + targetColumn - 1, text.length)
    : text.length;
}

function lineEndOffset(text: string, lineStart: number): number {
  const end = text.indexOf("\n", lineStart);
  return end === -1 ? text.length : end;
}
