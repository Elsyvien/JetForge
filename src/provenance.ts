import {
  TxtJetGeneratedPreview,
  TxtJetProvenance,
  TxtJetProvenanceKind,
  TxtJetRange
} from "./templateModel";

export interface TxtJetPreviewLineProvenance {
  line: number;
  preview: TxtJetRange;
  origins: TxtJetProvenance[];
}

const PROVENANCE_PRIORITY: Record<TxtJetProvenanceKind, number> = {
  expression: 0,
  include: 1,
  skeleton: 2,
  root: 3,
  unmapped: 4
};

export function previewLineProvenance(
  preview: TxtJetGeneratedPreview
): TxtJetPreviewLineProvenance[] {
  const lines = lineRanges(preview.text);
  return lines.map((range, line) => {
    const origins = uniqueProvenance(preview.provenance.filter((entry) =>
      rangesIntersectLine(entry.preview, range)
    ));
    return {
      line,
      preview: range,
      origins: origins.length > 0 ? origins : [{
        preview: range,
        kind: "unmapped",
        confidence: "unmapped",
        label: "No deterministic source mapping"
      }]
    };
  });
}

export function provenanceAtPreviewOffset(
  preview: TxtJetGeneratedPreview,
  offset: number
): TxtJetProvenance[] {
  const safeOffset = Math.max(0, Math.min(offset, preview.text.length));
  return uniqueProvenance(preview.provenance.filter((entry) =>
    rangeContainsOffset(entry.preview, safeOffset, preview.text.length)
  ));
}

export function primaryProvenance(
  entries: TxtJetProvenance[]
): TxtJetProvenance | undefined {
  return [...entries].sort((left, right) =>
    PROVENANCE_PRIORITY[left.kind] - PROVENANCE_PRIORITY[right.kind]
  )[0];
}

export function buildCompilerOutputProvenance(
  compilerText: string,
  approximatePreview: TxtJetGeneratedPreview
): TxtJetGeneratedPreview {
  const sourceLines = previewLineProvenance(approximatePreview);
  const compilerLines = lineRanges(compilerText);
  const sourceByText = occurrencesByLineText(approximatePreview.text, sourceLines.map((line) => line.preview));
  const compilerByText = occurrencesByLineText(compilerText, compilerLines);
  const provenance = compilerLines.flatMap((range) => {
    const lineText = canonicalLineText(compilerText.slice(range.start, range.end));
    const sourceMatches = sourceByText.get(lineText) ?? [];
    const compilerMatches = compilerByText.get(lineText) ?? [];
    if (lineText.trim().length === 0 || sourceMatches.length !== 1 || compilerMatches.length !== 1) {
      return [unmappedCompilerProvenance(range)];
    }
    const sourceLine = sourceLines[sourceMatches[0]];
    const mapped: TxtJetProvenance[] = sourceLine.origins
      .filter((origin) => origin.kind !== "unmapped")
      .map((origin) => ({
        ...origin,
        preview: range,
        label: ["Exact compiler-line match", origin.label].filter(Boolean).join(" · ")
      }));
    return mapped.length > 0 ? mapped : [unmappedCompilerProvenance(range)];
  });
  return {
    text: compilerText,
    mappings: [],
    provenance
  };
}

function lineRanges(text: string): TxtJetRange[] {
  const ranges: TxtJetRange[] = [];
  let start = 0;
  for (let offset = 0; offset <= text.length; offset += 1) {
    if (offset === text.length || text[offset] === "\n") {
      ranges.push({ start, end: offset });
      start = offset + 1;
    }
  }
  return ranges;
}

function occurrencesByLineText(
  text: string,
  ranges: TxtJetRange[]
): Map<string, number[]> {
  const occurrences = new Map<string, number[]>();
  ranges.forEach((range, index) => {
    const lineText = canonicalLineText(text.slice(range.start, range.end));
    const matches = occurrences.get(lineText) ?? [];
    matches.push(index);
    occurrences.set(lineText, matches);
  });
  return occurrences;
}

function canonicalLineText(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function rangeContainsOffset(
  range: TxtJetRange,
  offset: number,
  documentLength: number
): boolean {
  if (range.start <= offset && offset < range.end) {
    return true;
  }
  return offset === documentLength
    && range.end === documentLength
    && range.start < range.end;
}

function unmappedCompilerProvenance(preview: TxtJetRange): TxtJetProvenance {
  return {
    preview,
    kind: "unmapped",
    confidence: "unmapped",
    label: "External compiler output has no unique deterministic source match"
  };
}

function rangesIntersectLine(provenance: TxtJetRange, line: TxtJetRange): boolean {
  if (line.start === line.end) {
    return provenance.start <= line.start && line.start <= provenance.end;
  }
  return provenance.start < line.end && line.start < provenance.end;
}

function uniqueProvenance(entries: TxtJetProvenance[]): TxtJetProvenance[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = [
        entry.kind,
        entry.sourceFileName ?? "",
        entry.source?.start ?? "",
        entry.source?.end ?? "",
        entry.label ?? ""
      ].join("\0");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      PROVENANCE_PRIORITY[left.kind] - PROVENANCE_PRIORITY[right.kind]
    );
}
