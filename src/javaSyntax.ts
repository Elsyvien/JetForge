/**
 * Replaces Java comments and quoted literals with spaces while preserving
 * offsets and line endings. Consumers can safely inspect the result without
 * matching identifiers or delimiters inside ignored regions.
 */
export function maskJavaCommentsAndStrings(content: string): string {
  const chars = content.split("");
  let index = 0;

  while (index < chars.length) {
    const char = chars[index];
    const next = chars[index + 1];

    if (char === "/" && next === "/") {
      const start = index;
      index += 2;
      while (index < chars.length && chars[index] !== "\n" && chars[index] !== "\r") {
        index += 1;
      }
      maskRange(chars, start, index);
      continue;
    }

    if (char === "/" && next === "*") {
      const start = index;
      index += 2;
      while (index < chars.length && !(chars[index] === "*" && chars[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(chars.length, index + 2);
      maskRange(chars, start, index);
      continue;
    }

    if (char === "\"" || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      while (index < chars.length) {
        if (chars[index] === "\\") {
          index = Math.min(chars.length, index + 2);
          continue;
        }
        if (chars[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      maskRange(chars, start, index);
      continue;
    }

    index += 1;
  }

  return chars.join("");
}

export function innermostOpenParen(content: string, offset: number): number | undefined {
  let depth = 0;
  for (let index = Math.min(offset - 1, content.length - 1); index >= 0; index -= 1) {
    if (content[index] === ")") {
      depth += 1;
    } else if (content[index] === "(") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return undefined;
}

export function activeParameterIndex(argumentText: string): number {
  let depth = 0;
  let parameter = 0;

  for (const char of argumentText) {
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      parameter += 1;
    }
  }

  return parameter;
}

export function signatureParameterCount(signature: string): number {
  const masked = maskJavaCommentsAndStrings(signature);
  const openingParen = masked.indexOf("(");
  if (openingParen === -1) {
    return 0;
  }

  let nestedDepth = 0;
  let parameterCount = 0;
  let hasParameterContent = false;

  for (let index = openingParen + 1; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === ")" && nestedDepth === 0) {
      return hasParameterContent ? parameterCount + 1 : 0;
    }
    if (char === "(" || char === "[" || char === "{" || char === "<") {
      nestedDepth += 1;
    } else if (char === ")" || char === "]" || char === "}" || char === ">") {
      nestedDepth = Math.max(0, nestedDepth - 1);
    } else if (char === "," && nestedDepth === 0) {
      parameterCount += 1;
    } else if (!/\s/.test(char)) {
      hasParameterContent = true;
    }
  }

  return 0;
}

function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n" && chars[index] !== "\r") {
      chars[index] = " ";
    }
  }
}
