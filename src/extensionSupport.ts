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

export function isTxtJetPath(pathLike: string): boolean {
  const lower = pathLike.toLowerCase();
  return TXTJET_PATH_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function shouldOfferMarkerCompletions(linePrefix: string): boolean {
  return linePrefix.endsWith("<");
}
