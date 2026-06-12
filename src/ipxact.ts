import { compilerProblemTargetsFile, TxtJetCompilerProblem } from "./compilerDiagnostics";
import { parseTxtJetTemplate, mapPreviewRangeToSource, TxtJetGeneratedPreview, TxtJetRange } from "./templateModel";

export interface TxtJetIpxactMatchOptions {
  enabled: boolean;
  templateGlobs?: string[];
}

export interface TxtJetMappedIpxactProblem extends TxtJetCompilerProblem {
  sourceRange: TxtJetRange;
  mappedFrom: "generated-output";
}

export const DEFAULT_IPXACT_PROBLEM_MATCHER =
  "^(?<file>.*?):(?<line>\\d+):(?<column>\\d+):(?:\\s*(?<severity>error|warning|info|information|hint):)?\\s*(?<message>.+)$";

export const IPXACT_NODE_COMPLETIONS = [
  "component",
  "busInterface",
  "memoryMap",
  "addressBlock",
  "register",
  "field"
];

export function isIpxactTemplate(
  fileName: string,
  text: string | undefined,
  options: TxtJetIpxactMatchOptions
): boolean {
  if (!options.enabled) {
    return false;
  }
  if (text && hasIpxactMetadata(text)) {
    return true;
  }
  return (options.templateGlobs ?? []).some((pattern) => globMatchesPath(pattern, fileName));
}

export function hasIpxactMetadata(text: string): boolean {
  const value = parseTxtJetTemplate(text).jetDirective?.attributes.ipxact;
  return value !== undefined && /^(true|1|yes)$/i.test(value.trim());
}

export function mapIpxactProblemsToSource(
  problems: TxtJetCompilerProblem[],
  generatedPreview: TxtJetGeneratedPreview,
  generatedFileName: string,
  workspaceFolder: string
): TxtJetMappedIpxactProblem[] {
  return problems.flatMap<TxtJetMappedIpxactProblem>((problem) => {
    if (!compilerProblemTargetsFile(problem.file, generatedFileName, workspaceFolder)) {
      return [];
    }

    const previewOffset = lineColumnOffset(generatedPreview.text, problem.line, problem.column);
    const sourceRange = mapPreviewRangeToSource(
      generatedPreview.mappings.filter((mapping) => mapping.kind === "outer"),
      { start: previewOffset, end: previewOffset }
    );
    return sourceRange
      ? [{ ...problem, sourceRange, mappedFrom: "generated-output" }]
      : [];
  });
}

export function globMatchesPath(pattern: string, fileName: string): boolean {
  const normalizedPattern = normalizeGlob(pattern);
  if (!normalizedPattern) {
    return false;
  }
  const normalizedFile = normalizePath(fileName);
  const candidates = [normalizedFile];
  const workspaceMarker = "/workspace/";
  const workspaceIndex = normalizedFile.indexOf(workspaceMarker);
  if (workspaceIndex !== -1) {
    candidates.push(normalizedFile.slice(workspaceIndex + workspaceMarker.length));
  }
  const patterns = normalizedPattern.startsWith("/") || normalizedPattern.startsWith("**/")
    ? [normalizedPattern]
    : [normalizedPattern, `**/${normalizedPattern}`];
  return patterns.some((candidatePattern) => {
    const regex = globToRegExp(candidatePattern);
    return candidates.some((candidate) => regex.test(candidate));
  });
}

function normalizeGlob(pattern: string): string {
  return normalizePath(pattern.trim()).replace(/^\.\//, "");
}

function normalizePath(pathLike: string): string {
  return pathLike.replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      const following = pattern[index + 2];
      if (following === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegExp(char);
  }
  return new RegExp(`${regex}$`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
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
