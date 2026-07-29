import { TxtJetRange } from "./templateModel";

export interface TxtJetIpxactSchemaDocument {
  fileName: string;
  text: string;
}

export interface TxtJetIpxactSchemaLocation {
  fileName: string;
  range: TxtJetRange;
}

export interface TxtJetIpxactSchemaAttribute {
  name: string;
  type?: string;
  required: boolean;
  documentation?: string;
  location: TxtJetIpxactSchemaLocation;
}

export interface TxtJetIpxactSchemaElement {
  name: string;
  type?: string;
  documentation?: string;
  children: string[];
  attributes: TxtJetIpxactSchemaAttribute[];
  location: TxtJetIpxactSchemaLocation;
}

export interface TxtJetIpxactSchemaIndex {
  documents: string[];
  globalElements: string[];
  elements: TxtJetIpxactSchemaElement[];
}

export interface TxtJetIpxactXmlContext {
  kind: "element" | "attribute";
  parentElement?: string;
  element?: string;
  namespacePrefix?: string;
  prefix: string;
  range: TxtJetRange;
}

export interface TxtJetIpxactXmlName {
  kind: "element" | "attribute";
  name: string;
  element?: string;
  range: TxtJetRange;
}

export type TxtJetIpxactStructureKind =
  | "component"
  | "busInterface"
  | "memoryMap"
  | "addressBlock"
  | "register"
  | "field";

export interface TxtJetIpxactStructure {
  kind: TxtJetIpxactStructureKind;
  name?: string;
  range: TxtJetRange;
  selectionRange: TxtJetRange;
  children: TxtJetIpxactStructure[];
}

interface XmlAttribute {
  name: string;
  value: string;
  range: TxtJetRange;
}

interface XmlNode {
  name: string;
  localName: string;
  attributes: XmlAttribute[];
  range: TxtJetRange;
  startTagEnd: number;
  endTagStart: number;
  parent?: XmlNode;
  children: XmlNode[];
  sourceText: string;
}

export function buildIpxactSchemaIndex(
  documents: TxtJetIpxactSchemaDocument[]
): TxtJetIpxactSchemaIndex {
  const roots = documents.flatMap((document) =>
    scanXmlNodes(document.text).map((node) => ({ document, node }))
  );
  const complexTypes = new Map<string, { document: TxtJetIpxactSchemaDocument; node: XmlNode }>();
  for (const entry of roots) {
    walkNodes(entry.node, (node) => {
      if (node.localName !== "complexType") {
        return;
      }
      const name = attributeValue(node, "name");
      if (name && !complexTypes.has(name)) {
        complexTypes.set(name, { document: entry.document, node });
      }
    });
  }

  const elements: TxtJetIpxactSchemaElement[] = [];
  const globalElements = new Set<string>();
  for (const entry of roots) {
    walkNodes(entry.node, (node) => {
      if (node.localName !== "element") {
        return;
      }
      const name = schemaElementName(node);
      if (!name) {
        return;
      }
      const isGlobal = node.parent?.localName === "schema";
      if (isGlobal) {
        globalElements.add(name);
      }
      const type = localQName(attributeValue(node, "type"));
      const inlineContent = inlineSchemaContent(node);
      const namedContent = type ? complexTypes.get(type) : undefined;
      const content = inlineContent
        ? { document: entry.document, node: inlineContent }
        : namedContent;
      elements.push({
        name,
        type,
        documentation: schemaDocumentation(node),
        children: content ? schemaChildElementNames(content.node) : [],
        attributes: content
          ? schemaAttributes(content.node, content.document.fileName)
          : [],
        location: schemaNodeLocation(entry.document.fileName, node, "name", "ref")
      });
    });
  }

  return {
    documents: documents.map((document) => document.fileName),
    globalElements: [...globalElements].sort(),
    elements
  };
}

export function schemaElementsNamed(
  index: TxtJetIpxactSchemaIndex,
  name: string
): TxtJetIpxactSchemaElement[] {
  const local = localQName(name);
  return index.elements.filter((element) => element.name === local);
}

export function schemaChildrenFor(
  index: TxtJetIpxactSchemaIndex,
  parentElement: string | undefined
): TxtJetIpxactSchemaElement[] {
  if (!parentElement) {
    return index.globalElements.flatMap((name) => schemaElementsNamed(index, name).slice(0, 1));
  }
  const parent = schemaElementsNamed(index, parentElement)[0];
  if (!parent) {
    return [];
  }
  return uniqueStrings(parent.children)
    .flatMap((name) => schemaElementsNamed(index, name).slice(0, 1));
}

export function schemaAttributesFor(
  index: TxtJetIpxactSchemaIndex,
  elementName: string | undefined
): TxtJetIpxactSchemaAttribute[] {
  if (!elementName) {
    return [];
  }
  return schemaElementsNamed(index, elementName)[0]?.attributes ?? [];
}

export function ipxactXmlContextAt(
  text: string,
  offset: number
): TxtJetIpxactXmlContext | undefined {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const masked = maskTxtJetBlocks(text);
  const tagStart = masked.lastIndexOf("<", safeOffset);
  const tagEnd = masked.lastIndexOf(">", safeOffset);
  if (tagStart <= tagEnd || /^<\s*[!?/]/.test(masked.slice(tagStart, safeOffset))) {
    return undefined;
  }

  const fragment = masked.slice(tagStart + 1, safeOffset);
  const elementMatch = fragment.match(/^\s*([A-Za-z_][\w.:-]*)?/);
  const elementQName = elementMatch?.[1];
  const elementName = localQName(elementQName);
  const elementTokenEnd = elementMatch?.[0].length ?? 0;
  const afterElement = fragment.slice(elementTokenEnd);
  const parentStack = openElementStack(masked.slice(0, tagStart));
  const parentQName = last(parentStack);
  if (elementName && /\s/.test(afterElement)) {
    const attributeMatch = fragment.match(/([A-Za-z_][\w.:-]*)?$/);
    const prefix = attributeMatch?.[1] ?? "";
    return {
      kind: "attribute",
      element: elementName,
      parentElement: localQName(parentQName),
      namespacePrefix: qNamePrefix(elementQName) ?? qNamePrefix(parentQName),
      prefix: localQName(prefix) ?? "",
      range: { start: safeOffset - prefix.length, end: safeOffset }
    };
  }

  const prefix = elementMatch?.[1] ?? "";
  return {
    kind: "element",
    parentElement: localQName(parentQName),
    namespacePrefix: qNamePrefix(elementQName) ?? qNamePrefix(parentQName),
    prefix: localQName(prefix) ?? "",
    range: { start: tagStart, end: safeOffset }
  };
}

export function ipxactXmlNameAt(
  text: string,
  offset: number
): TxtJetIpxactXmlName | undefined {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let start = safeOffset;
  let end = safeOffset;
  while (start > 0 && /[A-Za-z0-9_.:-]/.test(text[start - 1])) {
    start -= 1;
  }
  while (end < text.length && /[A-Za-z0-9_.:-]/.test(text[end])) {
    end += 1;
  }
  const token = text.slice(start, end);
  const name = localQName(token);
  if (!name) {
    return undefined;
  }
  const tagStart = text.lastIndexOf("<", start);
  const tagEnd = text.lastIndexOf(">", start);
  if (tagStart <= tagEnd) {
    return undefined;
  }
  const before = text.slice(tagStart + 1, start);
  const elementMatch = before.match(/^\s*\/?\s*([A-Za-z_][\w.:-]*)/);
  const element = localQName(elementMatch?.[1]);
  const isElement = !element || before.trim().replace(/^\//, "").length === 0;
  return {
    kind: isElement ? "element" : "attribute",
    name,
    element,
    range: { start, end }
  };
}

export function ipxactGeneratedStructures(text: string): TxtJetIpxactStructure[] {
  return scanXmlNodes(maskTxtJetBlocks(text)).flatMap(structuresBelow);
}

function scanXmlNodes(text: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const tags = /<!--[\s\S]*?-->|<\s*(\/?)\s*([A-Za-z_][\w.:-]*)([^<>]*?)\s*(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(text))) {
    if (match[0].startsWith("<!--")) {
      continue;
    }
    const closing = match[1] === "/";
    const name = match[2];
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name !== name) {
          continue;
        }
        const node = stack[index];
        node.endTagStart = match.index;
        node.range.end = match.index + match[0].length;
        stack.splice(index);
        break;
      }
      continue;
    }

    const parent = last(stack);
    const node: XmlNode = {
      name,
      localName: localQName(name) ?? name,
      attributes: parseXmlAttributes(match[3], match.index + match[0].indexOf(match[3])),
      range: { start: match.index, end: match.index + match[0].length },
      startTagEnd: match.index + match[0].length,
      endTagStart: match.index + match[0].length,
      parent,
      children: [],
      sourceText: text
    };
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    if (match[4] !== "/" && !match[0].endsWith("/>")) {
      stack.push(node);
    }
  }
  return roots;
}

const IPXACT_STRUCTURE_KINDS = new Set<TxtJetIpxactStructureKind>([
  "component",
  "busInterface",
  "memoryMap",
  "addressBlock",
  "register",
  "field"
]);

function structuresBelow(node: XmlNode): TxtJetIpxactStructure[] {
  const nested = node.children.flatMap(structuresBelow);
  if (!IPXACT_STRUCTURE_KINDS.has(node.localName as TxtJetIpxactStructureKind)) {
    return nested;
  }
  const directName = node.children.find((child) => child.localName === "name");
  const name = directName
    ? collapseWhitespace(nodeText(directName)).slice(0, 160) || undefined
    : undefined;
  return [{
    kind: node.localName as TxtJetIpxactStructureKind,
    name,
    range: node.range,
    selectionRange: xmlNodeNameRange(node),
    children: nested
  }];
}

function xmlNodeNameRange(node: XmlNode): TxtJetRange {
  const openingTag = node.sourceText.slice(node.range.start, node.startTagEnd);
  const match = openingTag.match(/<\s*([A-Za-z_][\w.:-]*)/);
  if (!match || match.index === undefined) {
    return { start: node.range.start, end: node.startTagEnd };
  }
  const start = node.range.start + match.index + match[0].lastIndexOf(match[1]);
  return { start, end: start + match[1].length };
}

function parseXmlAttributes(text: string, baseOffset: number): XmlAttribute[] {
  const attributes: XmlAttribute[] = [];
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    attributes.push({
      name: match[1],
      value: match[3] ?? match[4] ?? "",
      range: { start: baseOffset + match.index, end: baseOffset + match.index + match[0].length }
    });
  }
  return attributes;
}

function walkNodes(node: XmlNode, visit: (node: XmlNode) => void): void {
  visit(node);
  for (const child of node.children) {
    walkNodes(child, visit);
  }
}

function inlineSchemaContent(node: XmlNode): XmlNode | undefined {
  return node.children.find((child) => child.localName === "complexType");
}

function schemaChildElementNames(container: XmlNode): string[] {
  const names: string[] = [];
  function visit(node: XmlNode): void {
    for (const child of node.children) {
      if (child.localName === "element") {
        const name = schemaElementName(child);
        if (name) {
          names.push(name);
        }
        continue;
      }
      if (child.localName !== "documentation" && child.localName !== "attribute") {
        visit(child);
      }
    }
  }
  visit(container);
  return uniqueStrings(names);
}

function schemaAttributes(
  container: XmlNode,
  fileName: string
): TxtJetIpxactSchemaAttribute[] {
  const attributes: TxtJetIpxactSchemaAttribute[] = [];
  function visit(node: XmlNode): void {
    for (const child of node.children) {
      if (child.localName === "element") {
        continue;
      }
      if (child.localName === "attribute") {
        const name = localQName(attributeValue(child, "name") ?? attributeValue(child, "ref"));
        if (name) {
          attributes.push({
            name,
            type: localQName(attributeValue(child, "type")),
            required: attributeValue(child, "use") === "required",
            documentation: schemaDocumentation(child),
            location: schemaNodeLocation(fileName, child, "name", "ref")
          });
        }
        continue;
      }
      visit(child);
    }
  }
  visit(container);
  return attributes;
}

function schemaDocumentation(node: XmlNode): string | undefined {
  let documentation: XmlNode | undefined;
  function visit(candidate: XmlNode): void {
    for (const child of candidate.children) {
      if (child.localName === "element") {
        continue;
      }
      if (child.localName === "documentation") {
        documentation = child;
        return;
      }
      visit(child);
      if (documentation) {
        return;
      }
    }
  }
  visit(node);
  if (!documentation) {
    return undefined;
  }
  return collapseWhitespace(nodeText(documentation)).slice(0, 800) || undefined;
}

function nodeText(node: XmlNode): string {
  return node.sourceText.slice(node.startTagEnd, node.endTagStart).replace(/<[^>]+>/g, " ");
}

function schemaNodeLocation(
  fileName: string,
  node: XmlNode,
  ...attributeNames: string[]
): TxtJetIpxactSchemaLocation {
  const attribute = node.attributes.find((candidate) => attributeNames.includes(candidate.name));
  return { fileName, range: attribute?.range ?? node.range };
}

function schemaElementName(node: XmlNode): string | undefined {
  return localQName(attributeValue(node, "name") ?? attributeValue(node, "ref"));
}

function attributeValue(node: XmlNode, name: string): string | undefined {
  return node.attributes.find((attribute) => attribute.name === name)?.value;
}

function localQName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.slice(value.lastIndexOf(":") + 1);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

function maskTxtJetBlocks(text: string): string {
  return text.replace(/<%[\s\S]*?(?:%>|$)/g, (block) =>
    block.replace(/[^\r\n]/g, " ")
  );
}

function openElementStack(text: string): string[] {
  const stack: string[] = [];
  const tags = /<\s*(\/?)\s*([A-Za-z_][\w.:-]*)[^<>]*?(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(text))) {
    const name = match[2];
    if (!name) {
      continue;
    }
    if (match[1] === "/") {
      const index = stack.lastIndexOf(name);
      if (index !== -1) {
        stack.splice(index);
      }
    } else if (match[3] !== "/" && !match[0].endsWith("/>")) {
      stack.push(name);
    }
  }
  return stack;
}

function qNamePrefix(value: string | undefined): string | undefined {
  if (!value?.includes(":")) {
    return undefined;
  }
  return value.slice(0, value.indexOf(":"));
}
