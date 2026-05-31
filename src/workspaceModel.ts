import { normalize } from "node:path";
import { detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import { isTxtJetPath } from "./extensionSupport";
import {
  parseTxtJetTemplate,
  resolveReferenceCandidates,
  TxtJetDirective,
  TxtJetRange
} from "./templateModel";

export type TxtJetWorkspaceEntryKind = "template" | "include" | "skeleton";
export type TxtJetWorkspaceReferenceKind = "include" | "skeleton";

export interface TxtJetWorkspaceFile {
  fileName: string;
  text?: string;
}

export interface TxtJetWorkspaceReference {
  kind: TxtJetWorkspaceReferenceKind;
  sourceFileName: string;
  referenceFile: string;
  range: TxtJetRange;
  resolvedFileName?: string;
  candidates: string[];
}

export interface TxtJetWorkspaceEntry {
  fileName: string;
  kind: TxtJetWorkspaceEntryKind;
  text?: string;
  targetLanguage: TxtJetTargetLanguage;
  references: TxtJetWorkspaceReference[];
  includedBy: string[];
  skeletonUsedBy: string[];
}

export interface TxtJetWorkspaceModel {
  entries: TxtJetWorkspaceEntry[];
  templates: TxtJetWorkspaceEntry[];
  includes: TxtJetWorkspaceEntry[];
  skeletons: TxtJetWorkspaceEntry[];
  unresolvedReferences: TxtJetWorkspaceReference[];
  entry(fileName: string): TxtJetWorkspaceEntry | undefined;
  referencesFrom(fileName: string, kind?: TxtJetWorkspaceReferenceKind): TxtJetWorkspaceReference[];
  referenceExists(fileName: string, referenceFile: string, kind: TxtJetWorkspaceReferenceKind): boolean;
  includingTemplates(fileName: string): TxtJetWorkspaceEntry[];
}

export interface TxtJetWorkspaceModelOptions {
  includePathsForFile?: (fileName: string) => string[];
  skeletonPathsForFile?: (fileName: string) => string[];
}

export const TXTJET_WORKSPACE_GLOB = "**/*.{txtjet,jet,javajet,htmljet,xmljet,cjet,pythonjet,jetinc,skeleton}";
export const TXTJET_WORKSPACE_EXCLUDE_GLOB = "{**/node_modules/**,**/out/**,**/.git/**,**/.vscode-test/**}";

export function createTxtJetWorkspaceModel(
  files: TxtJetWorkspaceFile[],
  options: TxtJetWorkspaceModelOptions = {}
): TxtJetWorkspaceModel {
  const entriesByFile = new Map<string, TxtJetWorkspaceEntry>();

  for (const file of files) {
    const fileName = normalize(file.fileName);
    const kind = workspaceEntryKind(fileName);
    if (!kind) {
      continue;
    }
    entriesByFile.set(fileName, {
      fileName,
      kind,
      text: file.text,
      targetLanguage: detectTargetLanguageFromFileName(fileName),
      references: [],
      includedBy: [],
      skeletonUsedBy: []
    });
  }

  for (const entry of entriesByFile.values()) {
    if (entry.kind === "skeleton" || entry.text === undefined) {
      continue;
    }
    entry.references = referencesForEntry(entry, entriesByFile, options);
  }

  for (const entry of entriesByFile.values()) {
    for (const reference of entry.references) {
      if (!reference.resolvedFileName) {
        continue;
      }
      const target = entriesByFile.get(reference.resolvedFileName);
      if (!target) {
        continue;
      }
      if (reference.kind === "include") {
        target.includedBy = sortedUnique([...target.includedBy, entry.fileName]);
      } else {
        target.skeletonUsedBy = sortedUnique([...target.skeletonUsedBy, entry.fileName]);
      }
    }
  }

  const entries = Array.from(entriesByFile.values()).sort(compareEntry);
  const unresolvedReferences = entries
    .flatMap((entry) => entry.references)
    .filter((reference) => !reference.resolvedFileName)
    .sort(compareReference);

  return {
    entries,
    templates: entries.filter((entry) => entry.kind === "template"),
    includes: entries.filter((entry) => entry.kind === "include"),
    skeletons: entries.filter((entry) => entry.kind === "skeleton"),
    unresolvedReferences,
    entry(fileName) {
      return entriesByFile.get(normalize(fileName));
    },
    referencesFrom(fileName, kind) {
      const references = entriesByFile.get(normalize(fileName))?.references ?? [];
      return kind ? references.filter((reference) => reference.kind === kind) : references;
    },
    referenceExists(fileName, referenceFile, kind) {
      return referencesForFileName(normalize(fileName), referenceFile, kind, entriesByFile, options).some((candidate) =>
        entriesByFile.has(candidate)
      );
    },
    includingTemplates(fileName) {
      const entry = entriesByFile.get(normalize(fileName));
      if (!entry) {
        return [];
      }
      return entry.includedBy
        .map((includingFile) => entriesByFile.get(includingFile))
        .filter((includingEntry): includingEntry is TxtJetWorkspaceEntry => Boolean(includingEntry))
        .sort(compareEntry);
    }
  };
}

export function workspaceEntryKind(fileName: string): TxtJetWorkspaceEntryKind | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".skeleton")) {
    return "skeleton";
  }
  if (lower.endsWith(".jetinc")) {
    return "include";
  }
  return isTxtJetPath(lower) ? "template" : undefined;
}

function referencesForEntry(
  entry: TxtJetWorkspaceEntry,
  entriesByFile: Map<string, TxtJetWorkspaceEntry>,
  options: TxtJetWorkspaceModelOptions
): TxtJetWorkspaceReference[] {
  const model = parseTxtJetTemplate(entry.text ?? "");
  const references: TxtJetWorkspaceReference[] = [];
  for (const include of model.includes) {
    references.push(directiveReference(entry.fileName, include, "include", entriesByFile, options));
  }
  if (model.jetDirective?.attributes.skeleton) {
    references.push(directiveReference(entry.fileName, model.jetDirective, "skeleton", entriesByFile, options));
  }
  return references.sort(compareReference);
}

function directiveReference(
  sourceFileName: string,
  directive: TxtJetDirective,
  kind: TxtJetWorkspaceReferenceKind,
  entriesByFile: Map<string, TxtJetWorkspaceEntry>,
  options: TxtJetWorkspaceModelOptions
): TxtJetWorkspaceReference {
  const attribute = kind === "include" ? "file" : "skeleton";
  const referenceFile = directive.attributes[attribute] ?? "";
  const candidates = referencesForFileName(sourceFileName, referenceFile, kind, undefined, options);
  return {
    kind,
    sourceFileName,
    referenceFile,
    range: directive.attributeRanges[attribute] ?? directive.nameRange,
    resolvedFileName: candidates.find((candidate) => entriesByFile.has(candidate)),
    candidates
  };
}

function referencesForFileName(
  sourceFileName: string,
  referenceFile: string,
  kind: TxtJetWorkspaceReferenceKind,
  entriesByFile: Map<string, TxtJetWorkspaceEntry> | undefined,
  options: TxtJetWorkspaceModelOptions
): string[] {
  const searchPaths = kind === "include"
    ? options.includePathsForFile?.(sourceFileName) ?? []
    : options.skeletonPathsForFile?.(sourceFileName) ?? [];
  const candidates = resolveReferenceCandidates(sourceFileName, referenceFile, { searchPaths })
    .map((candidate) => normalize(candidate));
  if (!entriesByFile) {
    return candidates;
  }
  return candidates.filter((candidate) => entriesByFile.has(candidate));
}

function compareEntry(left: TxtJetWorkspaceEntry, right: TxtJetWorkspaceEntry): number {
  return left.fileName.localeCompare(right.fileName);
}

function compareReference(left: TxtJetWorkspaceReference, right: TxtJetWorkspaceReference): number {
  return left.sourceFileName.localeCompare(right.sourceFileName)
    || left.kind.localeCompare(right.kind)
    || left.referenceFile.localeCompare(right.referenceFile);
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
