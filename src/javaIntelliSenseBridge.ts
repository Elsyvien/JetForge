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
  kind: "template-java" | "generated-java" | "generated-python" | "generated-c";
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
const PYTHON_KEYWORD_COMPLETIONS = [
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "not",
  "or",
  "pass",
  "print",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield"
];
const PYTHON_BUILTIN_COMPLETIONS = ["dict", "enumerate", "float", "int", "isinstance", "len", "list", "range", "set", "str", "tuple", "zip"];
const PYTHON_LIST_MEMBER_COMPLETIONS = ["append", "clear", "copy", "count", "extend", "index", "insert", "pop", "remove", "reverse", "sort"];
const PYTHON_DICT_MEMBER_COMPLETIONS = ["clear", "copy", "get", "items", "keys", "pop", "setdefault", "update", "values"];
const PYTHON_STRING_MEMBER_COMPLETIONS = ["endswith", "format", "join", "lower", "replace", "split", "startswith", "strip", "upper"];
const PYTHON_MATH_MEMBER_COMPLETIONS = ["ceil", "cos", "floor", "pi", "pow", "sin", "sqrt", "tan"];
const PYTHON_OBJECT_MEMBER_COMPLETIONS = ["__class__", "__dict__", "__str__"];
const CPP_KEYWORD_COMPLETIONS = [
  "auto",
  "bool",
  "break",
  "case",
  "char",
  "class",
  "const",
  "constexpr",
  "continue",
  "double",
  "else",
  "enum",
  "false",
  "float",
  "for",
  "if",
  "include",
  "int",
  "long",
  "namespace",
  "new",
  "nullptr",
  "private",
  "protected",
  "public",
  "return",
  "size_t",
  "static",
  "std",
  "string",
  "struct",
  "switch",
  "template",
  "true",
  "typedef",
  "using",
  "void",
  "while"
];
const CPP_STD_MEMBER_COMPLETIONS = ["cerr", "cin", "cout", "endl", "make_unique", "map", "move", "string", "unique_ptr", "unordered_map", "vector"];
const CPP_VECTOR_MEMBER_COMPLETIONS = ["at", "back", "begin", "clear", "empty", "end", "front", "pop_back", "push_back", "size"];
const CPP_STRING_MEMBER_COMPLETIONS = ["append", "c_str", "empty", "find", "length", "replace", "size", "substr"];
const CPP_OBJECT_MEMBER_COMPLETIONS = ["empty", "size"];

export function effectiveCompletionTarget(
  selectedTargetLanguage: TxtJetTargetLanguage,
  detectedTargetLanguage: TxtJetTargetLanguage
): TxtJetTargetLanguage {
  return selectedTargetLanguage === "txtjet" && detectedTargetLanguage !== "txtjet"
    ? detectedTargetLanguage
    : selectedTargetLanguage;
}

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
  if (block.kind === "outer" && targetLanguage === "txtjet-python") {
    return { kind: "generated-python", block };
  }
  if (block.kind === "outer" && targetLanguage === "txtjet-c") {
    return { kind: "generated-c", block };
  }

  return undefined;
}

export function targetFallbackCompletionLabels(
  text: string,
  sourceOffset: number,
  targetLanguage: TxtJetTargetLanguage
): string[] {
  const context = javaCompletionContextAt(text, sourceOffset, targetLanguage);
  if (!context) {
    return [];
  }

  const receiver = javaCompletionReceiverAt(text, sourceOffset);
  switch (context.kind) {
    case "generated-python":
      return receiver ? pythonMemberFallbackLabels(text, receiver) : pythonBlockFallbackLabels(text);
    case "generated-c":
      return receiver ? cppMemberFallbackLabels(text, receiver) : cppBlockFallbackLabels(text);
    case "template-java":
    case "generated-java":
    default:
      return receiver ? javaMemberFallbackLabels(text, receiver) : javaBlockFallbackLabels(text);
  }
}

export function javaFallbackCompletionLabels(
  text: string,
  sourceOffset: number,
  targetLanguage: TxtJetTargetLanguage
): string[] {
  const context = javaCompletionContextAt(text, sourceOffset, targetLanguage);
  if (!context || (context.kind !== "template-java" && context.kind !== "generated-java")) {
    return [];
  }
  return targetFallbackCompletionLabels(text, sourceOffset, targetLanguage);
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
  const match = line.match(/([A-Za-z_$][\w$]*)\s*(?:\.|->|::)\s*\w*$/);
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

function pythonBlockFallbackLabels(text: string): string[] {
  const model = parseTxtJetTemplate(text);
  const names = new Set<string>([...PYTHON_KEYWORD_COMPLETIONS, ...PYTHON_BUILTIN_COMPLETIONS]);
  for (const block of model.blocks) {
    if (block.kind === "outer") {
      for (const name of pythonIdentifiersFromBlock(block.content)) {
        names.add(name);
      }
    }
  }
  return Array.from(names).sort();
}

function pythonMemberFallbackLabels(text: string, receiver: string): string[] {
  const type = pythonReceiverType(text, receiver);
  return type === "list"
    ? PYTHON_LIST_MEMBER_COMPLETIONS
    : type === "dict"
      ? PYTHON_DICT_MEMBER_COMPLETIONS
      : type === "string"
        ? PYTHON_STRING_MEMBER_COMPLETIONS
        : type === "math"
          ? PYTHON_MATH_MEMBER_COMPLETIONS
          : PYTHON_OBJECT_MEMBER_COMPLETIONS;
}

function pythonReceiverType(text: string, receiver: string): "list" | "dict" | "string" | "math" | "object" {
  if (receiver === "math") {
    return "math";
  }
  const escaped = escapeRegExp(receiver);
  if (new RegExp(`\\b${escaped}\\s*=\\s*(?:\\[|list\\()`).test(text)) {
    return "list";
  }
  if (new RegExp(`\\b${escaped}\\s*=\\s*(?:\\{|dict\\()`).test(text)) {
    return "dict";
  }
  if (new RegExp(`\\b${escaped}\\s*=\\s*(?:"|'|str\\()`).test(text)) {
    return "string";
  }
  return "object";
}

function pythonIdentifiersFromBlock(content: string): string[] {
  const identifiers = new Set<string>();
  const patterns = [
    /\b(?:class|def)\s+([A-Za-z_]\w*)/g,
    /\b([A-Za-z_]\w*)\s*=/g,
    /\b(?:for|with)\s+([A-Za-z_]\w*)\b/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      identifiers.add(match[1]);
    }
  }
  return Array.from(identifiers);
}

function cppBlockFallbackLabels(text: string): string[] {
  const model = parseTxtJetTemplate(text);
  const names = new Set<string>(CPP_KEYWORD_COMPLETIONS);
  for (const block of model.blocks) {
    if (block.kind === "outer") {
      for (const name of cppIdentifiersFromBlock(block.content)) {
        names.add(name);
      }
    }
  }
  return Array.from(names).sort();
}

function cppMemberFallbackLabels(text: string, receiver: string): string[] {
  const type = cppReceiverType(text, receiver);
  return type === "std"
    ? CPP_STD_MEMBER_COMPLETIONS
    : type === "vector"
      ? CPP_VECTOR_MEMBER_COMPLETIONS
      : type === "string"
        ? CPP_STRING_MEMBER_COMPLETIONS
        : CPP_OBJECT_MEMBER_COMPLETIONS;
}

function cppReceiverType(text: string, receiver: string): "std" | "vector" | "string" | "object" {
  if (receiver === "std") {
    return "std";
  }
  const escaped = escapeRegExp(receiver);
  if (new RegExp(`\\b(?:std::)?vector\\s*<[^>]+>\\s+${escaped}\\b`).test(text)) {
    return "vector";
  }
  if (new RegExp(`\\b(?:std::)?string\\s+${escaped}\\b`).test(text)) {
    return "string";
  }
  return "object";
}

function cppIdentifiersFromBlock(content: string): string[] {
  const identifiers = new Set<string>();
  const declarationPattern = /\b(?:class|struct|enum)\s+([A-Za-z_]\w*)|\b(?:std::)?[A-Za-z_]\w*(?:\s*<[^;=(){}]+>)?\s+([A-Za-z_]\w*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(content))) {
    identifiers.add(match[1] ?? match[2]);
  }
  return Array.from(identifiers).filter(Boolean);
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
