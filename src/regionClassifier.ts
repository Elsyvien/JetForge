import { TxtJetTargetLanguage } from "./detector";
import {
  parseTxtJetTemplate,
  TxtJetBlockKind,
  TxtJetRange
} from "./templateModel";

export type TxtJetRegionKind = "directive" | "template-java" | "generated-output" | "marker";

export interface TxtJetRegion {
  kind: TxtJetRegionKind;
  range: TxtJetRange;
  blockKind: TxtJetBlockKind;
  targetLanguage: TxtJetTargetLanguage;
}

const TEMPLATE_JAVA_BLOCKS = new Set<TxtJetBlockKind>(["scriptlet", "expression", "declaration"]);

export function classifyTxtJetRegions(
  text: string,
  targetLanguage: TxtJetTargetLanguage = "txtjet"
): TxtJetRegion[] {
  const model = parseTxtJetTemplate(text);
  const regions: TxtJetRegion[] = [];

  for (const block of model.blocks) {
    if (block.kind === "outer") {
      pushRegion(regions, "generated-output", block.range, block.kind, targetLanguage);
      continue;
    }

    pushRegion(
      regions,
      "marker",
      { start: block.range.start, end: block.contentRange.start },
      block.kind,
      targetLanguage
    );

    if (block.kind === "directive") {
      pushRegion(regions, "directive", block.contentRange, block.kind, targetLanguage);
    } else if (TEMPLATE_JAVA_BLOCKS.has(block.kind)) {
      pushRegion(regions, "template-java", block.contentRange, block.kind, targetLanguage);
    }

    pushRegion(
      regions,
      "marker",
      { start: block.contentRange.end, end: block.range.end },
      block.kind,
      targetLanguage
    );
  }

  return regions;
}

export function classifyTxtJetRegionAt(
  text: string,
  offset: number,
  targetLanguage: TxtJetTargetLanguage = "txtjet"
): TxtJetRegion | undefined {
  const regions = classifyTxtJetRegions(text, targetLanguage);
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  return regions.find((region) =>
    region.range.start <= boundedOffset && boundedOffset < region.range.end
  ) ?? regions.find((region) =>
    region.range.start < region.range.end && boundedOffset === region.range.end
  );
}

function pushRegion(
  regions: TxtJetRegion[],
  kind: TxtJetRegionKind,
  range: TxtJetRange,
  blockKind: TxtJetBlockKind,
  targetLanguage: TxtJetTargetLanguage
): void {
  if (range.end <= range.start) {
    return;
  }

  regions.push({ kind, range, blockKind, targetLanguage });
}
