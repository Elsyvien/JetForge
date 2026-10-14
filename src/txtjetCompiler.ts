import { resolve } from "node:path";
import {
  CompilerDiagnostic,
  CompilerMapping,
  CompilerUnit,
  MAX_COMPILER_INPUT_BYTES,
} from "./compilerProtocol";
import { CompilerLineIndex } from "./compilerSourceMap";
import { maskJavaCommentsAndStrings } from "./javaSyntax";
import { ResourceBudget, ResourceLimitError } from "./resourceBudget";
import { scanTxtJetDirectiveIssues, scanTxtJetIssues } from "./scanner";
import {
  GENERATED_JAVA_DEFAULTS,
  parseTxtJetTemplate,
  resolveReferenceCandidates,
  TxtJetRange,
} from "./templateModel";

export interface TxtJetCompileRequest {
  fileName: string;
  /** The adapter supplies contained, snapshot-consistent text, including open buffers. */
  readFile(fileName: string): string | undefined;
  includePaths?: string[];
  skeletonPaths?: string[];
}

interface Section {
  text: string;
  mappings: CompilerMapping[];
}
const empty = (): Section => ({ text: "", mappings: [] });

/** Pure TxtJet-to-Java frontend; Java checking and execution belong to the runner. */
export function compileTxtJet(request: TxtJetCompileRequest): CompilerUnit {
  const dependencies = new Map<string, string>();
  const missingDependencies = new Set<string>();
  const diagnostics: CompilerDiagnostic[] = [];
  const budget = new ResourceBudget({
    bytes: MAX_COMPILER_INPUT_BYTES,
    files: 256,
    expansions: 512,
    output: 16 * 1024 * 1024,
    tokens: 100000,
    mappings: 100000,
  });
  const parsedFiles = new Map<string, ReturnType<typeof parseTxtJetTemplate>>();
  const validated = new Set<string>();
  const lines = new Map<string, CompilerLineIndex>();
  const root = resolve(request.fileName);
  const read = (fileName: string): string | undefined => {
    if (dependencies.has(fileName)) {
      return dependencies.get(fileName);
    }
    if (missingDependencies.has(fileName)) {
      return undefined;
    }
    budget.consume("tokens");
    const text = request.readFile(fileName);
    if (text !== undefined) {
      budget.consume("bytes", Buffer.byteLength(text));
      budget.consume("files");
      dependencies.set(fileName, text);
    } else {
      missingDependencies.add(fileName);
    }
    return text;
  };
  const issue = (
    code: CompilerDiagnostic["code"],
    message: string,
    fileName: string,
    range: TxtJetRange,
  ): void => {
    if (diagnostics.length < 200) {
      let index = lines.get(fileName);
      if (!index) {
        index = new CompilerLineIndex(dependencies.get(fileName) ?? "");
        lines.set(fileName, index);
      }
      diagnostics.push({
        code,
        message,
        severity: "error",
        fileName,
        range,
        ...index.locationAt(range.start),
      });
    }
  };
  const parse = (
    fileName: string,
    text: string,
  ): ReturnType<typeof parseTxtJetTemplate> => {
    const cached = parsedFiles.get(fileName);
    if (cached) {
      return cached;
    }
    const markers = /<%|%>|\?>/g;
    while (markers.exec(text)) {
      budget.consume("tokens");
    }
    const model = parseTxtJetTemplate(text);
    parsedFiles.set(fileName, model);
    return model;
  };
  const append = (
    section: Section,
    text: string,
    fileName?: string,
    source?: TxtJetRange,
    exact = false,
  ): void => {
    budget.consume("output", text.length);
    const start = section.text.length;
    section.text += text;
    if (fileName && source) {
      budget.consume("mappings");
      section.mappings.push({
        generated: { start, end: start + text.length },
        source,
        fileName,
        exact,
      });
    }
  };
  const join = (into: Section, section: Section): void => {
    const offset = into.text.length;
    into.text += section.text;
    for (const mapping of section.mappings) {
      into.mappings.push({
        ...mapping,
        generated: {
          start: offset + mapping.generated.start,
          end: offset + mapping.generated.end,
        },
      });
    }
  };
  let className: string = GENERATED_JAVA_DEFAULTS.className;
  let packageName: string = GENERATED_JAVA_DEFAULTS.packageName;
  const java = empty();
  const members = empty();
  const body = empty();
  try {
    const rootText = read(root);
    if (rootText === undefined) {
      issue(
        "REFERENCE_ERROR",
        "Template could not be read inside the project.",
        root,
        { start: 0, end: 0 },
      );
    }
    const model = parse(root, rootText ?? "");
    const directive = model.jetDirective;
    className = directive?.attributes.class ?? className;
    packageName = directive?.attributes.package ?? packageName;
    if (
      !/^[A-Za-z_$][\w$]*$/.test(className) ||
      !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(packageName)
    ) {
      issue(
        "TEMPLATE_SYNTAX",
        "Invalid @jet class or package; compiler metadata is not silently replaced.",
        root,
        directive?.nameRange ?? { start: 0, end: 0 },
      );
    }
    const expand = (fileName: string, stack: string[]): void => {
      if (stack.length > 64 || stack.includes(fileName)) {
        issue(
          "REFERENCE_ERROR",
          "Include cycle or depth greater than 64.",
          fileName,
          { start: 0, end: 0 },
        );
        return;
      }
      budget.consume("expansions");
      const text = read(fileName);
      if (text === undefined) {
        issue(
          "REFERENCE_ERROR",
          "Template or include is unreadable.",
          fileName,
          { start: 0, end: 0 },
        );
        return;
      }
      const parsed = parse(fileName, text);
      if (!validated.has(fileName)) {
        for (const problem of [
          ...scanTxtJetIssues(text),
          ...scanTxtJetDirectiveIssues(text),
        ]) {
          issue(
            problem.code === "unknown-directive" ||
              problem.code === "unknown-directive-attribute"
              ? "UNSUPPORTED_SYNTAX"
              : "TEMPLATE_SYNTAX",
            problem.message,
            fileName,
            { start: problem.start, end: problem.end },
          );
        }
        validated.add(fileName);
      }
      if (diagnostics.length) {
        return;
      }
      for (const block of parsed.blocks) {
        if (block.kind === "outer") {
          for (let offset = 0; offset < block.content.length; ) {
            let end = Math.min(block.content.length, offset + 8000);
            const last = block.content.charCodeAt(end - 1);
            const next = block.content.charCodeAt(end);
            if (
              last >= 0xd800 &&
              last <= 0xdbff &&
              next >= 0xdc00 &&
              next <= 0xdfff
            ) {
              end--;
            }
            const value = block.content.slice(offset, end);
            append(
              body,
              `stringBuffer.append(${javaLiteral(value)});\n`,
              fileName,
              {
                start: block.contentRange.start + offset,
                end: block.contentRange.start + offset + value.length,
              },
            );
            offset = end;
          }
        } else if (block.kind === "declaration") {
          append(members, block.content, fileName, block.contentRange, true);
          append(members, "\n");
        } else if (block.kind === "scriptlet") {
          append(body, block.content, fileName, block.contentRange, true);
          append(body, "\n");
        } else if (block.kind === "expression") {
          if (!block.content.trim()) {
            issue(
              "TEMPLATE_SYNTAX",
              "A TxtJet expression cannot be empty.",
              fileName,
              block.range,
            );
            continue;
          }
          append(body, "stringBuffer.append(");
          append(body, block.content, fileName, block.contentRange, true);
          append(body, ");\n");
        } else if (block.directive?.name === "include") {
          const reference = block.directive.attributes.file;
          const candidate =
            reference &&
            resolveReferenceCandidates(fileName, reference, {
              searchPaths: request.includePaths,
            }).find((path) => read(path) !== undefined);
          if (!candidate) {
            issue(
              "REFERENCE_ERROR",
              `Cannot resolve include ${reference ?? ""}.`,
              fileName,
              block.range,
            );
          } else {
            expand(candidate, [...stack, fileName]);
          }
        } else if (block.directive?.name === "jet" && fileName !== root) {
          issue(
            "UNSUPPORTED_SYNTAX",
            "An include fragment must not declare its own @jet class.",
            fileName,
            block.range,
          );
        }
      }
    };
    if (rootText !== undefined) {
      expand(root, []);
    }
    const method = empty();
    append(
      method,
      "public String generate(Object argument) throws Exception {\nStringBuilder stringBuffer = new StringBuilder();\n",
    );
    join(method, body);
    append(method, "return stringBuffer.toString();\n}\n");
    const imports = empty();
    for (const name of (directive?.attributes.imports ?? "")
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      append(
        imports,
        `import ${name};\n`,
        root,
        directive?.attributeRanges.imports,
      );
    }
    const tokens: Record<string, Section> = {
      package: { text: packageName, mappings: [] },
      packageDeclaration: { text: `package ${packageName};`, mappings: [] },
      class: { text: className, mappings: [] },
      imports,
      members,
      generateMethod: method,
    };
    const skeletonReference = directive?.attributes.skeleton;
    if (skeletonReference) {
      const skeletonFile = resolveReferenceCandidates(root, skeletonReference, {
        searchPaths: request.skeletonPaths,
      }).find((path) => read(path) !== undefined);
      const skeletonText = skeletonFile ? read(skeletonFile) : undefined;
      if (!skeletonFile || skeletonText === undefined) {
        issue(
          "REFERENCE_ERROR",
          `Cannot resolve skeleton ${skeletonReference}.`,
          root,
          directive?.attributeRanges.skeleton ?? { start: 0, end: 0 },
        );
      } else if (
        !skeletonText.includes("${generateMethod}") ||
        !skeletonText.includes("${class}")
      ) {
        issue(
          "UNSUPPORTED_SYNTAX",
          "jetforge-v1 supports token skeletons with ${class} and ${generateMethod}; classic Eclipse skeletons require a separate backend.",
          skeletonFile,
          { start: 0, end: skeletonText.length },
        );
      } else {
        const packageHeader = maskJavaCommentsAndStrings(skeletonText)
          .replace(/\$\{packageDeclaration\}/g, `package ${packageName};`)
          .replace(/\$\{package\}/g, packageName)
          .match(/^\s*package\s+([\w$]+(?:\s*\.\s*[\w$]+)*)\s*;/);
        if (packageHeader?.[1].replace(/\s/g, "") !== packageName) {
          issue(
            "UNSUPPORTED_SYNTAX",
            `Skeleton must begin with a declaration of package ${packageName}; use \${packageDeclaration} or package \${package};.`,
            skeletonFile,
            { start: 0, end: 0 },
          );
        }
        const seen = new Set<string>();
        const expression = /\$\{([^}]+)\}/g;
        let offset = 0;
        for (
          let match = expression.exec(skeletonText);
          match;
          match = expression.exec(skeletonText)
        ) {
          append(
            java,
            skeletonText.slice(offset, match.index),
            skeletonFile,
            { start: offset, end: match.index },
            true,
          );
          const section = tokens[match[1]];
          if (!section || seen.has(match[1])) {
            issue(
              "UNSUPPORTED_SYNTAX",
              `Unknown or repeated skeleton token ${match[0]}.`,
              skeletonFile,
              { start: match.index, end: expression.lastIndex },
            );
          } else {
            join(java, section);
            seen.add(match[1]);
          }
          offset = expression.lastIndex;
        }
        append(
          java,
          skeletonText.slice(offset),
          skeletonFile,
          { start: offset, end: skeletonText.length },
          true,
        );
        if (members.text && !seen.has("members")) {
          issue(
            "UNSUPPORTED_SYNTAX",
            "Skeleton must include ${members} when the template declares helpers.",
            skeletonFile,
            { start: 0, end: 0 },
          );
        }
      }
    } else {
      append(java, `package ${packageName};\n`);
      join(java, imports);
      append(java, `public class ${className} {\n`);
      join(java, members);
      join(java, method);
      append(java, "}\n");
    }
  } catch (error) {
    diagnostics.push({
      code:
        error instanceof ResourceLimitError
          ? "RESOURCE_LIMIT"
          : "REFERENCE_ERROR",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    java: java.text,
    qualifiedName: `${packageName}.${className}`,
    className,
    packageName,
    mappings: java.mappings,
    diagnostics,
    dependencies,
    missingDependencies,
  };
}

function javaLiteral(text: string): string {
  return (
    '"' +
    text.replace(/[\x00-\x1f"\\]/g, (character) => {
      const escapes: Record<string, string> = {
        '"': '\\"',
        "\\": "\\\\",
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
      };
      return (
        escapes[character] ??
        `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`
      );
    }) +
    '"'
  );
}
