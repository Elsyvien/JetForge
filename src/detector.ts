export type TxtJetTargetLanguage =
  | "txtjet"
  | "txtjet-java"
  | "txtjet-html"
  | "txtjet-xml"
  | "txtjet-c"
  | "txtjet-python";

type TargetScore = Exclude<TxtJetTargetLanguage, "txtjet">;

const TEMPLATE_BLOCK = /<%[@=!]?[\s\S]*?%>/g;

export function stripTemplateBlocks(text: string): string {
  return text.replace(TEMPLATE_BLOCK, " ");
}

export function detectTargetLanguage(text: string): TxtJetTargetLanguage {
  const outer = stripTemplateBlocks(text);
  const lower = outer.toLowerCase();
  const scores: Record<TargetScore, number> = {
    "txtjet-java": 0,
    "txtjet-html": 0,
    "txtjet-xml": 0,
    "txtjet-c": 0,
    "txtjet-python": 0
  };

  add(scores, "txtjet-xml", count(outer, /<\?xml\b/g) * 12);
  add(scores, "txtjet-xml", count(outer, /<\/?[A-Za-z_][\w:.-]*(?:\s+[\w:.-]+=(?:"[^"]*"|'[^']*'))*\s*\/?>/g) * 2);
  add(scores, "txtjet-xml", count(outer, /^\s*<\/?[A-Za-z_][\w:.-]*\b/mg) * 2);

  add(scores, "txtjet-html", includes(lower, "<!doctype html") * 14);
  add(scores, "txtjet-html", includes(lower, "<html") * 12);
  add(scores, "txtjet-html", count(lower, /<\/?(body|head|div|span|a|nav|section|main|script|style|table)\b/g) * 3);

  add(scores, "txtjet-c", count(outer, /^\s*#\s*(include|ifndef|ifdef|define|endif)\b/mg) * 6);
  add(scores, "txtjet-c", count(outer, /\btypedef\b|\bstruct\b|\benum\b|\bextern\s+"C"/g) * 5);
  add(scores, "txtjet-c", count(outer, /\b(unsigned|signed|const|char|int|long|short|void)\b/g));

  add(scores, "txtjet-python", count(outer, /^\s*(from\s+\S+\s+import|import\s+\S+)/mg) * 5);
  add(scores, "txtjet-python", count(outer, /^\s*(def|class)\s+[A-Za-z_]\w*.*:\s*$/mg) * 6);
  add(scores, "txtjet-python", count(outer, /^\s*@\w+/mg) * 3);
  add(scores, "txtjet-python", count(outer, /\bself\b|->\s*[A-Za-z_][\w.[\]]*:/g) * 2);

  add(scores, "txtjet-java", count(outer, /^\s*package\s+[\w.]+;/mg) * 7);
  add(scores, "txtjet-java", count(outer, /^\s*import\s+[\w.*]+;/mg) * 5);
  add(scores, "txtjet-java", count(outer, /\b(public|private|protected)\s+(class|interface|enum|static|final|\w+)/g) * 4);
  add(scores, "txtjet-java", count(outer, /\bnew\s+[A-Z]\w*\s*\(/g) * 2);

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[TargetScore, number]>;
  const [best, score] = ranked[0];
  if (score <= 0) {
    return "txtjet";
  }

  if (best === "txtjet-xml" && scores["txtjet-html"] >= score) {
    return "txtjet-html";
  }

  return best;
}

function add(scores: Record<TargetScore, number>, target: TargetScore, value: number): void {
  scores[target] += value;
}

function count(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function includes(text: string, needle: string): number {
  return text.includes(needle) ? 1 : 0;
}

