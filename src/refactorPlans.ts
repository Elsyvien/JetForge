import { normalize } from "node:path";
import { maskJavaCommentsAndStrings } from "./javaSyntax";
import {
  referencedWorkspaceJavaClasses,
  TxtJetJavaWorkspaceIndex
} from "./javaWorkspaceIntelligence";
import { parseTxtJetTemplate, TxtJetRange } from "./templateModel";

export interface JetForgeTextEdit {
  fileName: string;
  range: TxtJetRange;
  newText: string;
  reason: string;
}

export interface JetForgeFileOperation {
  kind: "create" | "rename";
  fileName: string;
  targetFileName?: string;
  content?: string;
}

export interface JetForgeRefactorPlan {
  title: string;
  summary: string;
  edits: JetForgeTextEdit[];
  fileOperations: JetForgeFileOperation[];
  warnings: string[];
}

const JAVA_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const CONTROL_FLOW_PATTERN = /\b(?:return|break|continue|yield)\b/;
const JAVA_KEYWORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue",
  "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if",
  "implements", "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private",
  "protected", "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this",
  "throw", "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null", "var"
]);

export function planWorkspaceClassRename(
  index: TxtJetJavaWorkspaceIndex,
  targetFileName: string,
  newClassName: string
): JetForgeRefactorPlan {
  if (!JAVA_IDENTIFIER.test(newClassName)) {
    throw new Error("Class name must be a valid Java identifier.");
  }
  const target = index.classForFile(targetFileName);
  if (!target) {
    throw new Error("The selected template does not declare an @jet class.");
  }
  if (target.className === newClassName) {
    throw new Error("The new class name matches the current name.");
  }
  const collision = index.classes.find((entry) =>
    entry.fileName !== target.fileName
    && entry.packageName === target.packageName
    && entry.className === newClassName
  );
  if (collision) {
    throw new Error(`The workspace already declares ${collision.qualifiedName}.`);
  }

  const edits: JetForgeTextEdit[] = [{
    fileName: target.fileName,
    range: target.range,
    newText: newClassName,
    reason: "Rename the @jet class declaration"
  }];
  for (const sourceClass of index.classes) {
    const source = index.source(sourceClass.fileName);
    if (!source) {
      continue;
    }
    const referencesTarget = sourceClass.fileName === target.fileName
      || referencedWorkspaceJavaClasses(index, sourceClass.fileName, source.text).some((entry) => entry.fileName === target.fileName);
    if (!referencesTarget) {
      continue;
    }
    const model = parseTxtJetTemplate(source.text);
    for (const block of model.blocks.filter((entry) => entry.kind === "scriptlet" || entry.kind === "expression" || entry.kind === "declaration")) {
      const masked = maskJavaCommentsAndStrings(block.content);
      collectIdentifierEdits(edits, sourceClass.fileName, masked, block.contentRange.start, target.qualifiedName, `${target.packageName}.${newClassName}`);
      collectIdentifierEdits(edits, sourceClass.fileName, masked, block.contentRange.start, target.className, newClassName);
    }
    const imports = model.jetDirective?.attributes.imports;
    const importsRange = model.jetDirective?.attributeRanges.imports;
    if (imports && importsRange && imports.includes(target.qualifiedName)) {
      const valueRange = attributeValueRange(source.text, importsRange, imports);
      edits.push({
        fileName: sourceClass.fileName,
        range: valueRange,
        newText: imports.split(target.qualifiedName).join(`${target.packageName}.${newClassName}`),
        reason: "Update the @jet imports metadata"
      });
    }
  }
  return normalizePlan({
    title: `Rename workspace class ${target.className} → ${newClassName}`,
    summary: `Update the class declaration and ${edits.length - 1} deterministic workspace reference${edits.length - 1 === 1 ? "" : "s"}.`,
    edits,
    fileOperations: [],
    warnings: ["Comments, strings, unknown external Java sources, and ambiguous symbols are intentionally not changed."]
  });
}

export function planImportCleanup(fileName: string, text: string): JetForgeRefactorPlan {
  const directive = parseTxtJetTemplate(text).jetDirective;
  const imports = directive?.attributes.imports;
  const range = directive?.attributeRanges.imports;
  if (!directive || !imports || !range) {
    throw new Error("The active template has no @jet imports metadata to clean up.");
  }
  const cleaned = Array.from(new Set(imports.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
  if (cleaned === imports) {
    throw new Error("The @jet imports metadata is already normalized.");
  }
  return {
    title: "Clean up @jet imports",
    summary: "Sort imports, remove duplicates, and use one stable comma-separated format.",
    edits: [{ fileName: normalize(fileName), range: attributeValueRange(text, range, imports), newText: cleaned, reason: "Normalize imports" }],
    fileOperations: [],
    warnings: ["JetForge preserves every unique import; it does not guess which imports are unused."]
  };
}

export function planHelperExtraction(
  fileName: string,
  text: string,
  selection: TxtJetRange,
  helperName: string
): JetForgeRefactorPlan {
  if (!JAVA_IDENTIFIER.test(helperName)) {
    throw new Error("Helper name must be a valid Java identifier.");
  }
  const model = parseTxtJetTemplate(text);
  const block = model.blocks.find((entry) =>
    entry.kind === "scriptlet"
    && entry.contentRange.start <= selection.start
    && selection.end <= entry.contentRange.end
  );
  if (!block || selection.start >= selection.end) {
    throw new Error("Select complete Java statements inside one <% ... %> scriptlet block.");
  }
  const selected = text.slice(selection.start, selection.end);
  const masked = maskJavaCommentsAndStrings(selected);
  if (CONTROL_FLOW_PATTERN.test(masked)) {
    throw new Error("The selection changes enclosing control flow and cannot be safely extracted.");
  }
  const unsafe = externalLocalIdentifiers(masked);
  if (unsafe.length > 0) {
    throw new Error(`The selection may depend on local values (${unsafe.slice(0, 4).join(", ")}). Use fields or this.member references before extracting.`);
  }
  const existingHelpers = model.blocks.filter((entry) => entry.kind === "declaration").map((entry) => maskJavaCommentsAndStrings(entry.content)).join("\n");
  if (new RegExp(`\\b${escapeRegExp(helperName)}\\s*\\(`).test(existingHelpers)) {
    throw new Error(`A helper named ${helperName} already exists in this template.`);
  }
  const insertAt = model.jetDirective
    ? model.blocks.find((entry) => entry.directive === model.jetDirective)?.range.end ?? 0
    : 0;
  const body = selected.trim().split(/\r?\n/).map((line) => `    ${line.trimEnd()}`).join("\n");
  const declaration = `\n<%!\nprivate void ${helperName}() {\n${body}\n}\n%>\n`;
  return normalizePlan({
    title: `Extract helper ${helperName}()` ,
    summary: "Move the selected self-contained statements into a private template helper.",
    edits: [
      { fileName: normalize(fileName), range: selection, newText: `${helperName}();`, reason: "Replace selected statements with a helper call" },
      { fileName: normalize(fileName), range: { start: insertAt, end: insertAt }, newText: declaration, reason: "Add the private helper declaration" }
    ],
    fileOperations: [],
    warnings: ["Extraction is offered only when JetForge finds no likely local-variable or enclosing-control-flow dependency."]
  });
}

export function formatRefactorPlanMarkdown(
  plan: JetForgeRefactorPlan,
  readText: (fileName: string) => string | undefined,
  displayPath: (fileName: string) => string
): string {
  const grouped = new Map<string, JetForgeTextEdit[]>();
  for (const edit of plan.edits) {
    const edits = grouped.get(edit.fileName) ?? [];
    edits.push(edit);
    grouped.set(edit.fileName, edits);
  }
  const lines = [
    `# ${plan.title}`,
    "",
    plan.summary,
    "",
    `**${plan.edits.length} text edit${plan.edits.length === 1 ? "" : "s"} · ${plan.fileOperations.length} file operation${plan.fileOperations.length === 1 ? "" : "s"}**`,
    ""
  ];
  if (plan.warnings.length > 0) {
    lines.push("## Safety boundaries", "", ...plan.warnings.map((warning) => `- ${warning}`), "");
  }
  for (const [fileName, edits] of grouped) {
    const text = readText(fileName);
    lines.push(`## ${displayPath(fileName)}`, "");
    if (text === undefined) {
      lines.push("File content is unavailable for preview.", "");
      continue;
    }
    for (const edit of edits.sort((left, right) => left.range.start - right.range.start)) {
      const before = text.slice(edit.range.start, edit.range.end);
      lines.push(`**${edit.reason}**`, "", "```diff", ...diffLines(before, edit.newText), "```", "");
    }
  }
  for (const operation of plan.fileOperations) {
    lines.push(`## ${operation.kind === "create" ? "Create" : "Rename"} ${displayPath(operation.fileName)}`, "");
    if (operation.targetFileName) {
      lines.push(`Target: ${displayPath(operation.targetFileName)}`, "");
    }
  }
  return lines.join("\n");
}

function collectIdentifierEdits(
  edits: JetForgeTextEdit[],
  fileName: string,
  masked: string,
  absoluteStart: number,
  oldName: string,
  newName: string
): void {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(oldName)}(?![A-Za-z0-9_$])`, "g");
  for (const match of masked.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    edits.push({
      fileName,
      range: { start: absoluteStart + match.index, end: absoluteStart + match.index + oldName.length },
      newText: newName,
      reason: "Update a deterministic workspace class reference"
    });
  }
}

function normalizePlan(plan: JetForgeRefactorPlan): JetForgeRefactorPlan {
  const unique = new Map<string, JetForgeTextEdit>();
  for (const edit of plan.edits) {
    unique.set(`${edit.fileName}:${edit.range.start}:${edit.range.end}`, edit);
  }
  const nonOverlapping: JetForgeTextEdit[] = [];
  for (const edit of Array.from(unique.values()).sort((left, right) =>
    left.fileName.localeCompare(right.fileName)
    || left.range.start - right.range.start
    || (right.range.end - right.range.start) - (left.range.end - left.range.start)
  )) {
    if (nonOverlapping.some((candidate) =>
      candidate.fileName === edit.fileName
      && candidate.range.start < edit.range.end
      && edit.range.start < candidate.range.end
    )) {
      continue;
    }
    nonOverlapping.push(edit);
  }
  return {
    ...plan,
    edits: nonOverlapping.sort((left, right) =>
      left.fileName.localeCompare(right.fileName) || right.range.start - left.range.start
    )
  };
}

function externalLocalIdentifiers(masked: string): string[] {
  const declarations = new Set(Array.from(masked.matchAll(/\b(?:byte|short|int|long|float|double|boolean|char|String|var|[A-Z][\w$<>.?]*)\s+([a-z_$][\w$]*)\b/g))
    .map((match) => match[1]));
  const unsafe = new Set<string>();
  for (const match of masked.matchAll(/\b([a-z_$][\w$]*)\b/g)) {
    const name = match[1];
    const index = match.index ?? 0;
    if (JAVA_KEYWORDS.has(name) || declarations.has(name)) {
      continue;
    }
    const before = masked.slice(0, index).trimEnd();
    const after = masked.slice(index + name.length).trimStart();
    if (before.endsWith(".") || after.startsWith("(") || name === "stringBuffer") {
      continue;
    }
    unsafe.add(name);
  }
  return Array.from(unsafe).sort();
}

function attributeValueRange(text: string, attributeRange: TxtJetRange, value: string): TxtJetRange {
  const attribute = text.slice(attributeRange.start, attributeRange.end);
  const offset = attribute.indexOf(value);
  return offset === -1 ? attributeRange : {
    start: attributeRange.start + offset,
    end: attributeRange.start + offset + value.length
  };
}

function diffLines(before: string, after: string): string[] {
  const beforeLines = before.split(/\r?\n/).map((line) => `-${line}`);
  const afterLines = after.split(/\r?\n/).map((line) => `+${line}`);
  return [...beforeLines, ...afterLines];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
