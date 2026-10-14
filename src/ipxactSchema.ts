import { TxtJetRange } from "./templateModel";
import { ResourceBudget, ResourceLimitError } from "./resourceBudget";

export const MAX_IPXACT_XML_CHARACTERS = 4 * 1024 * 1024;
export const MAX_IPXACT_XML_DEPTH = 128;
export const MAX_IPXACT_XML_NODES = 100000;

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
  namespace?: string;
  schemaKey: string;
  global: boolean;
  type?: string;
  documentation?: string;
  children: string[];
  childKeys: string[];
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

interface XmlTagToken {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributeText: string;
  attributeOffset: number;
}

interface SchemaContext {
  document: TxtJetIpxactSchemaDocument;
  schema: XmlNode;
  targetNamespace: string;
  namespaces: Map<string, string>;
}

interface SchemaDeclaration {
  context: SchemaContext;
  node: XmlNode;
  key: string;
}

interface SchemaDeclarations {
  complexTypes: Map<string, SchemaDeclaration>;
  groups: Map<string, SchemaDeclaration>;
  attributeGroups: Map<string, SchemaDeclaration>;
  globalElements: Map<string, SchemaDeclaration>;
  globalAttributes: Map<string, SchemaDeclaration>;
}

export function buildIpxactSchemaIndex(
  documents: TxtJetIpxactSchemaDocument[]
): TxtJetIpxactSchemaIndex {
  const contexts = documents.flatMap((document) =>
    scanXmlNodes(document.text)
      .filter((node) => node.localName === "schema")
      .map((schema) => schemaContext(document, schema))
  );
  const declarations = collectSchemaDeclarations(contexts);

  const elements: TxtJetIpxactSchemaElement[] = [];
  const globalElements = new Set<string>();
  for (const context of contexts) {
    walkNodes(context.schema, (node) => {
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
      const refKey = resolveSchemaQName(attributeValue(node, "ref"), context);
      const referenced = refKey ? declarations.globalElements.get(refKey) : undefined;
      const definition = referenced ?? { context, node, key: schemaElementKey(node, context) };
      const typeValue = attributeValue(definition.node, "type");
      const typeKey = resolveSchemaQName(typeValue, definition.context);
      const inlineContent = inlineSchemaContent(definition.node);
      const namedContent = typeKey ? declarations.complexTypes.get(typeKey) : undefined;
      const content = inlineContent
        ? { context: definition.context, node: inlineContent, key: `${definition.key}\0inline` }
        : namedContent;
      const children = content
        ? resolvedSchemaChildren(content, declarations)
        : [];
      const namespace = schemaKeyNamespace(refKey ?? schemaElementKey(node, context));
      elements.push({
        name,
        namespace: namespace || undefined,
        schemaKey: refKey ?? schemaElementKey(node, context),
        global: isGlobal,
        type: localQName(typeValue),
        documentation: schemaDocumentation(node) ?? (referenced ? schemaDocumentation(referenced.node) : undefined),
        children: children.map((child) => child.name),
        childKeys: children.map((child) => child.key),
        attributes: content
          ? resolvedSchemaAttributes(content, declarations)
          : [],
        location: schemaNodeLocation(context.document.fileName, node, "name", "ref")
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
  return index.elements
    .filter((element) => element.name === local)
    .sort((left, right) => Number(right.global) - Number(left.global));
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
  return uniqueStrings(parent.childKeys)
    .flatMap((key) => {
      const exact = index.elements
        .filter((element) => element.schemaKey === key)
        .sort((left, right) => Number(right.global) - Number(left.global))[0];
      return exact ? [exact] : schemaElementsNamed(index, schemaKeyLocalName(key)).slice(0, 1);
    });
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
  if (text.length > MAX_IPXACT_XML_CHARACTERS) {
    return undefined;
  }
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
  if (text.length > MAX_IPXACT_XML_CHARACTERS) {
    throw new ResourceLimitError("IP-XACT XML characters", MAX_IPXACT_XML_CHARACTERS);
  }
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const budget = new ResourceBudget({
    "IP-XACT XML tokens": MAX_IPXACT_XML_NODES * 2,
    "IP-XACT XML nodes": MAX_IPXACT_XML_NODES
  });
  let offset = 0;
  let tag: XmlTagToken | undefined;
  while ((tag = nextXmlTag(text, offset))) {
    offset = tag.end;
    budget.consume("IP-XACT XML tokens");
    if (tag.closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name !== tag.name) {
          continue;
        }
        const node = stack[index];
        node.endTagStart = tag.start;
        node.range.end = tag.end;
        stack.splice(index);
        break;
      }
      continue;
    }

    budget.consume("IP-XACT XML nodes");
    const parent = last(stack);
    const node: XmlNode = {
      name: tag.name,
      localName: localQName(tag.name) ?? tag.name,
      attributes: parseXmlAttributes(tag.attributeText, tag.attributeOffset),
      range: { start: tag.start, end: tag.end },
      startTagEnd: tag.end,
      endTagStart: tag.end,
      parent,
      children: [],
      sourceText: text
    };
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    if (!tag.selfClosing) {
      if (stack.length >= MAX_IPXACT_XML_DEPTH) {
        throw new ResourceLimitError("IP-XACT XML depth", MAX_IPXACT_XML_DEPTH);
      }
      stack.push(node);
    }
  }
  return roots;
}

function nextXmlTag(text: string, from: number): XmlTagToken | undefined {
  let cursor = from;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start === -1) {
      return undefined;
    }
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end === -1) {
        return undefined;
      }
      cursor = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", start)) {
      const end = text.indexOf("]]>", start + 9);
      if (end === -1) {
        return undefined;
      }
      cursor = end + 3;
      continue;
    }
    if (text.startsWith("<?", start)) {
      const end = text.indexOf("?>", start + 2);
      if (end === -1) {
        return undefined;
      }
      cursor = end + 2;
      continue;
    }

    const end = xmlTagEnd(text, start + 1);
    if (end === -1) {
      return undefined;
    }
    const raw = text.slice(start, end + 1);
    const match = /^<\s*(\/?)\s*([A-Za-z_][\w.:-]*)/.exec(raw);
    if (!match) {
      cursor = end + 1;
      continue;
    }
    const attributeStart = match[0].length;
    return {
      start,
      end: end + 1,
      name: match[2],
      closing: match[1] === "/",
      selfClosing: /\/\s*>$/.test(raw),
      attributeText: raw.slice(attributeStart, -1),
      attributeOffset: start + attributeStart
    };
  }
  return undefined;
}

function xmlTagEnd(text: string, from: number): number {
  let quote: "'" | "\"" | undefined;
  for (let offset = from; offset < text.length; offset += 1) {
    const character = text[offset];
    if (character === "'" || character === "\"") {
      if (!quote) {
        quote = character;
      } else if (quote === character) {
        quote = undefined;
      }
    } else if (character === ">" && !quote) {
      return offset;
    }
  }
  return -1;
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
  const results = new Map<XmlNode, TxtJetIpxactStructure[]>();
  const work: Array<{ node: XmlNode; visited: boolean }> = [{ node, visited: false }];
  while (work.length > 0) {
    const current = work.pop();
    if (!current) {
      break;
    }
    if (!current.visited) {
      work.push({ node: current.node, visited: true });
      for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
        work.push({ node: current.node.children[index], visited: false });
      }
      continue;
    }
    const nested = current.node.children.flatMap((child) => results.get(child) ?? []);
    if (!IPXACT_STRUCTURE_KINDS.has(current.node.localName as TxtJetIpxactStructureKind)) {
      results.set(current.node, nested);
      continue;
    }
    const directName = current.node.children.find((child) => child.localName === "name");
    const name = directName
      ? collapseWhitespace(nodeText(directName)).slice(0, 160) || undefined
      : undefined;
    results.set(current.node, [{
      kind: current.node.localName as TxtJetIpxactStructureKind,
      name,
      range: current.node.range,
      selectionRange: xmlNodeNameRange(current.node),
      children: nested
    }]);
  }
  return results.get(node) ?? [];
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
  const work = [node];
  while (work.length > 0) {
    const current = work.pop();
    if (!current) {
      break;
    }
    visit(current);
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      work.push(current.children[index]);
    }
  }
}

function schemaContext(
  document: TxtJetIpxactSchemaDocument,
  schema: XmlNode
): SchemaContext {
  const namespaces = new Map<string, string>();
  for (const attribute of schema.attributes) {
    if (attribute.name === "xmlns") {
      namespaces.set("", attribute.value);
    } else if (attribute.name.startsWith("xmlns:")) {
      namespaces.set(attribute.name.slice("xmlns:".length), attribute.value);
    }
  }
  return {
    document,
    schema,
    targetNamespace: attributeValue(schema, "targetNamespace") ?? "",
    namespaces
  };
}

function collectSchemaDeclarations(contexts: SchemaContext[]): SchemaDeclarations {
  const declarations: SchemaDeclarations = {
    complexTypes: new Map(),
    groups: new Map(),
    attributeGroups: new Map(),
    globalElements: new Map(),
    globalAttributes: new Map()
  };
  for (const context of contexts) {
    for (const node of context.schema.children) {
      const name = attributeValue(node, "name");
      if (!name) {
        continue;
      }
      const declaration: SchemaDeclaration = {
        context,
        node,
        key: schemaNameKey(context.targetNamespace, name)
      };
      const target = declarationMapFor(node.localName, declarations);
      if (target && !target.has(declaration.key)) {
        target.set(declaration.key, declaration);
      }
    }
  }
  return declarations;
}

function declarationMapFor(
  localName: string,
  declarations: SchemaDeclarations
): Map<string, SchemaDeclaration> | undefined {
  switch (localName) {
    case "complexType":
      return declarations.complexTypes;
    case "group":
      return declarations.groups;
    case "attributeGroup":
      return declarations.attributeGroups;
    case "element":
      return declarations.globalElements;
    case "attribute":
      return declarations.globalAttributes;
    default:
      return undefined;
  }
}

function inlineSchemaContent(node: XmlNode): XmlNode | undefined {
  return node.children.find((child) => child.localName === "complexType");
}

function resolvedSchemaChildren(
  content: SchemaDeclaration,
  declarations: SchemaDeclarations
): Array<{ name: string; key: string }> {
  const children = new Map<string, { name: string; key: string }>();
  const seen = new Set<string>([`complexType:${content.key}`]);
  const frames: Array<{ node: XmlNode; context: SchemaContext; index: number }> = [
    { node: content.node, context: content.context, index: 0 }
  ];
  const descend = (node: XmlNode, context: SchemaContext) => frames.push({ node, context, index: 0 });
  const descendDeclaration = (declaration: SchemaDeclaration, kind: "complexType" | "group") => {
    const seenKey = `${kind}:${declaration.key}`;
    if (!seen.has(seenKey)) {
      seen.add(seenKey);
      descend(declaration.node, declaration.context);
    }
  };

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.node.children.length) {
      frames.pop();
      continue;
    }
    const child = frame.node.children[frame.index];
    frame.index += 1;
    if (child.localName === "element") {
      const name = schemaElementName(child);
      if (name) {
        const key = resolveSchemaQName(attributeValue(child, "ref"), frame.context)
          ?? schemaNameKey(frame.context.targetNamespace, name);
        children.set(key, { name, key });
      }
      continue;
    }
    if (child.localName === "group") {
      const key = resolveSchemaQName(attributeValue(child, "ref"), frame.context);
      const declaration = key ? declarations.groups.get(key) : undefined;
      if (declaration) {
        descendDeclaration(declaration, "group");
      } else {
        descend(child, frame.context);
      }
      continue;
    }
    if (child.localName === "extension" || child.localName === "restriction") {
      // Continue the current node after its referenced base, matching the former depth-first order.
      const key = resolveSchemaQName(attributeValue(child, "base"), frame.context);
      const declaration = key ? declarations.complexTypes.get(key) : undefined;
      descend(child, frame.context);
      if (declaration) {
        descendDeclaration(declaration, "complexType");
      }
      continue;
    }
    if (!["documentation", "attribute", "attributeGroup"].includes(child.localName)) {
      descend(child, frame.context);
    }
  }
  return [...children.values()];
}

function resolvedSchemaAttributes(
  content: SchemaDeclaration,
  declarations: SchemaDeclarations
): TxtJetIpxactSchemaAttribute[] {
  const attributes = new Map<string, TxtJetIpxactSchemaAttribute>();
  const seen = new Set<string>([`complexType:${content.key}`]);
  const frames: Array<{ node: XmlNode; context: SchemaContext; index: number }> = [
    { node: content.node, context: content.context, index: 0 }
  ];
  const descend = (node: XmlNode, context: SchemaContext) => frames.push({ node, context, index: 0 });
  const descendDeclaration = (declaration: SchemaDeclaration, kind: "complexType" | "attributeGroup") => {
    const seenKey = `${kind}:${declaration.key}`;
    if (!seen.has(seenKey)) {
      seen.add(seenKey);
      descend(declaration.node, declaration.context);
    }
  };

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.node.children.length) {
      frames.pop();
      continue;
    }
    const child = frame.node.children[frame.index];
    frame.index += 1;
    if (child.localName === "element") {
      continue;
    }
    if (child.localName === "attribute") {
      const refKey = resolveSchemaQName(attributeValue(child, "ref"), frame.context);
      const referenced = refKey ? declarations.globalAttributes.get(refKey) : undefined;
      const definition = referenced?.node ?? child;
      const definitionContext = referenced?.context ?? frame.context;
      const name = localQName(attributeValue(child, "name") ?? attributeValue(child, "ref"));
      if (name) {
        attributes.set(name, {
          name,
          type: localQName(attributeValue(definition, "type")),
          required: (attributeValue(child, "use") ?? attributeValue(definition, "use")) === "required",
          documentation: schemaDocumentation(child) ?? (referenced ? schemaDocumentation(referenced.node) : undefined),
          location: schemaNodeLocation(definitionContext.document.fileName, definition, "name", "ref")
        });
      }
      continue;
    }
    if (child.localName === "attributeGroup") {
      const key = resolveSchemaQName(attributeValue(child, "ref"), frame.context);
      const declaration = key ? declarations.attributeGroups.get(key) : undefined;
      if (declaration) {
        descendDeclaration(declaration, "attributeGroup");
      } else {
        descend(child, frame.context);
      }
      continue;
    }
    if (child.localName === "extension" || child.localName === "restriction") {
      const key = resolveSchemaQName(attributeValue(child, "base"), frame.context);
      const declaration = key ? declarations.complexTypes.get(key) : undefined;
      descend(child, frame.context);
      if (declaration) {
        descendDeclaration(declaration, "complexType");
      }
      continue;
    }
    descend(child, frame.context);
  }
  return [...attributes.values()];
}

function schemaDocumentation(node: XmlNode): string | undefined {
  let documentation: XmlNode | undefined;
  const work = [node];
  while (work.length > 0 && !documentation) {
    const candidate = work.pop();
    if (!candidate) {
      break;
    }
    if (candidate.localName === "documentation") {
      documentation = candidate;
      break;
    }
    for (let index = candidate.children.length - 1; index >= 0; index -= 1) {
      const child = candidate.children[index];
      if (child.localName === "element") {
        continue;
      }
      work.push(child);
    }
  }
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

function schemaElementKey(node: XmlNode, context: SchemaContext): string {
  return resolveSchemaQName(attributeValue(node, "ref"), context)
    ?? schemaNameKey(context.targetNamespace, attributeValue(node, "name") ?? "");
}

function resolveSchemaQName(
  value: string | undefined,
  context: SchemaContext
): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("{")) {
    const namespaceEnd = value.indexOf("}");
    if (namespaceEnd > 0 && namespaceEnd < value.length - 1) {
      return schemaNameKey(value.slice(1, namespaceEnd), value.slice(namespaceEnd + 1));
    }
  }
  const separator = value.indexOf(":");
  if (separator >= 0) {
    const prefix = value.slice(0, separator);
    const namespace = context.namespaces.get(prefix);
    return namespace === undefined
      ? undefined
      : schemaNameKey(namespace, value.slice(separator + 1));
  }
  const namespace = context.namespaces.get("") ?? context.targetNamespace;
  return schemaNameKey(namespace, value);
}

function schemaNameKey(namespace: string, localName: string): string {
  return `${namespace}\0${localName}`;
}

function schemaKeyNamespace(key: string): string {
  const separator = key.indexOf("\0");
  return separator === -1 ? "" : key.slice(0, separator);
}

function schemaKeyLocalName(key: string): string {
  const separator = key.indexOf("\0");
  return separator === -1 ? key : key.slice(separator + 1);
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
  let offset = 0;
  let tag: XmlTagToken | undefined;
  while ((tag = nextXmlTag(text, offset))) {
    offset = tag.end;
    if (tag.closing) {
      const index = stack.lastIndexOf(tag.name);
      if (index !== -1) {
        stack.splice(index);
      }
    } else if (!tag.selfClosing) {
      if (stack.length >= MAX_IPXACT_XML_DEPTH) {
        return [];
      }
      stack.push(tag.name);
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
