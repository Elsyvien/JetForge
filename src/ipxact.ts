import { compilerProblemTargetsFile, TxtJetCompilerProblem } from "./compilerDiagnostics";
import { parseTxtJetTemplate, mapPreviewRangeToSource, TxtJetGeneratedPreview, TxtJetRange } from "./templateModel";

export interface TxtJetIpxactMatchOptions {
  enabled: boolean;
  templateGlobs?: string[];
}

export interface TxtJetMappedIpxactProblem extends TxtJetCompilerProblem {
  sourceRange: TxtJetRange;
  mappedFrom: "generated-output";
  explanation?: TxtJetIpxactValidationExplanation;
}

export interface TxtJetIpxactValidationExplanation {
  summary: string;
  guidance: string;
  elementName?: string;
  expectedElements?: string[];
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
      ? [{
        ...problem,
        sourceRange,
        mappedFrom: "generated-output",
        explanation: explainIpxactValidationMessage(problem.message)
      }]
      : [];
  });
}

export function explainIpxactValidationMessage(
  message: string
): TxtJetIpxactValidationExplanation | undefined {
  const unexpected = message.match(
    /(?:Invalid content was found starting with element|Element)\s+['"]([^'"]+)['"]/i
  );
  if (unexpected && /(?:Invalid content|This element is not expected)/i.test(message)) {
    const expectedText = message.match(/One of\s+['"]?(.+?)['"]?\s+is expected/i)?.[1]
      ?? message.match(/Expected is\s*\(?\s*(.+?)\s*\)?\.?$/i)?.[1]
      ?? "";
    const expectedElements = xmlNamesFromValidatorText(expectedText);
    return {
      summary: `Element <${localName(unexpected[1])}> is not allowed at this position.`,
      guidance: expectedElements.length > 0
        ? `Use one of the schema-permitted children here: ${expectedElements.map((name) => `<${name}>`).join(", ")}.`
        : "Check the parent element's permitted child order in the configured IP-XACT schema.",
      elementName: localName(unexpected[1]),
      expectedElements
    };
  }

  const disallowedAttribute = message.match(
    /Attribute\s+['"]([^'"]+)['"]\s+is not allowed(?: to appear)?(?: in element\s+['"]([^'"]+)['"])?/i
  );
  if (disallowedAttribute) {
    const elementName = localName(disallowedAttribute[2] ?? "");
    return {
      summary: `Attribute ${localName(disallowedAttribute[1])} is not permitted${elementName ? ` on <${elementName}>` : ""}.`,
      guidance: "Remove the attribute or use one declared for this element by the configured IP-XACT schema.",
      elementName: elementName || undefined
    };
  }

  const invalidValue = message.match(
    /['"]([^'"]+)['"]\s+is not a valid value for\s+['"]([^'"]+)['"]/i
  );
  if (invalidValue) {
    return {
      summary: `Value “${invalidValue[1]}” does not match schema type ${localName(invalidValue[2])}.`,
      guidance: "Replace it with a value accepted by the element or attribute type in the configured schema."
    };
  }

  const missingDeclaration = message.match(
    /(?:Cannot find the declaration of element|No matching global declaration available for the validation root)\s+['"]?([^'".\s]+)['"]?/i
  );
  if (missingDeclaration) {
    const elementName = localName(missingDeclaration[1]);
    return {
      summary: `No schema declaration was found for <${elementName}>.`,
      guidance: "Check the element namespace and confirm that the configured schema bundle matches this IP-XACT version.",
      elementName
    };
  }

  return undefined;
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

function xmlNamesFromValidatorText(value: string): string[] {
  const names = new Set<string>();
  const pattern = /(?:\{[^}]*\})?([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const name = localName(match[1]);
    if (!["one", "of", "is", "expected"].includes(name.toLowerCase())) {
      names.add(name);
    }
  }
  return [...names].slice(0, 8);
}

function localName(value: string): string {
  const clarkNamespaceEnd = value.lastIndexOf("}");
  const local = clarkNamespaceEnd >= 0
    ? value.slice(clarkNamespaceEnd + 1)
    : value.slice(value.lastIndexOf(":") + 1);
  return local.replace(/[{}(),]/g, "");
}
