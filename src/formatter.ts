import { TxtJetBlock } from "./templateModel";

export function formatTxtJetBlock(block: TxtJetBlock): string | undefined {
  if (block.kind === "directive") {
    return formatDirectiveBlock(block);
  }
  if (block.kind === "expression") {
    return ` ${block.content.trim()} `;
  }
  if (block.kind === "scriptlet" || block.kind === "declaration") {
    return formatJavaBlock(block.content);
  }
  return undefined;
}

function formatDirectiveBlock(block: TxtJetBlock): string | undefined {
  const directive = block.directive;
  if (!directive?.name || !/^[A-Za-z_][\w.-]*$/.test(directive.name)) {
    return undefined;
  }

  if (directive.duplicateAttributes.length > 0 || directive.malformedAttributes.length > 0) {
    return undefined;
  }

  const attributes = Object.entries(directive.attributes)
    .map(([name, value]) => `${name}="${value.replace(/"/g, "\\\"")}"`)
    .join(" ");
  return attributes ? ` ${directive.name} ${attributes} ` : ` ${directive.name} `;
}

function formatJavaBlock(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return " ";
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length === 1) {
    return ` ${lines[0].trim()} `;
  }
  let indent = 1;
  const formatted = lines.map((raw) => {
    const line = raw.trim();
    if (/^[})\]]/.test(line)) {
      indent = Math.max(1, indent - 1);
    }
    const result = `${"  ".repeat(indent)}${line}`;
    if (/[{([]\s*$/.test(line) && !/^[})\]]/.test(line)) {
      indent += 1;
    }
    return result;
  });
  return `\n${formatted.join("\n")}\n`;
}
