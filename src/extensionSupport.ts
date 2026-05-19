import { TxtJetTargetLanguage } from "./detector";

export const COMPLETION_TRIGGER_CHARACTERS = ["<"] as const;

const TXTJET_PATH_SUFFIXES = [
  ".txtjet",
  ".jet",
  ".javajet",
  ".htmljet",
  ".xmljet",
  ".cjet",
  ".pythonjet"
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
