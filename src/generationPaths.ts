import { basename, dirname, extname, join, normalize, relative } from "node:path";
import { isPathInsideAnyRoot } from "./extensionSupport";

export function generatedRelativePath(sourceFileName: string, sourceRoot: string, extension: string): string {
  if (!/^[A-Za-z0-9]+$/.test(extension)) {
    throw new Error(`Invalid generated output extension: ${extension}`);
  }

  const normalizedSource = normalize(sourceFileName);
  const relativeSource = isPathInsideAnyRoot(normalizedSource, [sourceRoot])
    ? relative(sourceRoot, normalizedSource)
    : basename(normalizedSource);
  const relativeDirectory = dirname(relativeSource);
  const generatedName = `${basename(relativeSource)}.${extension}`;
  return relativeDirectory === "." ? generatedName : join(relativeDirectory, generatedName);
}

export function generatedOutputPath(
  sourceFileName: string,
  sourceRoot: string,
  outputRoot: string,
  extension: string
): string | undefined {
  const outputPath = join(outputRoot, generatedRelativePath(sourceFileName, sourceRoot, extension));
  return isPathInsideAnyRoot(outputPath, [outputRoot]) ? outputPath : undefined;
}

export function isolatedValidationOutputPath(
  outputPath: string,
  kind: "compiler" | "ipxact",
  processId: number,
  generation: number
): string {
  if (!Number.isSafeInteger(processId) || processId < 0 || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Validation output identifiers must be safe positive integers.");
  }
  const extension = extname(outputPath);
  const stem = extension ? outputPath.slice(0, -extension.length) : outputPath;
  return `${stem}.${kind}-validation-${processId}-${generation}${extension}`;
}
