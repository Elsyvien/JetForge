import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";
import { TxtJetTargetLanguage } from "./detector";
import { ResourceBudget, ResourceLimitError } from "./resourceBudget";

export type TxtJetBlockKind = "outer" | "scriptlet" | "expression" | "declaration" | "directive";

export interface TxtJetRange {
  start: number;
  end: number;
}

export interface TxtJetDirective {
  name: string;
  nameRange: TxtJetRange;
  attributes: Record<string, string>;
  attributeRanges: Record<string, TxtJetRange>;
  duplicateAttributes: Array<{ name: string; range: TxtJetRange }>;
  malformedAttributes: TxtJetRange[];
}

export interface TxtJetBlock {
  kind: TxtJetBlockKind;
  marker: string;
  content: string;
  range: TxtJetRange;
  contentRange: TxtJetRange;
  directive?: TxtJetDirective;
}

export interface TxtJetMapping {
  source: TxtJetRange;
  preview: TxtJetRange;
  kind: TxtJetBlockKind | "placeholder" | "append";
}

export type TxtJetProvenanceKind = "root" | "include" | "expression" | "skeleton" | "unmapped";
export type TxtJetProvenanceConfidence = "direct" | "include-expanded" | "skeleton-rendered" | "approximate" | "unmapped";

export interface TxtJetProvenance {
  preview: TxtJetRange;
  kind: TxtJetProvenanceKind;
  confidence: TxtJetProvenanceConfidence;
  source?: TxtJetRange;
  sourceFileName?: string;
  label?: string;
}

export interface TxtJetTemplateModel {
  blocks: TxtJetBlock[];
  directives: TxtJetDirective[];
  jetDirective?: TxtJetDirective;
  includes: TxtJetDirective[];
}

export interface TxtJetGeneratedPreview {
  text: string;
  mappings: TxtJetMapping[];
  provenance: TxtJetProvenance[];
}

export interface TxtJetOutputPreviewOptions {
  sourceFileName?: string;
  expandIncludes?: boolean;
  readInclude?: (path: string) => string | undefined;
  includePaths?: string[];
  includeStack?: string[];
  originKind?: "root" | "include";
  limits?: Partial<TxtJetPreviewLimits>;
}

export interface TxtJetJavaPreviewOptions {
  sourceFileName?: string;
  readSkeleton?: (path: string) => string | undefined;
  skeletonPaths?: string[];
  limits?: Partial<TxtJetPreviewLimits>;
}

export interface TxtJetPreviewLimits {
  inputCharacters: number;
  outputCharacters: number;
  entries: number;
  expansions: number;
}

export interface TxtJetReferenceResolutionOptions {
  searchPaths?: string[];
}

interface JavaPreviewSection {
  text: string;
  mappings: TxtJetMapping[];
}

class PreviewTextBuilder {
  private readonly chunks: string[] = [];
  private totalLength = 0;

  constructor(private readonly budget: PreviewBudget) {}

  get length(): number {
    return this.totalLength;
  }

  append(text: string): void {
    this.budget.consume("outputCharacters", text.length);
    this.chunks.push(text);
    this.totalLength += text.length;
  }

  toString(): string {
    return this.chunks.join("");
  }
}

type ExpressionContextKind =
  | "identifier"
  | "string"
  | "comment"
  | "macro"
  | "html-attribute"
  | "text"
  | "unknown";

interface ExpressionContext {
  kind: ExpressionContextKind;
  before: string;
  after: string;
}

const OPEN_MARKERS = ["<%@", "<%=", "<%!", "<%"];
const DEFAULT_PACKAGE = "txtjet.generated";
const DEFAULT_CLASS = "GeneratedTxtJetTemplate";
const MAX_INCLUDE_DEPTH = 8;
export const DEFAULT_PREVIEW_LIMITS: TxtJetPreviewLimits = {
  inputCharacters: 4 * 1024 * 1024,
  outputCharacters: 2 * 1024 * 1024,
  entries: 100000,
  expansions: 4096
};
type PreviewResource = keyof TxtJetPreviewLimits;
type PreviewBudget = ResourceBudget<PreviewResource>;

function previewBudget(overrides: Partial<TxtJetPreviewLimits> | undefined): PreviewBudget {
  const limits = { ...DEFAULT_PREVIEW_LIMITS, ...overrides };
  for (const key of Object.keys(limits) as PreviewResource[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Invalid TxtJet preview limit for ${key}.`);
    }
  }
  return new ResourceBudget(limits);
}

function limitedPreview(
  error: ResourceLimitError,
  sourceFileName: string | undefined,
  targetLanguage: TxtJetTargetLanguage
): TxtJetGeneratedPreview {
  const text = commentPlaceholder(`txtjet preview stopped: ${error.message}`, targetLanguage);
  return {
    text,
    mappings: [],
    provenance: [{
      preview: { start: 0, end: text.length },
      kind: "unmapped",
      confidence: "unmapped",
      sourceFileName,
      label: error.message
    }]
  };
}

function reserveTemplateStructure(text: string, budget: PreviewBudget): void {
  let markers = 0;
  let offset = 0;
  while ((offset = text.indexOf("<%", offset)) !== -1) {
    markers += 1;
    budget.consume("entries", 4);
    offset += 2;
  }
  if (markers === 0) {
    budget.consume("entries", 2);
  }
}

export function parseTxtJetTemplate(text: string): TxtJetTemplateModel {
  const blocks: TxtJetBlock[] = [];
  let offset = 0;

  while (offset < text.length) {
    const open = findNextOpen(text, offset);
    if (open === -1) {
      pushOuter(blocks, text, offset, text.length);
      break;
    }

    pushOuter(blocks, text, offset, open);
    const marker = markerAt(text, open);
    if (!marker) {
      pushOuter(blocks, text, open, open + 2);
      offset = open + 2;
      continue;
    }

    const contentStart = open + marker.length;
    const close = text.indexOf("%>", contentStart);
    const end = close === -1 ? text.length : close + 2;
    const contentEnd = close === -1 ? text.length : close;
    const content = text.slice(contentStart, contentEnd);
    const kind = kindForMarker(marker);
    const block: TxtJetBlock = {
      kind,
      marker,
      content,
      range: { start: open, end },
      contentRange: { start: contentStart, end: contentEnd }
    };
    if (kind === "directive") {
      block.directive = parseDirective(content, contentStart);
    }
    blocks.push(block);
    offset = end;
  }

  const directives = blocks.flatMap((block) => block.directive ? [block.directive] : []);
  return {
    blocks,
    directives,
    jetDirective: directives.find((directive) => directive.name === "jet"),
    includes: directives.filter((directive) => directive.name === "include")
  };
}

export function buildGeneratedOutputPreview(
  text: string,
  targetLanguage: TxtJetTargetLanguage = "txtjet",
  options: TxtJetOutputPreviewOptions = {}
): TxtJetGeneratedPreview {
  const budget = previewBudget(options.limits);
  try {
    return buildGeneratedOutputPreviewInternal(text, targetLanguage, options, budget);
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return limitedPreview(error, options.sourceFileName, targetLanguage);
    }
    throw error;
  }
}

function buildGeneratedOutputPreviewInternal(
  text: string,
  targetLanguage: TxtJetTargetLanguage,
  options: TxtJetOutputPreviewOptions,
  budget: PreviewBudget
): TxtJetGeneratedPreview {
  budget.consume("inputCharacters", text.length);
  reserveTemplateStructure(text, budget);
  const model = parseTxtJetTemplate(text);
  const output = new PreviewTextBuilder(budget);
  const mappings: TxtJetMapping[] = [];
  const provenance: TxtJetProvenance[] = [];

  for (let index = 0; index < model.blocks.length; index += 1) {
    const block = model.blocks[index];
    const start = output.length;
    if (block.kind === "outer") {
      output.append(block.content);
      mappings.push({ source: block.range, preview: { start, end: start + block.content.length }, kind: "outer" });
      provenance.push({
        source: block.range,
        sourceFileName: options.sourceFileName,
        preview: { start, end: start + block.content.length },
        kind: options.originKind ?? "root",
        confidence: options.originKind === "include" ? "include-expanded" : "direct"
      });
      continue;
    }

    const replacement = block.kind === "directive" && block.directive?.name === "include"
      ? includePreview(block.directive, targetLanguage, options, budget)
      : {
        text: outputPlaceholder(block, targetLanguage, options, expressionContextFor(model.blocks, index)),
        provenance: [] as TxtJetProvenance[]
      };
    output.append(replacement.text);
    mappings.push({
      source: block.range,
      preview: { start, end: start + replacement.text.length },
      kind: block.kind === "expression" ? "placeholder" : block.kind
    });
    if (replacement.provenance.length > 0) {
      appendOffsetProvenance(provenance, replacement.provenance, start);
    } else {
      provenance.push({
        source: block.range,
        sourceFileName: options.sourceFileName,
        preview: { start, end: start + replacement.text.length },
        kind: block.kind === "expression" ? "expression" : options.originKind ?? "root",
        confidence: block.kind === "expression"
          ? "approximate"
          : options.originKind === "include" ? "include-expanded" : "approximate",
        label: block.kind === "expression" ? trimExpression(block.content) : undefined
      });
    }
  }

  return { text: output.toString(), mappings, provenance };
}

export function buildGeneratedJavaPreview(
  text: string,
  sourceName = "TxtJet template",
  options: TxtJetJavaPreviewOptions = {}
): TxtJetGeneratedPreview {
  const budget = previewBudget(options.limits);
  try {
    return buildGeneratedJavaPreviewInternal(text, sourceName, options, budget);
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return limitedPreview(error, options.sourceFileName ?? sourceName, "txtjet-java");
    }
    throw error;
  }
}

function buildGeneratedJavaPreviewInternal(
  text: string,
  sourceName: string,
  options: TxtJetJavaPreviewOptions,
  budget: PreviewBudget
): TxtJetGeneratedPreview {
  budget.consume("inputCharacters", text.length);
  reserveTemplateStructure(text, budget);
  const model = parseTxtJetTemplate(text);
  const packageName = sanitizePackageName(model.jetDirective?.attributes.package) ?? DEFAULT_PACKAGE;
  const className = sanitizeClassName(model.jetDirective?.attributes.class) ?? DEFAULT_CLASS;
  const imports = splitImports(model.jetDirective?.attributes.imports);
  const sections = buildJavaPreviewSections(model);
  const skeleton = readSkeletonTemplate(model, sourceName, options);
  if (skeleton?.usesTokens) {
    budget.consume("inputCharacters", skeleton.text.length);
    return buildSkeletonJavaPreview(skeleton.text, {
      sourceName,
      model,
      packageName,
      className,
      imports,
      members: sections.members,
      generateMethod: sections.generateMethod,
      skeletonFileName: skeleton.resolved
    }, budget);
  }

  const output = new PreviewTextBuilder(budget);
  const mappings: TxtJetMapping[] = [];

  output.append(`// TxtJet generated Java template preview for ${sourceName}\n`);
  output.append("// This is an editor approximation, not compiler output.\n\n");
  if (model.jetDirective?.attributes.skeleton) {
    appendSkeletonReference(output, mappings, model.jetDirective, skeleton?.status ?? "unavailable");
  }
  output.append(`package ${packageName};\n\n`);
  for (const importName of imports) {
    output.append(`import ${importName};\n`);
  }
  if (imports.length > 0) {
    output.append("\n");
  }
  output.append(`public class ${className} {\n`);
  appendSection(output, mappings, sections.members, budget);
  appendSection(output, mappings, sections.generateMethod, budget);
  output.append("}\n");

  return {
    text: output.toString(),
    mappings,
    provenance: provenanceFromMappings(mappings, options.sourceFileName ?? sourceName)
  };
}

export function targetPreviewLanguage(languageId: TxtJetTargetLanguage): string {
  switch (languageId) {
    case "txtjet-java":
      return "java";
    case "txtjet-html":
      return "html";
    case "txtjet-xml":
      return "xml";
    case "txtjet-c":
      return "c";
    case "txtjet-python":
      return "python";
    case "txtjet-latex":
      return "latex";
    case "txtjet":
    default:
      return "plaintext";
  }
}

export function targetOutputExtension(languageId: TxtJetTargetLanguage): string {
  switch (languageId) {
    case "txtjet-latex":
      return "tex";
    case "txtjet":
      return "txt";
    default:
      return targetPreviewLanguage(languageId);
  }
}

export function mapSourceRangeToPreview(mappings: TxtJetMapping[], sourceRange: TxtJetRange): TxtJetRange | undefined {
  return mapRange(mappings, sourceRange, "source", "preview");
}

export function mapPreviewRangeToSource(mappings: TxtJetMapping[], previewRange: TxtJetRange): TxtJetRange | undefined {
  return mapRange(mappings, previewRange, "preview", "source");
}

export function resolveIncludePath(templateFileName: string, includeFile: string): string | undefined {
  return resolveTemplateReferencePath(templateFileName, includeFile);
}

export function resolveTemplateReferencePath(
  templateFileName: string,
  referenceFile: string,
  options: TxtJetReferenceResolutionOptions = {}
): string | undefined {
  return resolveReferenceCandidates(templateFileName, referenceFile, options)[0];
}

export const resolveSkeletonPath = resolveIncludePath;

export function resolveReferenceCandidates(
  templateFileName: string,
  referenceFile: string,
  options: TxtJetReferenceResolutionOptions = {}
): string[] {
  if (!referenceFile || isAbsolute(referenceFile)) {
    return [];
  }
  const roots = [dirname(templateFileName), ...(options.searchPaths ?? [])];
  const seen = new Set<string>();
  return roots.flatMap((root) => referenceNameCandidates(referenceFile).map((name) => normalize(resolve(root, name))))
    .filter((candidate) => {
      if (seen.has(candidate)) {
        return false;
      }
      seen.add(candidate);
      return true;
    });
}

function referenceNameCandidates(referenceFile: string): string[] {
  if (/\.[^/\\.]+$/.test(referenceFile)) {
    return [referenceFile];
  }
  return [referenceFile, `${referenceFile}.txtjet`, `${referenceFile}.jetinc`, `${referenceFile}.skeleton`];
}

function pushOuter(blocks: TxtJetBlock[], text: string, start: number, end: number): void {
  if (end <= start) {
    return;
  }
  blocks.push({
    kind: "outer",
    marker: "",
    content: text.slice(start, end),
    range: { start, end },
    contentRange: { start, end }
  });
}

function parseDirective(content: string, contentStart: number): TxtJetDirective {
  const leadingWhitespace = content.match(/^\s*/)?.[0].length ?? 0;
  const nameMatch = content.slice(leadingWhitespace).match(/^([^\s=]+)/);
  const name = nameMatch?.[1] ?? "";
  const nameStart = contentStart + leadingWhitespace;
  const nameEnd = nameStart + name.length;
  const attributes: Record<string, string> = {};
  const attributeRanges: Record<string, TxtJetRange> = {};
  const duplicateAttributes: Array<{ name: string; range: TxtJetRange }> = [];
  const malformedAttributes: TxtJetRange[] = [];
  const attributeTextStart = leadingWhitespace + name.length;
  const attributeText = content.slice(attributeTextStart);
  const consumed = Array.from({ length: attributeText.length }, () => false);
  const attributePattern = /([A-Za-z_][\w.-]*)\s*=\s*("((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(attributeText))) {
    const attrName = match[1];
    const start = contentStart + attributeTextStart + match.index;
    const end = start + match[0].length;
    if (attrName in attributes) {
      duplicateAttributes.push({ name: attrName, range: { start, end } });
    }
    attributes[attrName] = unescapeDirectiveValue(match[3] ?? match[4] ?? "");
    attributeRanges[attrName] = { start, end };
    for (let index = match.index; index < match.index + match[0].length; index += 1) {
      consumed[index] = true;
    }
  }

  let malformedStart = -1;
  for (let index = 0; index < attributeText.length; index += 1) {
    const isIgnorable = consumed[index] || /\s/.test(attributeText[index]);
    if (!isIgnorable && malformedStart === -1) {
      malformedStart = index;
    }
    if ((isIgnorable || index === attributeText.length - 1) && malformedStart !== -1) {
      const endIndex = isIgnorable ? index : index + 1;
      malformedAttributes.push({
        start: contentStart + attributeTextStart + malformedStart,
        end: contentStart + attributeTextStart + endIndex
      });
      malformedStart = -1;
    }
  }

  return {
    name,
    nameRange: { start: nameStart, end: nameEnd },
    attributes,
    attributeRanges,
    duplicateAttributes,
    malformedAttributes
  };
}

function buildJavaPreviewSections(model: TxtJetTemplateModel): { members: JavaPreviewSection; generateMethod: JavaPreviewSection } {
  const members = emptySection();
  const declarations = model.blocks.filter((block) => block.kind === "declaration");
  for (const block of declarations) {
    appendToSection(members, `\n${trimBlockContent(block.content)}\n`, block, "declaration");
  }

  const generateMethod = emptySection();
  appendPlainToSection(generateMethod, "\n    public String generate() {\n");
  appendPlainToSection(generateMethod, "        StringBuilder stringBuffer = new StringBuilder();\n");

  for (const block of model.blocks) {
    if (block.kind === "outer" && block.content.length > 0) {
      appendToSection(generateMethod, `        stringBuffer.append("${escapeJavaString(block.content)}");\n`, block, "append");
    } else if (block.kind === "scriptlet") {
      appendToSection(generateMethod, indentJavaLines(trimBlockContent(block.content), 8), block, "scriptlet");
    } else if (block.kind === "expression") {
      appendToSection(generateMethod, `        stringBuffer.append(${trimExpression(block.content)});\n`, block, "expression");
    }
  }

  appendPlainToSection(generateMethod, "        return stringBuffer.toString();\n");
  appendPlainToSection(generateMethod, "    }\n");
  return { members, generateMethod };
}

function emptySection(): JavaPreviewSection {
  return { text: "", mappings: [] };
}

function appendPlainToSection(section: JavaPreviewSection, text: string): void {
  section.text += text;
}

function appendToSection(
  section: JavaPreviewSection,
  text: string,
  block: TxtJetBlock,
  kind: TxtJetMapping["kind"]
): void {
  const start = section.text.length;
  section.text += text;
  section.mappings.push({ source: block.range, preview: { start, end: start + text.length }, kind });
}

function appendSection(
  output: PreviewTextBuilder,
  mappings: TxtJetMapping[],
  section: JavaPreviewSection,
  budget: PreviewBudget
): void {
  budget.consume("entries", section.mappings.length * 2);
  const start = output.length;
  output.append(section.text);
  for (const mapping of section.mappings) {
    mappings.push({
      ...mapping,
      preview: {
        start: start + mapping.preview.start,
        end: start + mapping.preview.end
      }
    });
  }
}

function appendOffsetProvenance(
  target: TxtJetProvenance[],
  entries: TxtJetProvenance[],
  offset: number
): void {
  for (const entry of entries) {
    target.push({
      ...entry,
      preview: {
        start: entry.preview.start + offset,
        end: entry.preview.end + offset
      }
    });
  }
}

function provenanceFromMappings(
  mappings: TxtJetMapping[],
  sourceFileName: string
): TxtJetProvenance[] {
  return mappings.map((mapping) => ({
    preview: mapping.preview,
    source: mapping.source,
    sourceFileName,
    kind: mapping.kind === "expression" || mapping.kind === "placeholder" ? "expression" : "root",
    confidence: mapping.kind === "expression" || mapping.kind === "placeholder" ? "approximate" : "direct"
  }));
}

function appendSkeletonText(
  output: PreviewTextBuilder,
  provenance: TxtJetProvenance[],
  text: string,
  sourceFileName: string | undefined,
  label: string,
  source: TxtJetRange | undefined,
  budget: PreviewBudget
): void {
  if (text.length === 0) {
    return;
  }
  const start = output.length;
  output.append(text);
  budget.consume("entries");
  provenance.push({
    preview: { start, end: start + text.length },
    kind: "skeleton",
    confidence: "skeleton-rendered",
    sourceFileName,
    label,
    source
  });
}

function readSkeletonTemplate(
  model: TxtJetTemplateModel,
  sourceName: string,
  options: TxtJetJavaPreviewOptions
): { text: string; status: string; usesTokens: boolean; resolved?: string } | undefined {
  const skeletonFile = model.jetDirective?.attributes.skeleton;
  if (!skeletonFile || !options.readSkeleton) {
    return skeletonFile ? { text: "", status: "not loaded", usesTokens: false } : undefined;
  }

  const skeleton = readFirstReference(
    options.sourceFileName ?? sourceName,
    skeletonFile,
    options.skeletonPaths,
    options.readSkeleton
  );
  if (!skeleton.resolved) {
    return { text: "", status: "invalid path", usesTokens: false };
  }

  if (skeleton.text === undefined) {
    return { text: "", status: "unresolved", usesTokens: false, resolved: skeleton.resolved };
  }

  return {
    text: skeleton.text,
    status: "loaded",
    usesTokens: hasSkeletonTokens(skeleton.text),
    resolved: skeleton.resolved
  };
}

function hasSkeletonTokens(text: string): boolean {
  return /\$\{(?:package|packageDeclaration|imports|class|members|generateMethod)\}/.test(text);
}

function buildSkeletonJavaPreview(
  skeletonText: string,
  data: {
    sourceName: string;
    model: TxtJetTemplateModel;
    packageName: string;
    className: string;
    imports: string[];
    members: JavaPreviewSection;
    generateMethod: JavaPreviewSection;
    skeletonFileName?: string;
  },
  budget: PreviewBudget
): TxtJetGeneratedPreview {
  const output = new PreviewTextBuilder(budget);
  const mappings: TxtJetMapping[] = [];
  const skeletonProvenance: TxtJetProvenance[] = [];
  output.append(`// TxtJet generated Java template preview for ${data.sourceName}\n`);
  output.append("// This is an editor approximation rendered through the referenced skeleton.\n\n");
  if (data.model.jetDirective?.attributes.skeleton) {
    appendSkeletonReference(output, mappings, data.model.jetDirective, "loaded");
  }

  const replacements: Record<string, string | JavaPreviewSection> = {
    package: data.packageName,
    packageDeclaration: `package ${data.packageName};`,
    imports: data.imports.map((importName) => `import ${importName};`).join("\n"),
    class: data.className,
    members: data.members,
    generateMethod: data.generateMethod
  };

  const tokenPattern = /\$\{(package|packageDeclaration|imports|class|members|generateMethod)\}/g;
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(skeletonText))) {
    budget.consume("expansions");
    appendSkeletonText(
      output,
      skeletonProvenance,
      skeletonText.slice(offset, match.index),
      data.skeletonFileName,
      "skeleton layout",
      { start: offset, end: match.index },
      budget
    );
    const replacement = replacements[match[1]];
    if (typeof replacement === "string") {
      appendSkeletonText(
        output,
        skeletonProvenance,
        replacement,
        data.skeletonFileName,
        `\${${match[1]}}`,
        { start: match.index, end: match.index + match[0].length },
        budget
      );
    } else {
      appendSection(output, mappings, replacement, budget);
    }
    offset = match.index + match[0].length;
  }
  appendSkeletonText(
    output,
    skeletonProvenance,
    skeletonText.slice(offset),
    data.skeletonFileName,
    "skeleton layout",
    { start: offset, end: skeletonText.length },
    budget
  );
  if (!skeletonText.endsWith("\n")) {
    appendSkeletonText(output, skeletonProvenance, "\n", data.skeletonFileName, "skeleton layout", undefined, budget);
  }

  return {
    text: output.toString(),
    mappings,
    provenance: [
      ...skeletonProvenance,
      ...provenanceFromMappings(mappings, data.sourceName)
    ]
  };
}

function appendSkeletonReference(
  output: PreviewTextBuilder,
  mappings: TxtJetMapping[],
  directive: TxtJetDirective,
  status: string
): void {
  const skeletonRange = directive.attributeRanges.skeleton ?? directive.nameRange;
  const text = `// TxtJet skeleton reference (${status}): ${directive.attributes.skeleton}\n\n`;
  const start = output.length;
  output.append(text);
  mappings.push({ source: skeletonRange, preview: { start, end: start + text.length }, kind: "directive" });
}

function outputPlaceholder(
  block: TxtJetBlock,
  targetLanguage: TxtJetTargetLanguage,
  options: TxtJetOutputPreviewOptions,
  context: ExpressionContext,
  budget?: PreviewBudget
): string {
  switch (block.kind) {
    case "directive":
      if (block.directive?.name === "include") {
        return includePreview(block.directive, targetLanguage, options, budget ?? previewBudget(options.limits)).text;
      }
      return commentPlaceholder(`txtjet directive: ${trimBlockContent(block.content)}`, targetLanguage);
    case "expression":
      return expressionPlaceholder(block.content, targetLanguage, context);
    case "declaration":
      return commentPlaceholder(`txtjet declaration:\n${trimBlockContent(block.content)}`, targetLanguage);
    case "scriptlet":
      return commentPlaceholder(`txtjet scriptlet:\n${trimBlockContent(block.content)}`, targetLanguage);
    case "outer":
    default:
      return block.content;
  }
}

function includePreview(
  directive: TxtJetDirective,
  targetLanguage: TxtJetTargetLanguage,
  options: TxtJetOutputPreviewOptions,
  budget: PreviewBudget
): TxtJetGeneratedPreview {
  budget.consume("expansions");
  const includeFile = directive.attributes.file;
  if (!includeFile || !options.expandIncludes || !options.sourceFileName || !options.readInclude) {
    return syntheticPreview(
      commentPlaceholder(`txtjet include: ${includeFile || "missing file"}`, targetLanguage),
      options,
      directive.nameRange
    );
  }

  const include = readFirstReference(options.sourceFileName, includeFile, options.includePaths, options.readInclude);
  if (!include.resolved) {
    return syntheticPreview(
      commentPlaceholder(`txtjet include skipped: ${includeFile}`, targetLanguage),
      options,
      directive.nameRange
    );
  }

  const includeStack = options.includeStack ?? [normalize(options.sourceFileName)];
  if (includeStack.includes(include.resolved)) {
    return syntheticPreview(
      commentPlaceholder(`txtjet include skipped circular reference: ${includeFile}`, targetLanguage),
      options,
      directive.nameRange
    );
  }
  if (includeStack.length > MAX_INCLUDE_DEPTH) {
    return syntheticPreview(
      commentPlaceholder(`txtjet include skipped max depth: ${includeFile}`, targetLanguage),
      options,
      directive.nameRange
    );
  }

  if (include.text === undefined) {
    return syntheticPreview(
      commentPlaceholder(`txtjet include unresolved: ${includeFile}`, targetLanguage),
      options,
      directive.nameRange
    );
  }

  const nested = buildGeneratedOutputPreviewInternal(include.text, targetLanguage, {
    ...options,
    sourceFileName: include.resolved,
    includeStack: [...includeStack, include.resolved],
    originKind: "include"
  }, budget);
  const begin = commentPlaceholder(`txtjet include begin: ${includeFile}`, targetLanguage);
  const separator = nested.text.endsWith("\n") ? "" : "\n";
  const end = commentPlaceholder(`txtjet include end: ${includeFile}`, targetLanguage);
  const provenance: TxtJetProvenance[] = [{
    preview: { start: 0, end: begin.length },
    kind: "include",
    confidence: "include-expanded",
    sourceFileName: include.resolved,
    label: includeFile
  }];
  appendOffsetProvenance(provenance, nested.provenance, begin.length);
  provenance.push({
    preview: {
      start: begin.length + nested.text.length,
      end: begin.length + nested.text.length + separator.length + end.length
    },
    kind: "include",
    confidence: "include-expanded",
    sourceFileName: include.resolved,
    label: includeFile
  });
  return {
    text: begin + nested.text + separator + end,
    mappings: [],
    provenance
  };
}

function syntheticPreview(
  text: string,
  options: TxtJetOutputPreviewOptions,
  source: TxtJetRange
): TxtJetGeneratedPreview {
  return {
    text,
    mappings: [],
    provenance: [{
      preview: { start: 0, end: text.length },
      source,
      sourceFileName: options.sourceFileName,
      kind: options.originKind ?? "root",
      confidence: options.originKind === "include" ? "include-expanded" : "approximate"
    }]
  };
}

export function previewHeader(kind: "output" | "java", sourceName: string, targetLanguage?: TxtJetTargetLanguage): string {
  const target = targetLanguage ? `, target ${targetPreviewLanguage(targetLanguage)}` : "";
  const label = kind === "java" ? "Generated Java template preview" : "Generated output preview";
  return `${label} for ${basename(sourceName)}${target}. Local read-only editor approximation.`;
}

export function headerComment(kind: "output" | "java", sourceName: string, targetLanguage: TxtJetTargetLanguage): string {
  const text = previewHeader(kind, sourceName, kind === "output" ? targetLanguage : undefined);
  return kind === "java"
    ? `// ${text}\n\n`
    : commentPlaceholder(text, targetLanguage);
}

function expressionPlaceholder(
  expression: string,
  targetLanguage: TxtJetTargetLanguage,
  context: ExpressionContext
): string {
  const trimmed = trimExpression(expression);
  switch (targetLanguage) {
    case "txtjet-java":
    case "txtjet-c":
      return javaLikeExpressionPlaceholder(trimmed, context);
    case "txtjet-python":
      return pythonExpressionPlaceholder(trimmed, context);
    case "txtjet-latex":
      return latexExpressionPlaceholder(trimmed);
    case "txtjet-html":
    case "txtjet-xml":
      return markupExpressionPlaceholder(trimmed, context);
    case "txtjet":
    default:
      return readableExpression(trimmed);
  }
}

function javaLikeExpressionPlaceholder(expression: string, context: ExpressionContext): string {
  if (context.kind === "string" || context.kind === "comment") {
    return readableExpressionValue(expression);
  }
  if (context.kind === "identifier" || context.kind === "macro") {
    return placeholderIdentifier(expression);
  }
  const fallback = placeholderIdentifier(expression);
  return requestsUppercaseValue(expression) ? fallback.toUpperCase() : fallback;
}

function pythonExpressionPlaceholder(expression: string, context: ExpressionContext): string {
  if (context.kind === "string" || context.kind === "comment") {
    return readableExpressionValue(expression);
  }
  if (context.kind === "identifier") {
    const identifier = placeholderIdentifier(expression);
    return looksUppercaseIdentifierContext(context) || requestsUppercaseValue(expression)
      ? identifier.toUpperCase()
      : identifier;
  }
  const fallback = placeholderIdentifier(expression);
  return requestsUppercaseValue(expression) ? fallback.toUpperCase() : fallback;
}

function markupExpressionPlaceholder(expression: string, context: ExpressionContext): string {
  if (context.kind === "html-attribute" || context.kind === "string") {
    return readableExpression(expression);
  }
  if (context.kind === "comment") {
    return readableExpressionValue(expression);
  }
  return readableExpression(expression);
}

function latexExpressionPlaceholder(expression: string): string {
  const sanitized = expression
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `txtjet-${sanitized || "expression"}`;
}

function expressionContextFor(blocks: TxtJetBlock[], index: number): ExpressionContext {
  const before = adjacentOuterText(blocks, index, -1);
  const after = adjacentOuterText(blocks, index, 1);
  if (isInLineComment(before) || isInBlockComment(before, after) || isInMarkupComment(before, after)) {
    return { kind: "comment", before, after };
  }
  if (isInsideOpenQuote(before)) {
    return markupAttributeBefore(before) ? { kind: "html-attribute", before, after } : { kind: "string", before, after };
  }
  if (identifierEdge(before, after) || looksLikeIdentifierSlot(before, after)) {
    return { kind: "identifier", before, after };
  }
  if (isMacroLine(before)) {
    return { kind: "macro", before, after };
  }
  if (looksLikeTextNode(before, after)) {
    return { kind: "text", before, after };
  }
  return { kind: "unknown", before, after };
}

function adjacentOuterText(blocks: TxtJetBlock[], index: number, direction: -1 | 1): string {
  const next = blocks[index + direction];
  return next?.kind === "outer" ? next.content : "";
}

function placeholderIdentifier(expression: string): string {
  const sanitized = expression
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^([^A-Za-z_$])/, "_$1")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `txtjet_${sanitized || "expression"}`;
}

function readableExpression(expression: string): string {
  return `\${${expression}}`;
}

function readableExpressionValue(expression: string): string {
  return `txtjet:${expression}`;
}

function identifierEdge(before: string, after: string): boolean {
  return /[A-Za-z0-9_$]$/.test(before) || /^[A-Za-z0-9_$]/.test(after);
}

function looksLikeIdentifierSlot(before: string, after: string): boolean {
  const line = currentLine(before);
  return /\b[A-Za-z_$][\w$]*(?:<[^>\n]+>)?(?:\[\])?\s+$/.test(line)
    && /^\s*(?:[;=,):\]}]|$)/.test(after);
}

function isInsideOpenQuote(before: string): boolean {
  let quote: string | undefined;
  let escaped = false;
  for (const char of before) {
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
      continue;
    }
    if (quote === char) {
      quote = undefined;
    }
  }
  return Boolean(quote);
}

function markupAttributeBefore(before: string): boolean {
  const line = currentLine(before);
  return /<[^>]*\s[A-Za-z_:][\w:.-]*\s*=\s*["'][^"']*$/.test(line);
}

function isInLineComment(before: string): boolean {
  const line = currentLine(before);
  const slash = line.lastIndexOf("//");
  const hash = line.lastIndexOf("#");
  return slash !== -1 || (hash !== -1 && !/^\s*#\s*(define|include|if|ifdef|ifndef|endif)\b/.test(line));
}

function isInBlockComment(before: string, after: string): boolean {
  const open = before.lastIndexOf("/*");
  const close = before.lastIndexOf("*/");
  return open > close || (open !== -1 && after.includes("*/"));
}

function isInMarkupComment(before: string, after: string): boolean {
  return before.lastIndexOf("<!--") > before.lastIndexOf("-->") || after.includes("-->");
}

function isMacroLine(before: string): boolean {
  return /^\s*#\s*define\b/.test(currentLine(before));
}

function looksLikeTextNode(before: string, after: string): boolean {
  return /(^|>)[^<]*$/.test(before) && /^[^<]*(<|$)/.test(after);
}

function looksUppercaseIdentifierContext(context: ExpressionContext): boolean {
  const beforeToken = (context.before.match(/[A-Za-z0-9_]+$/)?.[0] ?? "");
  const afterToken = (context.after.match(/^[A-Za-z0-9_]+/)?.[0] ?? "");
  const token = `${beforeToken}${afterToken}`;
  return token.length > 0 && token === token.toUpperCase();
}

function requestsUppercaseValue(expression: string): boolean {
  return /\b(toUpperCase|upper)\s*\(/.test(expression);
}

function currentLine(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
}

function commentPlaceholder(text: string, targetLanguage: TxtJetTargetLanguage): string {
  const normalized = normalizeCommentText(text);
  if (!normalized) {
    return "\n";
  }

  switch (targetLanguage) {
    case "txtjet-html":
    case "txtjet-xml":
      return `<!-- ${normalized.replace(/-->/g, "-- >")} -->\n`;
    case "txtjet-python":
      return normalized.split("\n").map((line) => `# ${line}`).join("\n") + "\n";
    case "txtjet-latex":
      return normalized.split("\n").map((line) => `% ${line}`).join("\n") + "\n";
    case "txtjet-java":
    case "txtjet-c":
      return blockComment(normalized);
    case "txtjet":
    default:
      return normalized.split("\n").map((line) => `# ${line}`).join("\n") + "\n";
  }
}

function blockComment(text: string): string {
  const sanitized = text.replace(/\*\//g, "* /");
  const lines = sanitized.split("\n");
  if (lines.length === 1) {
    return `/* ${lines[0]} */\n`;
  }
  return ["/*", ...lines.map((line) => ` * ${line}`), " */", ""].join("\n");
}

function normalizeCommentText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function unescapeDirectiveValue(value: string): string {
  return value.replace(/\\(["'\\])/g, "$1");
}

function indentJavaLines(text: string, spaces: number): string {
  if (!text.trim()) {
    return "";
  }
  const prefix = " ".repeat(spaces);
  return text.split(/\r?\n/).map((line) => `${prefix}${line.trimEnd()}`).join("\n") + "\n";
}

function escapeJavaString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function trimBlockContent(text: string): string {
  return text.replace(/^\s*\r?\n?/, "").replace(/\r?\n?\s*$/, "");
}

function trimExpression(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : "\"\"";
}

function splitImports(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[A-Za-z_][\w]*(?:\.[A-Za-z_*][\w*]*)*$/.test(entry));
}

function sanitizePackageName(value: string | undefined): string | undefined {
  return value && /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(value) ? value : undefined;
}

function sanitizeClassName(value: string | undefined): string | undefined {
  return value && /^[A-Za-z_$][\w$]*$/.test(value) ? value : undefined;
}

function kindForMarker(marker: string): TxtJetBlockKind {
  switch (marker) {
    case "<%@":
      return "directive";
    case "<%=":
      return "expression";
    case "<%!":
      return "declaration";
    case "<%":
    default:
      return "scriptlet";
  }
}

function findNextOpen(text: string, from: number): number {
  return text.indexOf("<%", from);
}

function markerAt(text: string, offset: number): string | undefined {
  return OPEN_MARKERS.find((marker) => text.startsWith(marker, offset));
}

function mapRange(
  mappings: TxtJetMapping[],
  range: TxtJetRange,
  from: "source" | "preview",
  to: "source" | "preview"
): TxtJetRange | undefined {
  let mappedRange: TxtJetRange | undefined;
  for (const mapping of mappings) {
    if (!rangesIntersectOrTouch(mapping[from], range)) {
      continue;
    }

    if (!mappedRange) {
      mappedRange = { start: mapping[to].start, end: mapping[to].end };
      continue;
    }

    mappedRange.start = Math.min(mappedRange.start, mapping[to].start);
    mappedRange.end = Math.max(mappedRange.end, mapping[to].end);
  }

  return mappedRange;
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

function readFirstReference(
  templateFileName: string,
  referenceFile: string,
  searchPaths: string[] | undefined,
  read: ((path: string) => string | undefined) | undefined
): { resolved?: string; text?: string } {
  const candidates = resolveReferenceCandidates(templateFileName, referenceFile, { searchPaths });
  if (candidates.length === 0) {
    return {};
  }
  for (const candidate of candidates) {
    const text = read?.(candidate);
    if (text !== undefined) {
      return { resolved: candidate, text };
    }
  }
  return { resolved: candidates[0] };
}
