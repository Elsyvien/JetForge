import { CompilerDiagnostic, CompilerUnit } from "./compilerProtocol";

export function compilerOffsetAt(
  text: string,
  line: number,
  column = 1,
): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) {
      return text.length;
    }
    offset = newline + 1;
  }
  return Math.min(text.length, offset + Math.max(0, column - 1));
}

export function compilerLocationAt(
  text: string,
  offset: number,
): { line: number; column: number } {
  return new CompilerLineIndex(text).locationAt(offset);
}

export class CompilerLineIndex {
  private readonly starts: number[] = [0];
  constructor(private readonly text: string) {
    for (
      let position = text.indexOf("\n");
      position >= 0;
      position = text.indexOf("\n", position + 1)
    ) {
      this.starts.push(position + 1);
    }
  }
  locationAt(offset: number): { line: number; column: number } {
    const safe = Math.max(0, Math.min(this.text.length, offset));
    let low = 0;
    let high = this.starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (this.starts[middle] <= safe) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { line: low + 1, column: safe - this.starts[low] + 1 };
  }
}

const sourceIndexes = new WeakMap<
  CompilerUnit,
  Map<string, CompilerLineIndex>
>();

export function mapJavaDiagnostic(
  unit: CompilerUnit,
  diagnostic: CompilerDiagnostic,
): CompilerDiagnostic {
  if (!diagnostic.javaLine) {
    return diagnostic;
  }
  const offset =
    diagnostic.javaOffset !== undefined && diagnostic.javaOffset >= 0
      ? diagnostic.javaOffset
      : compilerOffsetAt(unit.java, diagnostic.javaLine, diagnostic.column);
  const matches = unit.mappings.filter(
    (mapping) =>
      offset >= mapping.generated.start && offset < mapping.generated.end,
  );
  if (matches.length !== 1) {
    return diagnostic;
  }
  const mapping = matches[0];
  const start = mapping.exact
    ? Math.min(
        mapping.source.end,
        mapping.source.start + offset - mapping.generated.start,
      )
    : mapping.source.start;
  const range = {
    start,
    end: mapping.exact
      ? Math.min(mapping.source.end, start + 1)
      : mapping.source.end,
  };
  let indexes = sourceIndexes.get(unit);
  if (!indexes) {
    indexes = new Map();
    sourceIndexes.set(unit, indexes);
  }
  let index = indexes.get(mapping.fileName);
  if (!index) {
    index = new CompilerLineIndex(
      unit.dependencies.get(mapping.fileName) ?? "",
    );
    indexes.set(mapping.fileName, index);
  }
  return {
    ...diagnostic,
    fileName: mapping.fileName,
    range,
    ...index.locationAt(start),
  };
}
