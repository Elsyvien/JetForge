import { parseTxtJetTemplate } from "./templateModel";

export type TxtJetIssueCode =
  | "unclosed-block"
  | "unexpected-close"
  | "malformed-directive"
  | "empty-directive"
  | "unterminated-directive-string"
  | "duplicate-jet-directive"
  | "missing-include-file"
  | "unresolved-include-file"
  | "malformed-directive-attribute"
  | "unknown-directive";

export interface TxtJetIssue {
  code: TxtJetIssueCode;
  message: string;
  start: number;
  end: number;
}

const OPEN_MARKERS = ["<%@", "<%=", "<%!", "<%"];

export function scanTxtJetIssues(text: string): TxtJetIssue[] {
  const issues: TxtJetIssue[] = [];
  let offset = 0;

  while (offset < text.length) {
    const nextOpen = findNextOpen(text, offset);
    const nextClose = text.indexOf("%>", offset);

    if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
      issues.push({
        code: "unexpected-close",
        message: "Unexpected TxtJet closing delimiter without a matching opening delimiter.",
        start: nextClose,
        end: nextClose + 2
      });
      offset = nextClose + 2;
      continue;
    }

    if (nextOpen === -1) {
      break;
    }

    const marker = markerAt(text, nextOpen);
    if (!marker) {
      offset = nextOpen + 2;
      continue;
    }

    const contentStart = nextOpen + marker.length;
    const close = text.indexOf("%>", contentStart);
    if (close === -1) {
      issues.push({
        code: "unclosed-block",
        message: "Unclosed TxtJet block. Add a matching %> delimiter.",
        start: nextOpen,
        end: Math.min(text.length, nextOpen + marker.length)
      });
      break;
    }

    if (marker === "<%@") {
      issues.push(...scanDirective(text, contentStart, close));
    }

    offset = close + 2;
  }

  return issues;
}

export function scanTxtJetDirectiveIssues(
  text: string,
  includeExists?: (includeFile: string) => boolean
): TxtJetIssue[] {
  const issues: TxtJetIssue[] = [];
  const model = parseTxtJetTemplate(text);
  const jetDirectives = model.directives.filter((directive) => directive.name === "jet");

  for (const duplicate of jetDirectives.slice(1)) {
    issues.push({
      code: "duplicate-jet-directive",
      message: "Duplicate @jet directive. Only the first @jet directive is used for generated Java previews.",
      start: duplicate.nameRange.start,
      end: duplicate.nameRange.end
    });
  }

  for (const directive of model.directives) {
    if (directive.name && directive.name !== "jet" && directive.name !== "include") {
      issues.push({
        code: "unknown-directive",
        message: `Unknown core TxtJet directive "${directive.name}".`,
        start: directive.nameRange.start,
        end: directive.nameRange.end
      });
    }

    for (const malformed of directive.malformedAttributes) {
      issues.push({
        code: "malformed-directive-attribute",
        message: "Malformed TxtJet directive attribute. Use name=\"value\" syntax.",
        start: malformed.start,
        end: malformed.end
      });
    }

    if (directive.name === "include") {
      const includeFile = directive.attributes.file;
      const fileRange = directive.attributeRanges.file ?? directive.nameRange;
      if (!includeFile) {
        issues.push({
          code: "missing-include-file",
          message: "TxtJet include directive is missing a file attribute.",
          start: fileRange.start,
          end: fileRange.end
        });
      } else if (includeExists && !includeExists(includeFile)) {
        issues.push({
          code: "unresolved-include-file",
          message: `TxtJet include file "${includeFile}" could not be resolved relative to this template.`,
          start: fileRange.start,
          end: fileRange.end
        });
      }
    }
  }

  return issues;
}

function findNextOpen(text: string, from: number): number {
  let next = -1;
  for (const marker of OPEN_MARKERS) {
    const index = text.indexOf(marker, from);
    if (index !== -1 && (next === -1 || index < next)) {
      next = index;
    }
  }
  return next;
}

function markerAt(text: string, offset: number): string | undefined {
  return OPEN_MARKERS.find((marker) => text.startsWith(marker, offset));
}

function scanDirective(text: string, contentStart: number, close: number): TxtJetIssue[] {
  const issues: TxtJetIssue[] = [];
  const content = text.slice(contentStart, close);
  const leadingWhitespace = content.match(/^\s*/)?.[0].length ?? 0;
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    issues.push({
      code: "empty-directive",
      message: "TxtJet directive is missing a directive name.",
      start: contentStart,
      end: close
    });
    return issues;
  }

  const nameStart = contentStart + leadingWhitespace;
  const nameMatch = trimmed.match(/^([^\s=]+)/);
  const directiveName = nameMatch?.[1] ?? "";
  if (!/^[A-Za-z_][\w.-]*$/.test(directiveName)) {
    issues.push({
      code: "malformed-directive",
      message: "Malformed TxtJet directive name.",
      start: nameStart,
      end: nameStart + Math.max(1, directiveName.length)
    });
  }

  const unterminatedQuoteStart = findUnterminatedQuote(content);
  if (unterminatedQuoteStart !== -1) {
    issues.push({
      code: "unterminated-directive-string",
      message: "Unterminated quoted string inside TxtJet directive.",
      start: contentStart + unterminatedQuoteStart,
      end: close
    });
  }

  return issues;
}

function findUnterminatedQuote(text: string): number {
  let quote: string | undefined;
  let quoteStart = -1;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (!quote && (char === "\"" || char === "'")) {
      quote = char;
      quoteStart = i;
      continue;
    }
    if (quote && char === quote) {
      quote = undefined;
      quoteStart = -1;
    }
  }

  return quote ? quoteStart : -1;
}
