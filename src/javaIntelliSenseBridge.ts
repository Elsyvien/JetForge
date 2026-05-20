import {
  TxtJetTargetLanguage
} from "./detector";
import {
  buildGeneratedJavaPreview,
  mapPreviewRangeToSource,
  TxtJetBlock,
  TxtJetGeneratedPreview,
  TxtJetJavaPreviewOptions,
  TxtJetMapping,
  TxtJetRange,
  parseTxtJetTemplate
} from "./templateModel";

export interface TxtJetJavaBridgeProjection {
  preview: TxtJetGeneratedPreview;
  previewOffset: number;
  block: TxtJetBlock;
}

export interface TxtJetJavaCompletionContext {
  kind: "template-java" | "generated-java";
  block: TxtJetBlock;
}

const JAVA_BRIDGE_BLOCK_KINDS = new Set(["scriptlet", "expression", "declaration"]);
const JAVA_KEYWORD_COMPLETIONS = [
  "abstract",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "false",
  "final",
  "finally",
  "float",
  "for",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "new",
  "null",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "String",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "void",
  "while"
];
const JAVA_LIST_MEMBER_COMPLETIONS = ["add", "clear", "contains", "forEach", "get", "isEmpty", "iterator", "remove", "size", "stream"];
const JAVA_STRING_MEMBER_COMPLETIONS = ["charAt", "contains", "endsWith", "equals", "isEmpty", "length", "replace", "split", "startsWith", "substring", "toLowerCase", "toUpperCase", "trim"];
const JAVA_MATH_MEMBER_COMPLETIONS = ["abs", "ceil", "cos", "floor", "max", "min", "pow", "random", "round", "sin", "sqrt", "tan"];
const JAVA_OBJECT_MEMBER_COMPLETIONS = ["equals", "getClass", "hashCode", "toString"];

export function effectiveJavaCompletionTarget(
  selectedTargetLanguage: TxtJetTargetLanguage,
  detectedTargetLanguage: TxtJetTargetLanguage
): TxtJetTargetLanguage {
  return selectedTargetLanguage === "txtjet" && detectedTargetLanguage === "txtjet-java"
    ? "txtjet-java"
    : selectedTargetLanguage;
}

export function javaCompletionContextAt(
  text: string,
  sourceOffset: number,
  targetLanguage: TxtJetTargetLanguage
): TxtJetJavaCompletionContext | undefined {
  const model = parseTxtJetTemplate(text);
  const block = model.blocks.find((candidate) =>
    candidate.range.start <= sourceOffset && sourceOffset <= candidate.range.end
  );
  if (!block) {
    return undefined;
  }

  if (
    JAVA_BRIDGE_BLOCK_KINDS.has(block.kind)
    && block.contentRange.start <= sourceOffset
    && sourceOffset <= block.contentRange.end
  ) {
    return { kind: "template-java", block };
  }

  if (block.kind === "outer" && targetLanguage === "txtjet-java") {
    return { kind: "generated-java", block };
  }

  return undefined;
}

export function javaFallbackCompletionLabels(
  text: string,
  sourceOffset: number,
  targetLanguage: TxtJetTargetLanguage
): string[] {
  const context = javaCompletionContextAt(text, sourceOffset, targetLanguage);
  if (!context) {
    return [];
  }

  const receiver = javaCompletionReceiverAt(text, sourceOffset);
  return receiver ? javaMemberFallbackLabels(text, receiver) : javaBlockFallbackLabels(text);
}

export function projectSourceOffsetToJavaPreview(
  text: string,
  sourceName: string,
  sourceOffset: number,
  options: TxtJetJavaPreviewOptions = {}
): TxtJetJavaBridgeProjection | undefined {
  const model = parseTxtJetTemplate(text);
  const block = model.blocks.find((candidate) =>
    JAVA_BRIDGE_BLOCK_KINDS.has(candidate.kind)
    && candidate.contentRange.start <= sourceOffset
    && sourceOffset <= candidate.contentRange.end
  );
  if (!block) {
    return undefined;
  }

  const preview = buildGeneratedJavaPreview(text, sourceName, options);
  const mapping = mappingForBlock(preview.mappings, block);
  if (!mapping) {
    return undefined;
  }

  const previewOffset = sourceOffsetToPreviewOffset(block, mapping, preview.text, sourceOffset);
  return previewOffset === undefined ? undefined : { preview, previewOffset, block };
}

export function mapJavaPreviewRangeToSource(
  text: string,
  sourceName: string,
  previewRange: TxtJetRange,
  options: TxtJetJavaPreviewOptions = {}
): TxtJetRange | undefined {
  const model = parseTxtJetTemplate(text);
  const preview = buildGeneratedJavaPreview(text, sourceName, options);
  const mapped = preview.mappings
    .map((mapping) => ({
      mapping,
      block: model.blocks.find((candidate) => sameRange(candidate.range, mapping.source))
    }))
    .filter((entry): entry is { mapping: TxtJetMapping; block: TxtJetBlock } =>
      Boolean(entry.block && JAVA_BRIDGE_BLOCK_KINDS.has(entry.block.kind) && rangesIntersectOrTouch(entry.mapping.preview, previewRange))
    );

  if (mapped.length !== 1) {
    return mapPreviewRangeToSource(preview.mappings, previewRange);
  }

  const start = previewOffsetToSourceOffset(mapped[0].block, mapped[0].mapping, preview.text, previewRange.start);
  const end = previewOffsetToSourceOffset(mapped[0].block, mapped[0].mapping, preview.text, previewRange.end);
  if (start === undefined || end === undefined) {
    return mapPreviewRangeToSource(preview.mappings, previewRange);
  }
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function mappingForBlock(mappings: TxtJetMapping[], block: TxtJetBlock): TxtJetMapping | undefined {
  return mappings.find((mapping) => sameRange(mapping.source, block.range));
}

function sourceOffsetToPreviewOffset(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string,
  sourceOffset: number
): number | undefined {
  if (block.kind === "expression") {
    return sourceExpressionOffsetToPreviewOffset(block, mapping, previewText, sourceOffset);
  }
  return sourceJavaBlockOffsetToPreviewOffset(block, mapping, previewText, sourceOffset);
}

function previewOffsetToSourceOffset(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string,
  previewOffset: number
): number | undefined {
  if (block.kind === "expression") {
    return previewExpressionOffsetToSourceOffset(block, mapping, previewText, previewOffset);
  }
  return previewJavaBlockOffsetToSourceOffset(block, mapping, previewText, previewOffset);
}

function sourceExpressionOffsetToPreviewOffset(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string,
  sourceOffset: number
): number | undefined {
  const expression = trimExpression(block.content);
  if (expression === "\"\"") {
    return undefined;
  }

  const segment = previewText.slice(mapping.preview.start, mapping.preview.end);
  const expressionStart = segment.indexOf(expression);
  if (expressionStart === -1) {
    return undefined;
  }

  const contentOffset = sourceOffset - block.contentRange.start;
  const leading = leadingTrimLength(block.content);
  const expressionOffset = clamp(contentOffset - leading, 0, expression.length);
  return mapping.preview.start + expressionStart + expressionOffset;
}

function previewExpressionOffsetToSourceOffset(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string,
  previewOffset: number
): number | undefined {
  const expression = trimExpression(block.content);
  if (expression === "\"\"") {
    return undefined;
  }

  const segment = previewText.slice(mapping.preview.start, mapping.preview.end);
  const expressionStart = segment.indexOf(expression);
  if (expressionStart === -1) {
    return undefined;
  }

  const local = previewOffset - mapping.preview.start - expressionStart;
  if (local < 0 || local > expression.length) {
    return undefined;
  }
  return block.contentRange.start + leadingTrimLength(block.content) + local;
}

function sourceJavaBlockOffsetToPreviewOffset(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string,
  sourceOffset: number
): number | undefined {
  const layout = javaBlockLayout(block, mapping, previewText);
  if (!layout) {
    return undefined;
  }

  const trimmedOffset = clamp(sourceOffset - block.contentRange.start - layout.leading, 0, layout.trimmed.length);
  const position = offsetToLineCharacter(layout.trimmed, trimmedOffset);
  const lineStart = lineStartOffset(layout.sectionText, position.line);
  if (lineStart === undefined) {
    return undefined;
  }

  const lineText = lineAt(layout.trimmed, position.line);
  if (lineText === undefined) {
    return undefined;
  }
  const character = Math.min(position.character, lineText.length);
  return layout.previewBase + lineStart + layout.prefix.length + character;
}

function previewJavaBlockOffsetToSourceOffset(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string,
  previewOffset: number
): number | undefined {
  const layout = javaBlockLayout(block, mapping, previewText);
  if (!layout) {
    return undefined;
  }

  const local = previewOffset - layout.previewBase;
  if (local < 0 || local > layout.sectionText.length) {
    return undefined;
  }

  const position = offsetToLineCharacter(layout.sectionText, local);
  const lineText = lineAt(layout.trimmed, position.line);
  if (lineText === undefined) {
    return undefined;
  }

  const character = clamp(position.character - layout.prefix.length, 0, lineText.length);
  const trimmedOffset = lineStartOffset(layout.trimmed, position.line);
  if (trimmedOffset === undefined) {
    return undefined;
  }
  return block.contentRange.start + layout.leading + trimmedOffset + character;
}

function javaBlockLayout(
  block: TxtJetBlock,
  mapping: TxtJetMapping,
  previewText: string
): { trimmed: string; leading: number; sectionText: string; previewBase: number; prefix: string } | undefined {
  const trimmed = trimBlockContent(block.content);
  if (!trimmed) {
    return undefined;
  }

  const prefix = block.kind === "scriptlet" ? "        " : "";
  const sectionText = block.kind === "scriptlet"
    ? indentJavaLines(trimmed, prefix)
    : `\n${trimmed}\n`;
  const segment = previewText.slice(mapping.preview.start, mapping.preview.end);
  const sectionStart = segment.indexOf(sectionText);
  if (sectionStart === -1) {
    return undefined;
  }

  const declarationLineOffset = block.kind === "declaration" ? 1 : 0;
  return {
    trimmed,
    leading: leadingBlockTrimLength(block.content),
    sectionText: block.kind === "declaration" ? sectionText.slice(declarationLineOffset) : sectionText,
    previewBase: mapping.preview.start + sectionStart + declarationLineOffset,
    prefix
  };
}

function trimBlockContent(text: string): string {
  return text.replace(/^\s*\r?\n?/, "").replace(/\r?\n?\s*$/, "");
}

function trimExpression(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : "\"\"";
}

function leadingBlockTrimLength(text: string): number {
  const trimmed = text.replace(/^\s*\r?\n?/, "");
  return text.length - trimmed.length;
}

function leadingTrimLength(text: string): number {
  const trimmed = text.trimStart();
  return text.length - trimmed.length;
}

function indentJavaLines(text: string, prefix: string): string {
  return text.split(/\r?\n/).map((line) => `${prefix}${line.trimEnd()}`).join("\n") + "\n";
}

function offsetToLineCharacter(text: string, offset: number): { line: number; character: number } {
  const safeOffset = clamp(offset, 0, text.length);
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: safeOffset - lineStart };
}

function lineStartOffset(text: string, line: number): number | undefined {
  if (line === 0) {
    return 0;
  }

  let currentLine = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      currentLine += 1;
      if (currentLine === line) {
        return index + 1;
      }
    }
  }
  return undefined;
}

function lineAt(text: string, line: number): string | undefined {
  const start = lineStartOffset(text, line);
  if (start === undefined) {
    return undefined;
  }
  const end = text.indexOf("\n", start);
  return text.slice(start, end === -1 ? text.length : end);
}

function javaBlockFallbackLabels(text: string): string[] {
  const model = parseTxtJetTemplate(text);
  const names = new Set<string>();
  for (const name of JAVA_KEYWORD_COMPLETIONS) {
    names.add(name);
  }
  for (const importName of splitJavaImports(model.jetDirective?.attributes.imports)) {
    names.add(importName.split(".").pop() ?? importName);
  }
  if (model.jetDirective?.attributes.class) {
    names.add(model.jetDirective.attributes.class);
  }
  for (const block of model.blocks) {
    if (block.kind === "outer" || block.kind === "scriptlet" || block.kind === "declaration") {
      for (const name of javaIdentifiersFromBlock(block.content)) {
        names.add(name);
      }
    }
  }
  return Array.from(names).sort();
}

function javaMemberFallbackLabels(text: string, receiver: string): string[] {
  const type = javaReceiverType(text, receiver);
  return type === "list"
    ? JAVA_LIST_MEMBER_COMPLETIONS
    : type === "string"
      ? JAVA_STRING_MEMBER_COMPLETIONS
      : type === "math"
        ? JAVA_MATH_MEMBER_COMPLETIONS
        : JAVA_OBJECT_MEMBER_COMPLETIONS;
}

function javaCompletionReceiverAt(text: string, sourceOffset: number): string | undefined {
  const line = linePrefixAt(text, sourceOffset);
  const match = line.match(/([A-Za-z_$][\w$]*)\.\w*$/);
  return match?.[1];
}

function javaReceiverType(text: string, receiver: string): "list" | "string" | "math" | "object" {
  if (receiver === "Math" || receiver === "math") {
    return "math";
  }
  const escaped = escapeRegExp(receiver);
  if (new RegExp(`\\b(?:List|ArrayList|LinkedList|Collection|Iterable|Set)<[^>]+>\\s+${escaped}\\b`).test(text)) {
    return "list";
  }
  if (new RegExp(`\\bString\\s+${escaped}\\b`).test(text)) {
    return "string";
  }
  return "object";
}

function javaIdentifiersFromBlock(content: string): string[] {
  const identifiers = new Set<string>();
  const declarationPattern = /\b(?:final\s+)?(?:[A-Z][\w$]*(?:<[^;=(){}]+>)?|\w+)\s+([A-Za-z_$][\w$]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(content))) {
    identifiers.add(match[1]);
  }
  return Array.from(identifiers);
}

function splitJavaImports(value: string | undefined): string[] {
  return value ? value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean) : [];
}

function linePrefixAt(text: string, offset: number): string {
  const safeOffset = clamp(offset, 0, text.length);
  const lineStart = text.lastIndexOf("\n", safeOffset - 1) + 1;
  return text.slice(lineStart, safeOffset);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rangesIntersectOrTouch(left: TxtJetRange, right: TxtJetRange): boolean {
  if (right.start === right.end) {
    return left.start <= right.start && right.start <= left.end;
  }
  if (left.start === left.end) {
    return right.start <= left.start && left.start <= right.end;
  }
  return left.start < right.end && right.start < left.end;
}

function sameRange(left: TxtJetRange, right: TxtJetRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
