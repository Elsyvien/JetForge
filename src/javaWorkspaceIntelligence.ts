import { normalize } from "node:path";
import {
  activeParameterIndex,
  innermostOpenParen,
  maskJavaCommentsAndStrings,
  signatureParameterCount
} from "./javaSyntax";
import { parseTxtJetTemplate, TxtJetBlock, TxtJetRange } from "./templateModel";

export interface TxtJetJavaWorkspaceSource {
  fileName: string;
  text: string;
}

export interface TxtJetJavaWorkspaceMethod {
  name: string;
  signature: string;
  returnType: string;
  isStatic: boolean;
  visibility: "public" | "protected" | "private" | "package";
  fileName: string;
  range: TxtJetRange;
}

export interface TxtJetJavaWorkspaceClass {
  className: string;
  packageName: string;
  qualifiedName: string;
  imports: string[];
  fileName: string;
  range: TxtJetRange;
  methods: TxtJetJavaWorkspaceMethod[];
}

export interface TxtJetJavaWorkspaceIndex {
  classes: TxtJetJavaWorkspaceClass[];
  classForFile(fileName: string): TxtJetJavaWorkspaceClass | undefined;
  source(fileName: string): TxtJetJavaWorkspaceSource | undefined;
}

export interface TxtJetJavaWorkspaceDependency {
  sourceClass: TxtJetJavaWorkspaceClass;
  targetClass: TxtJetJavaWorkspaceClass;
}

export interface TxtJetJavaWorkspaceCompletion {
  kind: "class" | "method";
  label: string;
  insertText: string;
  detail: string;
  range: TxtJetRange;
  method?: TxtJetJavaWorkspaceMethod;
  targetClass: TxtJetJavaWorkspaceClass;
}

export interface TxtJetJavaWorkspaceDefinition {
  fileName: string;
  range: TxtJetRange;
}

export interface TxtJetJavaWorkspaceHover {
  title: string;
  signatures: string[];
  range: TxtJetRange;
}

export interface TxtJetJavaWorkspaceSignatureHelp {
  signatures: string[];
  activeParameter: number;
}

const JAVA_BLOCK_KINDS = new Set(["scriptlet", "expression", "declaration"]);
const JAVA_METHOD_MODIFIERS = [
  "public",
  "private",
  "protected",
  "static",
  "final",
  "synchronized",
  "abstract",
  "native",
  "strictfp",
  "default"
];
const JAVA_METHOD_PATTERN = new RegExp(
  String.raw`\b((?:(?:${JAVA_METHOD_MODIFIERS.join("|")})\s+)*(?:<[^>\n]+>\s*)?)` +
  String.raw`([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*(?:\s*<[^;{}()]*>)?(?:\s*\[\s*\])?|void)\s+` +
  String.raw`([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[A-Za-z_$][\w$.,\s]*)?\{`,
  "g"
);

export function createJavaWorkspaceIndex(sources: TxtJetJavaWorkspaceSource[]): TxtJetJavaWorkspaceIndex {
  const sourcesByFile = new Map<string, TxtJetJavaWorkspaceSource>();
  for (const source of sources) {
    sourcesByFile.set(normalize(source.fileName), { ...source, fileName: normalize(source.fileName) });
  }

  const classes = Array.from(sourcesByFile.values())
    .map(javaClassFromSource)
    .filter((entry): entry is TxtJetJavaWorkspaceClass => Boolean(entry))
    .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName) || left.fileName.localeCompare(right.fileName));
  const classesByFile = new Map(classes.map((entry) => [entry.fileName, entry]));

  return {
    classes,
    classForFile(fileName) {
      return classesByFile.get(normalize(fileName));
    },
    source(fileName) {
      return sourcesByFile.get(normalize(fileName));
    }
  };
}

export function workspaceJavaCompletionsAt(
  index: TxtJetJavaWorkspaceIndex,
  fileName: string,
  text: string,
  sourceOffset: number
): TxtJetJavaWorkspaceCompletion[] {
  const block = javaBlockAt(text, sourceOffset);
  if (!block) {
    return [];
  }

  const member = memberAccessAt(block, sourceOffset);
  const sourceClass = index.classForFile(fileName);
  if (member) {
    const targetClass = resolveExpressionClass(index, sourceClass, text, member.receiver);
    if (!targetClass) {
      return [];
    }
    const staticOnly = isClassExpression(index, sourceClass, member.receiver, targetClass);
    return accessibleMethods(targetClass, sourceClass, staticOnly)
      .filter((method) => method.name.startsWith(member.prefix))
      .map((method) => ({
        kind: "method",
        label: method.name,
        insertText: method.name,
        detail: `${method.signature} — ${targetClass.qualifiedName}`,
        range: member.range,
        method,
        targetClass
      }));
  }

  const identifier = identifierPrefixAt(block, sourceOffset);
  return index.classes
    .filter((targetClass) => targetClass.fileName !== normalize(fileName))
    .filter((targetClass) => targetClass.className.startsWith(identifier.prefix))
    .map((targetClass) => ({
      kind: "class",
      label: targetClass.className,
      insertText: classInsertText(targetClass, sourceClass),
      detail: `TxtJet workspace class — ${targetClass.qualifiedName}`,
      range: identifier.range,
      targetClass
    }));
}

export function workspaceJavaDefinitionsAt(
  index: TxtJetJavaWorkspaceIndex,
  fileName: string,
  text: string,
  sourceOffset: number
): TxtJetJavaWorkspaceDefinition[] {
  const block = javaBlockAt(text, sourceOffset);
  if (!block) {
    return [];
  }
  const identifier = identifierAt(block, sourceOffset);
  if (!identifier) {
    return [];
  }
  const sourceClass = index.classForFile(fileName);
  const receiver = receiverBeforeIdentifier(block, identifier.range.start);
  if (receiver) {
    const targetClass = resolveExpressionClass(index, sourceClass, text, receiver);
    if (!targetClass) {
      return [];
    }
    const staticOnly = isClassExpression(index, sourceClass, receiver, targetClass);
    return accessibleMethods(targetClass, sourceClass, staticOnly)
      .filter((method) => method.name === identifier.name)
      .map((method) => ({ fileName: method.fileName, range: method.range }));
  }

  const targetClass = resolveType(index, sourceClass, identifier.name);
  return targetClass && targetClass.fileName !== normalize(fileName)
    ? [{ fileName: targetClass.fileName, range: targetClass.range }]
    : [];
}

export function workspaceJavaHoverAt(
  index: TxtJetJavaWorkspaceIndex,
  fileName: string,
  text: string,
  sourceOffset: number
): TxtJetJavaWorkspaceHover | undefined {
  const block = javaBlockAt(text, sourceOffset);
  if (!block) {
    return undefined;
  }
  const identifier = identifierAt(block, sourceOffset);
  if (!identifier) {
    return undefined;
  }
  const sourceClass = index.classForFile(fileName);
  const receiver = receiverBeforeIdentifier(block, identifier.range.start);
  if (receiver) {
    const targetClass = resolveExpressionClass(index, sourceClass, text, receiver);
    if (!targetClass) {
      return undefined;
    }
    const staticOnly = isClassExpression(index, sourceClass, receiver, targetClass);
    const methods = accessibleMethods(targetClass, sourceClass, staticOnly)
      .filter((method) => method.name === identifier.name);
    return methods.length > 0 ? {
      title: `TxtJet workspace method in ${targetClass.qualifiedName}`,
      signatures: methods.map((method) => method.signature),
      range: identifier.range
    } : undefined;
  }

  const targetClass = resolveType(index, sourceClass, identifier.name);
  return targetClass && targetClass.fileName !== normalize(fileName) ? {
    title: "TxtJet workspace class",
    signatures: [`${targetClass.qualifiedName} — ${targetClass.methods.length} indexed method${targetClass.methods.length === 1 ? "" : "s"}`],
    range: identifier.range
  } : undefined;
}

export function workspaceJavaSignatureHelpAt(
  index: TxtJetJavaWorkspaceIndex,
  fileName: string,
  text: string,
  sourceOffset: number
): TxtJetJavaWorkspaceSignatureHelp | undefined {
  const block = javaBlockAt(text, sourceOffset);
  if (!block) {
    return undefined;
  }
  const invocation = memberInvocationAt(block, sourceOffset);
  if (!invocation) {
    return undefined;
  }
  const sourceClass = index.classForFile(fileName);
  const targetClass = resolveExpressionClass(index, sourceClass, text, invocation.receiver);
  if (!targetClass) {
    return undefined;
  }
  const staticOnly = isClassExpression(index, sourceClass, invocation.receiver, targetClass);
  const methods = accessibleMethods(targetClass, sourceClass, staticOnly)
    .filter((method) => method.name === invocation.name);
  if (methods.length === 0) {
    return undefined;
  }
  const maxParameters = Math.max(0, ...methods.map((method) => signatureParameterCount(method.signature)));
  return {
    signatures: methods.map((method) => method.signature),
    activeParameter: maxParameters === 0 ? 0 : Math.min(invocation.activeParameter, maxParameters - 1)
  };
}

export function referencedWorkspaceJavaClasses(
  index: TxtJetJavaWorkspaceIndex,
  fileName: string,
  text: string
): TxtJetJavaWorkspaceClass[] {
  const sourceClass = index.classForFile(fileName);
  if (!sourceClass) {
    return [];
  }
  const references = new Map<string, TxtJetJavaWorkspaceClass>();
  for (const block of parseTxtJetTemplate(text).blocks) {
    if (!JAVA_BLOCK_KINDS.has(block.kind)) {
      continue;
    }
    const masked = maskJavaCommentsAndStrings(block.content);
    const identifiers = masked.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? [];
    for (const identifier of identifiers) {
      const targetClass = resolveType(index, sourceClass, identifier);
      if (targetClass && targetClass.fileName !== sourceClass.fileName) {
        references.set(targetClass.fileName, targetClass);
      }
    }
  }
  return Array.from(references.values()).sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName));
}

/**
 * Builds the real, transitive class dependency graph starting at a TxtJet
 * template. Each edge points from the class containing the Java reference to
 * the referenced workspace @jet class.
 */
export function workspaceJavaClassDependencies(
  index: TxtJetJavaWorkspaceIndex,
  fileName: string,
  text?: string
): TxtJetJavaWorkspaceDependency[] {
  const root = index.classForFile(fileName);
  if (!root) {
    return [];
  }
  const dependencies: TxtJetJavaWorkspaceDependency[] = [];
  const visited = new Set<string>();
  const queue: Array<{ sourceClass: TxtJetJavaWorkspaceClass; text?: string }> = [{ sourceClass: root, text }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.sourceClass.fileName)) {
      continue;
    }
    visited.add(current.sourceClass.fileName);
    const sourceText = current.text ?? index.source(current.sourceClass.fileName)?.text;
    if (sourceText === undefined) {
      continue;
    }
    for (const targetClass of referencedWorkspaceJavaClasses(index, current.sourceClass.fileName, sourceText)) {
      dependencies.push({ sourceClass: current.sourceClass, targetClass });
      if (!visited.has(targetClass.fileName)) {
        queue.push({ sourceClass: targetClass });
      }
    }
  }

  return dependencies.sort((left, right) =>
    left.sourceClass.qualifiedName.localeCompare(right.sourceClass.qualifiedName)
    || left.targetClass.qualifiedName.localeCompare(right.targetClass.qualifiedName)
  );
}

function javaClassFromSource(source: TxtJetJavaWorkspaceSource): TxtJetJavaWorkspaceClass | undefined {
  const model = parseTxtJetTemplate(source.text);
  const directive = model.jetDirective;
  const className = directive?.attributes.class;
  if (!directive || !className) {
    return undefined;
  }
  const packageName = directive.attributes.package ?? "txtjet.generated";
  const range = attributeValueRange(source.text, directive.attributeRanges.class ?? directive.nameRange, className);
  const methods = model.blocks
    .filter((block) => block.kind === "declaration")
    .flatMap((block) => methodsFromBlock(source.fileName, block));
  return {
    className,
    packageName,
    qualifiedName: packageName ? `${packageName}.${className}` : className,
    imports: (directive.attributes.imports ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    fileName: normalize(source.fileName),
    range,
    methods
  };
}

function methodsFromBlock(fileName: string, block: TxtJetBlock): TxtJetJavaWorkspaceMethod[] {
  const methods: TxtJetJavaWorkspaceMethod[] = [];
  const masked = maskJavaCommentsAndStrings(block.content);
  JAVA_METHOD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JAVA_METHOD_PATTERN.exec(masked))) {
    const modifiers = match[1].trim().split(/\s+/).filter(Boolean);
    const returnType = match[2].replace(/\s+/g, "");
    const name = match[3];
    const nameOffset = match[0].lastIndexOf(name);
    const openBrace = match[0].lastIndexOf("{");
    if (nameOffset === -1 || openBrace === -1) {
      continue;
    }
    const start = block.contentRange.start + match.index + nameOffset;
    methods.push({
      name,
      signature: block.content.slice(match.index, match.index + openBrace).replace(/\s+/g, " ").trim(),
      returnType,
      isStatic: modifiers.includes("static"),
      visibility: modifiers.includes("public")
        ? "public"
        : modifiers.includes("protected")
          ? "protected"
          : modifiers.includes("private") ? "private" : "package",
      fileName: normalize(fileName),
      range: { start, end: start + name.length }
    });
  }
  return methods;
}

function javaBlockAt(text: string, sourceOffset: number): TxtJetBlock | undefined {
  return parseTxtJetTemplate(text).blocks.find((block) =>
    JAVA_BLOCK_KINDS.has(block.kind)
    && block.contentRange.start <= sourceOffset
    && sourceOffset <= block.contentRange.end
  );
}

function memberAccessAt(block: TxtJetBlock, sourceOffset: number): { receiver: string; prefix: string; range: TxtJetRange } | undefined {
  const masked = maskJavaCommentsAndStrings(block.content);
  const localOffset = clamp(sourceOffset - block.contentRange.start, 0, masked.length);
  const before = masked.slice(0, localOffset);
  const match = before.match(/((?:new\s+)?[A-Za-z_$][\w$]*(?:\s*\([^;{}]*\))?(?:\s*\.\s*[A-Za-z_$][\w$]*(?:\s*\([^;{}]*\))?)*)\s*\.\s*([A-Za-z_$][\w$]*)?$/);
  if (!match) {
    return undefined;
  }
  const prefix = match[2] ?? "";
  return {
    receiver: match[1].replace(/\s+/g, " ").trim(),
    prefix,
    range: { start: sourceOffset - prefix.length, end: sourceOffset }
  };
}

function memberInvocationAt(
  block: TxtJetBlock,
  sourceOffset: number
): { receiver: string; name: string; activeParameter: number } | undefined {
  const masked = maskJavaCommentsAndStrings(block.content);
  const localOffset = clamp(sourceOffset - block.contentRange.start, 0, masked.length);
  const open = innermostOpenParen(masked, localOffset);
  if (open === undefined) {
    return undefined;
  }
  const beforeOpen = masked.slice(0, open);
  const methodMatch = beforeOpen.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (!methodMatch) {
    return undefined;
  }
  const methodStart = beforeOpen.length - methodMatch[0].length;
  const receiver = receiverBeforeLocalOffset(masked, methodStart);
  if (!receiver) {
    return undefined;
  }
  return {
    receiver,
    name: methodMatch[1],
    activeParameter: activeParameterIndex(masked.slice(open + 1, localOffset))
  };
}

function receiverBeforeIdentifier(block: TxtJetBlock, absoluteIdentifierStart: number): string | undefined {
  const masked = maskJavaCommentsAndStrings(block.content);
  return receiverBeforeLocalOffset(masked, absoluteIdentifierStart - block.contentRange.start);
}

function receiverBeforeLocalOffset(masked: string, localIdentifierStart: number): string | undefined {
  const before = masked.slice(0, localIdentifierStart);
  const match = before.match(/((?:new\s+)?[A-Za-z_$][\w$]*(?:\s*\([^;{}]*\))?(?:\s*\.\s*[A-Za-z_$][\w$]*(?:\s*\([^;{}]*\))?)*)\s*\.\s*$/);
  return match?.[1].replace(/\s+/g, " ").trim();
}

function identifierPrefixAt(block: TxtJetBlock, sourceOffset: number): { prefix: string; range: TxtJetRange } {
  const masked = maskJavaCommentsAndStrings(block.content);
  const localOffset = clamp(sourceOffset - block.contentRange.start, 0, masked.length);
  let start = localOffset;
  while (start > 0 && isIdentifierPart(masked[start - 1])) {
    start -= 1;
  }
  return {
    prefix: masked.slice(start, localOffset),
    range: { start: block.contentRange.start + start, end: sourceOffset }
  };
}

function identifierAt(block: TxtJetBlock, sourceOffset: number): { name: string; range: TxtJetRange } | undefined {
  const masked = maskJavaCommentsAndStrings(block.content);
  const localOffset = clamp(sourceOffset - block.contentRange.start, 0, masked.length);
  const index = localOffset > 0 && !isIdentifierPart(masked[localOffset]) && isIdentifierPart(masked[localOffset - 1])
    ? localOffset - 1
    : localOffset;
  if (!isIdentifierPart(masked[index])) {
    return undefined;
  }
  let start = index;
  while (start > 0 && isIdentifierPart(masked[start - 1])) {
    start -= 1;
  }
  let end = index + 1;
  while (end < masked.length && isIdentifierPart(masked[end])) {
    end += 1;
  }
  return {
    name: masked.slice(start, end),
    range: { start: block.contentRange.start + start, end: block.contentRange.start + end }
  };
}

function resolveExpressionClass(
  index: TxtJetJavaWorkspaceIndex,
  sourceClass: TxtJetJavaWorkspaceClass | undefined,
  sourceText: string,
  expression: string
): TxtJetJavaWorkspaceClass | undefined {
  const compact = expression.replace(/\s+/g, "").replace(/^this\./, "");
  const newType = compact.match(/^new([A-Za-z_$][\w$.]*)\s*\(/)?.[1];
  if (newType) {
    return resolveType(index, sourceClass, newType);
  }
  const directType = resolveType(index, sourceClass, compact);
  if (directType) {
    return directType;
  }

  const chain = splitMemberChain(compact);
  if (chain.length === 0) {
    return undefined;
  }
  const first = chain.shift();
  if (!first) {
    return undefined;
  }
  let current = resolveType(index, sourceClass, first)
    ?? variableType(index, sourceClass, sourceText, first);
  for (const part of chain) {
    if (!current) {
      return undefined;
    }
    const methodName = part.match(/^([A-Za-z_$][\w$]*)\(/)?.[1];
    if (!methodName) {
      current = variableType(index, sourceClass, sourceText, part);
      continue;
    }
    const method = current.methods.find((candidate) => candidate.name === methodName);
    current = method ? resolveType(index, current, method.returnType) : undefined;
  }
  return current;
}

function splitMemberChain(expression: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "." && depth === 0) {
      parts.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts.filter(Boolean);
}

function variableType(
  index: TxtJetJavaWorkspaceIndex,
  sourceClass: TxtJetJavaWorkspaceClass | undefined,
  sourceText: string,
  variableName: string
): TxtJetJavaWorkspaceClass | undefined {
  const java = parseTxtJetTemplate(sourceText).blocks
    .filter((block) => JAVA_BLOCK_KINDS.has(block.kind))
    .map((block) => maskJavaCommentsAndStrings(block.content))
    .join("\n");
  const escapedVariable = escapeRegExp(variableName);
  for (const targetClass of index.classes) {
    for (const alias of classAliases(index, targetClass, sourceClass)) {
      const escapedAlias = escapeRegExp(alias);
      const typed = new RegExp(`\\b${escapedAlias}(?:\\s*<[^;={}()]*>)?(?:\\s*\\[\\s*\\])?\\s+${escapedVariable}\\b`);
      const inferred = new RegExp(`\\b(?:var|Object)\\s+${escapedVariable}\\s*=\\s*new\\s+${escapedAlias}\\s*\\(`);
      if (typed.test(java) || inferred.test(java)) {
        return targetClass;
      }
    }
  }
  return undefined;
}

function resolveType(
  index: TxtJetJavaWorkspaceIndex,
  sourceClass: TxtJetJavaWorkspaceClass | undefined,
  typeName: string
): TxtJetJavaWorkspaceClass | undefined {
  const clean = eraseJavaType(typeName);
  if (!clean) {
    return undefined;
  }
  const exact = index.classes.find((candidate) => candidate.qualifiedName === clean);
  if (exact) {
    return exact;
  }
  const simple = clean.split(".").pop() ?? clean;
  if (sourceClass) {
    if (sourceClass.className === simple) {
      return sourceClass;
    }
    const explicitImport = sourceClass.imports.find((entry) => entry.endsWith(`.${simple}`));
    if (explicitImport) {
      const imported = index.classes.find((candidate) => candidate.qualifiedName === explicitImport);
      if (imported) {
        return imported;
      }
    }
    const samePackage = index.classes.find((candidate) =>
      candidate.packageName === sourceClass.packageName && candidate.className === simple
    );
    if (samePackage) {
      return samePackage;
    }
    for (const importedPackage of sourceClass.imports.filter((entry) => entry.endsWith(".*"))) {
      const imported = index.classes.find((candidate) =>
        candidate.packageName === importedPackage.slice(0, -2) && candidate.className === simple
      );
      if (imported) {
        return imported;
      }
    }
  }
  const matches = index.classes.filter((candidate) => candidate.className === simple);
  return matches.length === 1 ? matches[0] : undefined;
}

function isClassExpression(
  index: TxtJetJavaWorkspaceIndex,
  sourceClass: TxtJetJavaWorkspaceClass | undefined,
  expression: string,
  targetClass: TxtJetJavaWorkspaceClass
): boolean {
  const compact = expression.replace(/\s+/g, "");
  return !compact.startsWith("new") && resolveType(index, sourceClass, compact)?.fileName === targetClass.fileName;
}

function accessibleMethods(
  targetClass: TxtJetJavaWorkspaceClass,
  sourceClass: TxtJetJavaWorkspaceClass | undefined,
  staticOnly: boolean
): TxtJetJavaWorkspaceMethod[] {
  return targetClass.methods.filter((method) => {
    if (staticOnly && !method.isStatic) {
      return false;
    }
    if (sourceClass?.fileName === targetClass.fileName) {
      return true;
    }
    if (method.visibility === "private") {
      return false;
    }
    return (method.visibility !== "package" && method.visibility !== "protected")
      || sourceClass?.packageName === targetClass.packageName;
  });
}

function classAliases(
  index: TxtJetJavaWorkspaceIndex,
  targetClass: TxtJetJavaWorkspaceClass,
  sourceClass: TxtJetJavaWorkspaceClass | undefined
): string[] {
  const aliases = [targetClass.qualifiedName];
  if (resolveType(index, sourceClass, targetClass.className)?.fileName === targetClass.fileName) {
    aliases.push(targetClass.className);
  }
  return aliases;
}

function classInsertText(targetClass: TxtJetJavaWorkspaceClass, sourceClass: TxtJetJavaWorkspaceClass | undefined): string {
  if (!sourceClass || targetClass.packageName === sourceClass.packageName) {
    return targetClass.className;
  }
  if (sourceClass.imports.includes(targetClass.qualifiedName) || sourceClass.imports.includes(`${targetClass.packageName}.*`)) {
    return targetClass.className;
  }
  return targetClass.qualifiedName;
}

function eraseJavaType(typeName: string): string {
  return typeName
    .replace(/<.*>/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/^\?extends|^\?super/, "")
    .replace(/\s+/g, "")
    .trim();
}

function attributeValueRange(text: string, attributeRange: TxtJetRange, value: string): TxtJetRange {
  const attribute = text.slice(attributeRange.start, attributeRange.end);
  const offset = attribute.indexOf(value);
  return offset === -1
    ? attributeRange
    : { start: attributeRange.start + offset, end: attributeRange.start + offset + value.length };
}

function isIdentifierPart(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_$]/.test(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
