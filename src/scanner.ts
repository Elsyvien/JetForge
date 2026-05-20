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
  | "missing-skeleton-file"
  | "unresolved-skeleton-file"
  | "invalid-jet-package"
  | "invalid-jet-class"
  | "invalid-jet-imports"
  | "invalid-skeleton-path"
  | "duplicate-directive-attribute"
  | "unknown-directive-attribute"
  | "malformed-directive-attribute"
  | "unknown-directive";

export interface TxtJetIssue {
  code: TxtJetIssueCode;
  message: string;
  start: number;
  end: number;
}

export interface TxtJetReferenceChecks {
  includeExists?: (includeFile: string) => boolean;
  skeletonExists?: (skeletonFile: string) => boolean;
}

const OPEN_MARKERS = ["<%@", "<%=", "<%!", "<%"];
const KNOWN_DIRECTIVE_ATTRIBUTES: Record<string, Set<string>> = {
  jet: new Set(["package", "class", "imports", "skeleton"]),
  include: new Set(["file"])
};

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
  referenceChecks?: TxtJetReferenceChecks
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

    for (const duplicate of directive.duplicateAttributes) {
      issues.push({
        code: "duplicate-directive-attribute",
        message: `Duplicate TxtJet directive attribute "${duplicate.name}". Only one value is used.`,
        start: duplicate.range.start,
        end: duplicate.range.end
      });
    }

    const knownAttributes = KNOWN_DIRECTIVE_ATTRIBUTES[directive.name];
    if (knownAttributes) {
      for (const [name, range] of Object.entries(directive.attributeRanges)) {
        if (!knownAttributes.has(name)) {
          issues.push({
            code: "unknown-directive-attribute",
            message: `Unknown @${directive.name} attribute "${name}".`,
            start: range.start,
            end: range.end
          });
        }
      }
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
      } else if (referenceChecks?.includeExists && !referenceChecks.includeExists(includeFile)) {
        issues.push({
          code: "unresolved-include-file",
          message: `TxtJet include file "${includeFile}" could not be resolved relative to this template.`,
          start: fileRange.start,
          end: fileRange.end
        });
      }
    }

    if (directive.name === "jet" && "skeleton" in directive.attributes) {
      const skeletonFile = directive.attributes.skeleton;
      const skeletonRange = directive.attributeRanges.skeleton ?? directive.nameRange;
      if (!skeletonFile) {
        issues.push({
          code: "missing-skeleton-file",
          message: "TxtJet jet directive has an empty skeleton attribute.",
          start: skeletonRange.start,
          end: skeletonRange.end
        });
      } else if (!isValidSkeletonPath(skeletonFile)) {
        issues.push({
          code: "invalid-skeleton-path",
          message: "TxtJet skeleton should be a relative .skeleton file path.",
          start: skeletonRange.start,
          end: skeletonRange.end
        });
      } else if (referenceChecks?.skeletonExists && !referenceChecks.skeletonExists(skeletonFile)) {
        issues.push({
          code: "unresolved-skeleton-file",
          message: `TxtJet skeleton file "${skeletonFile}" could not be resolved relative to this template.`,
          start: skeletonRange.start,
          end: skeletonRange.end
        });
      }
    }

    if (directive.name === "jet") {
      issues.push(...scanJetAttributeValues(directive));
    }
  }

  return issues;
}

function scanJetAttributeValues(directive: NonNullable<ReturnType<typeof parseTxtJetTemplate>["jetDirective"]>): TxtJetIssue[] {
  const issues: TxtJetIssue[] = [];
  const packageName = directive.attributes.package;
  if (packageName && !isValidPackageName(packageName)) {
    const range = directive.attributeRanges.package ?? directive.nameRange;
    issues.push({
      code: "invalid-jet-package",
      message: "TxtJet @jet package must be a valid Java package name.",
      start: range.start,
      end: range.end
    });
  }

  const className = directive.attributes.class;
  if (className && !isValidClassName(className)) {
    const range = directive.attributeRanges.class ?? directive.nameRange;
    issues.push({
      code: "invalid-jet-class",
      message: "TxtJet @jet class must be a valid Java class name.",
      start: range.start,
      end: range.end
    });
  }

  const imports = directive.attributes.imports;
  if (imports && !areValidImports(imports)) {
    const range = directive.attributeRanges.imports ?? directive.nameRange;
    issues.push({
      code: "invalid-jet-imports",
      message: "TxtJet @jet imports must be comma- or semicolon-separated Java imports.",
      start: range.start,
      end: range.end
    });
  }
  return issues;
}

function isValidPackageName(value: string): boolean {
  return /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(value);
}

function isValidClassName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function areValidImports(value: string): boolean {
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .every((entry) => /^[A-Za-z_][\w]*(?:\.[A-Za-z_*][\w*]*)*$/.test(entry));
}

function isValidSkeletonPath(value: string): boolean {
  return !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value) && value.endsWith(".skeleton");
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
