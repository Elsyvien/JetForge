export const COMPLETION_TRIGGER_CHARACTERS = ["<"] as const;

export function isTxtJetPath(pathLike: string): boolean {
  return pathLike.toLowerCase().endsWith(".txtjet");
}

export function shouldOfferMarkerCompletions(linePrefix: string): boolean {
  return linePrefix.endsWith("<");
}
