import { mapPreviewRangeToSource, mapSourceRangeToPreview, TxtJetMapping, TxtJetRange } from "./templateModel";

export type TxtJetPreviewSyncDirection = "source-to-preview" | "preview-to-source";

export function synchronizedPreviewRange(
  mappings: TxtJetMapping[],
  range: TxtJetRange,
  direction: TxtJetPreviewSyncDirection
): TxtJetRange | undefined {
  const deterministic = mappings.filter((mapping) =>
    mapping.kind === "outer"
    || mapping.kind === "scriptlet"
    || mapping.kind === "expression"
    || mapping.kind === "declaration"
    || mapping.kind === "append"
  );
  return direction === "source-to-preview"
    ? mapSourceRangeToPreview(deterministic, range)
    : mapPreviewRangeToSource(deterministic, range);
}
