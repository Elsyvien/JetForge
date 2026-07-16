import { normalize } from "node:path";
import { detectTargetLanguageFromFileName, TxtJetTargetLanguage } from "./detector";
import { isTxtJetPath } from "./extensionSupport";
import { isIpxactTemplate } from "./ipxact";
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
  ipxactTemplates: TxtJetWorkspaceEntry[];
  unresolvedReferences: TxtJetWorkspaceReference[];
  entry(fileName: string): TxtJetWorkspaceEntry | undefined;
  referencesFrom(fileName: string, kind?: TxtJetWorkspaceReferenceKind): TxtJetWorkspaceReference[];
  referencesTo(fileName: string, kind?: TxtJetWorkspaceReferenceKind): TxtJetWorkspaceReference[];
  referenceExists(fileName: string, referenceFile: string, kind: TxtJetWorkspaceReferenceKind): boolean;
  includingTemplates(fileName: string): TxtJetWorkspaceEntry[];
  impactedBy(fileName: string): TxtJetWorkspaceImpact;
}

export interface TxtJetWorkspaceImpact {
  source?: TxtJetWorkspaceEntry;
  affectedEntries: TxtJetWorkspaceEntry[];
  affectedTemplates: TxtJetWorkspaceEntry[];
  generatedTargets: TxtJetWorkspaceEntry[];
  references: TxtJetWorkspaceReference[];
}

export interface TxtJetWorkspaceModelOptions {
  includePathsForFile?: (fileName: string) => string[];
  skeletonPathsForFile?: (fileName: string) => string[];
  ipxactOptionsForFile?: (fileName: string) => { enabled: boolean; templateGlobs: string[] };
  ipxactEnabled?: boolean;
  ipxactTemplateGlobs?: string[];
}

export const TXTJET_WORKSPACE_GLOB = "**/*.{txtjet,jet,javajet,htmljet,xmljet,cjet,pythonjet,texjet,latexjet,propertiesjet,jetinc,skeleton}";
const TXTJET_WORKSPACE_EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "out",
  ".git",
  ".vscode-test",
  ".playwright-cli",
  ".antigravitycli",
  "private-examples"
]);
export const TXTJET_WORKSPACE_EXCLUDE_GLOB =
  "{**/node_modules/**,**/out/**,**/.git/**,**/.vscode-test/**,**/.playwright-cli/**,**/.antigravitycli/**,**/private-examples/**}";

export function createTxtJetWorkspaceModel(
  files: TxtJetWorkspaceFile[],
  options: TxtJetWorkspaceModelOptions = {}
): TxtJetWorkspaceModel {
  const entriesByFile = new Map<string, TxtJetWorkspaceEntry>();
  const referencesByTarget = new Map<string, TxtJetWorkspaceReference[]>();

  for (const file of files) {
    const fileName = normalize(file.fileName);
    const kind = workspaceEntryKind(fileName);
    if (!kind || isExcludedTxtJetWorkspacePath(fileName)) {
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
      const incoming = referencesByTarget.get(reference.resolvedFileName) ?? [];
      incoming.push(reference);
      referencesByTarget.set(reference.resolvedFileName, incoming);
      if (reference.kind === "include") {
        target.includedBy.push(entry.fileName);
      } else {
        target.skeletonUsedBy.push(entry.fileName);
      }
    }
  }

  for (const entry of entriesByFile.values()) {
    entry.includedBy = sortedUnique(entry.includedBy);
    entry.skeletonUsedBy = sortedUnique(entry.skeletonUsedBy);
  }
  for (const references of referencesByTarget.values()) {
    references.sort(compareReference);
  }

  const entries = Array.from(entriesByFile.values()).sort(compareEntry);
  const unresolvedReferences = entries
    .flatMap((entry) => entry.references)
    .filter((reference) => !reference.resolvedFileName)
    .sort(compareReference);
  const ipxactTemplates = entries
    .filter((entry) => {
      if (entry.kind !== "template") {
        return false;
      }
      const fileOptions = options.ipxactOptionsForFile?.(entry.fileName);
      return isIpxactTemplate(entry.fileName, entry.text, fileOptions ?? {
        enabled: options.ipxactEnabled ?? false,
        templateGlobs: options.ipxactTemplateGlobs ?? []
      });
    })
    .sort(compareEntry);

  return {
    entries,
    templates: entries.filter((entry) => entry.kind === "template"),
    includes: entries.filter((entry) => entry.kind === "include"),
    skeletons: entries.filter((entry) => entry.kind === "skeleton"),
    ipxactTemplates,
    unresolvedReferences,
    entry(fileName) {
      return entriesByFile.get(normalize(fileName));
    },
    referencesFrom(fileName, kind) {
      const references = entriesByFile.get(normalize(fileName))?.references ?? [];
      return kind ? references.filter((reference) => reference.kind === kind) : references;
    },
    referencesTo(fileName, kind) {
      const targetFileName = normalize(fileName);
      const references = referencesByTarget.get(targetFileName) ?? [];
      return kind ? references.filter((reference) => reference.kind === kind) : [...references];
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
    },
    impactedBy(fileName) {
      return workspaceImpactForFile(normalize(fileName), entriesByFile, referencesByTarget);
    }
  };
}

/**
 * Reports whether rebuilding the workspace changed reference relationships.
 * Text-only edits are intentionally ignored so preview refreshes can stay
 * targeted, while newly resolved, removed, or redirected references trigger a
 * conservative refresh of already-open previews.
 */
export function workspaceModelTopologyChanged(
  previous: TxtJetWorkspaceModel,
  next: TxtJetWorkspaceModel
): boolean {
  const previousReferences = workspaceReferenceTopology(previous);
  const nextReferences = workspaceReferenceTopology(next);
  return previousReferences.length !== nextReferences.length
    || previousReferences.some((reference, index) => reference !== nextReferences[index]);
}

export function isExcludedTxtJetWorkspacePath(fileName: string): boolean {
  return normalize(fileName)
    .split(/[\\/]+/)
    .some((part) => TXTJET_WORKSPACE_EXCLUDED_DIRECTORIES.has(part));
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

function workspaceReferenceTopology(model: TxtJetWorkspaceModel): string[] {
  return model.entries
    .flatMap((entry) => entry.references.map((reference) => [
      reference.sourceFileName,
      reference.kind,
      reference.referenceFile,
      reference.resolvedFileName ?? ""
    ].join("\0")))
    .sort();
}

function workspaceImpactForFile(
  fileName: string,
  entriesByFile: Map<string, TxtJetWorkspaceEntry>,
  referencesByTarget: Map<string, TxtJetWorkspaceReference[]>
): TxtJetWorkspaceImpact {
  const affectedFileNames = new Set<string>();
  const references: TxtJetWorkspaceReference[] = [];
  const queue = [fileName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (affectedFileNames.has(current)) {
      continue;
    }
    affectedFileNames.add(current);

    for (const reference of referencesByTarget.get(current) ?? []) {
      references.push(reference);
      if (!affectedFileNames.has(reference.sourceFileName)) {
        queue.push(reference.sourceFileName);
      }
    }
  }

  const affectedEntries = Array.from(affectedFileNames)
    .map((affectedFileName) => entriesByFile.get(affectedFileName))
    .filter((entry): entry is TxtJetWorkspaceEntry => Boolean(entry))
    .sort(compareEntry);
  const affectedTemplates = affectedEntries
    .filter((entry) => entry.kind === "template")
    .sort(compareEntry);
  return {
    source: entriesByFile.get(fileName),
    affectedEntries,
    affectedTemplates,
    generatedTargets: affectedTemplates,
    references: references.sort(compareReference)
  };
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
