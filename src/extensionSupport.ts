import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { TxtJetTargetLanguage } from "./detector";

export const COMPLETION_TRIGGER_CHARACTERS = ["<"] as const;
export const DIRECTIVE_VALUE_TRIGGER_CHARACTERS = ["\"", "'", "/", "\\", "."] as const;
export const DEFAULT_COMPILER_TIMEOUT_MS = 60000;
export const MIN_COMPILER_TIMEOUT_MS = 1000;
export const MAX_COMPILER_TIMEOUT_MS = 600000;

export interface TxtJetDirectiveValueContext {
  directiveName: string;
  attributeName: string;
  value: string;
  valueRange: {
    start: number;
    end: number;
  };
  quote: "\"" | "'";
  prefix: string;
}

const TXTJET_PATH_SUFFIXES = [
  ".txtjet",
  ".jet",
  ".javajet",
  ".htmljet",
  ".xmljet",
  ".cjet",
  ".pythonjet",
  ".propertiesjet",
  ".jetinc"
];

const TXTJET_LANGUAGE_IDS = new Set<TxtJetTargetLanguage>([
  "txtjet",
  "txtjet-java",
  "txtjet-html",
  "txtjet-xml",
  "txtjet-c",
  "txtjet-python"
]);

export function isTxtJetPath(pathLike: string): boolean {
  const lower = pathLike.toLowerCase();
  return TXTJET_PATH_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function stripTxtJetSuffix(pathLike: string): string {
  const lower = pathLike.toLowerCase();
  const suffix = TXTJET_PATH_SUFFIXES.find((candidate) => lower.endsWith(candidate));
  return suffix ? pathLike.slice(0, -suffix.length) : pathLike;
}

export function shouldOfferMarkerCompletions(linePrefix: string): boolean {
  return linePrefix.endsWith("<");
}

export function selectedTargetLanguageId(
  currentLanguageId: string,
  detectedLanguageId: TxtJetTargetLanguage
): TxtJetTargetLanguage {
  return TXTJET_LANGUAGE_IDS.has(currentLanguageId as TxtJetTargetLanguage)
    ? currentLanguageId as TxtJetTargetLanguage
    : detectedLanguageId;
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function windowsCmdDoubleQuote(value: string): string {
  if (/[\0\r\n"%!]/.test(value)) {
    throw new Error(
      "Windows shell arguments cannot contain NUL, line breaks, double quotes, percent signs, or exclamation marks."
    );
  }

  const escapedTrailingBackslashes = value.replace(/\\+$/, (slashes) => `${slashes}${slashes}`);
  return `"${escapedTrailingBackslashes}"`;
}

export function shellArgumentQuote(value: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? windowsCmdDoubleQuote(value) : shellSingleQuote(value);
}

export function resolveWorkspaceConfiguredPath(configuredPath: string, workspaceRoot: string): string {
  const expanded = configuredPath.split("${workspaceFolder}").join(workspaceRoot);
  return resolve(workspaceRoot, expanded);
}

export function resolveContainedWorkspacePath(configuredPath: string, workspaceRoot: string): string | undefined {
  const candidate = resolveWorkspaceConfiguredPath(configuredPath, workspaceRoot);
  return isPathInsideAnyRoot(candidate, [workspaceRoot]) ? candidate : undefined;
}

export function compilerTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_COMPILER_TIMEOUT_MS;
  }
  return Math.min(MAX_COMPILER_TIMEOUT_MS, Math.max(MIN_COMPILER_TIMEOUT_MS, Math.floor(value)));
}

export function isPathInsideAnyRoot(candidate: string, roots: string[]): boolean {
  const resolvedCandidate = canonicalPotentialPath(candidate);
  if (!resolvedCandidate) {
    return false;
  }
  return roots.some((root) => {
    const resolvedRoot = canonicalPotentialPath(root);
    if (!resolvedRoot) {
      return false;
    }
    const relativePath = relative(resolvedRoot, resolvedCandidate);
    return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
  });
}

function canonicalPotentialPath(pathLike: string): string | undefined {
  const resolvedPath = resolve(pathLike);
  let existingPath = resolvedPath;
  while (!existsSync(existingPath)) {
    const parent = dirname(existingPath);
    if (parent === existingPath) {
      return resolvedPath;
    }
    existingPath = parent;
  }

  try {
    return resolve(realpathSync(existingPath), relative(existingPath, resolvedPath));
  } catch {
    return undefined;
  }
}

export function directiveValueContextAt(text: string, offset: number): TxtJetDirectiveValueContext | undefined {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const directiveOpen = text.lastIndexOf("<%@", safeOffset);
  const lastClose = text.lastIndexOf("%>", safeOffset);
  if (directiveOpen === -1 || directiveOpen < lastClose) {
    return undefined;
  }

  const directiveClose = text.indexOf("%>", directiveOpen + 3);
  const contentEnd = directiveClose === -1 ? text.length : directiveClose;
  if (safeOffset > contentEnd) {
    return undefined;
  }

  const contentStart = directiveOpen + 3;
  const content = text.slice(contentStart, contentEnd);
  const directiveName = content.trimStart().match(/^([A-Za-z_][\w.-]*)/)?.[1] ?? "";
  const attributePattern = /([A-Za-z_][\w.-]*)\s*=\s*(["'])/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(content))) {
    const attributeName = match[1];
    const quote = match[2] as "\"" | "'";
    const quoteStart = contentStart + match.index + match[0].length - 1;
    const valueStart = quoteStart + 1;
    const valueEnd = findDirectiveValueEnd(text, valueStart, contentEnd, quote);
    if (valueStart <= safeOffset && safeOffset <= valueEnd) {
      return {
        directiveName,
        attributeName,
        value: text.slice(valueStart, valueEnd),
        valueRange: { start: valueStart, end: valueEnd },
        quote,
        prefix: text.slice(valueStart, safeOffset)
      };
    }

    attributePattern.lastIndex = valueEnd - contentStart + (valueEnd < contentEnd ? 1 : 0);
  }

  return undefined;
}

function findDirectiveValueEnd(text: string, valueStart: number, contentEnd: number, quote: "\"" | "'"): number {
  let escaped = false;
  for (let index = valueStart; index < contentEnd; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return index;
    }
  }
  return contentEnd;
}
