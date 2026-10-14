import { opendirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { isPathInsideAnyRoot } from "./extensionSupport";
import { ResourceBudget, ResourceLimitError } from "./resourceBudget";
import { TxtJetIpxactSchemaDocument } from "./ipxactSchema";

export interface SchemaDiscoveryLimits {
  roots: number;
  entries: number;
  files: number;
  depth: number;
  durationMs: number;
  fileBytes: number;
  totalBytes: number;
}

export const DEFAULT_SCHEMA_DISCOVERY_LIMITS: SchemaDiscoveryLimits = {
  roots: 32,
  entries: 10000,
  files: 256,
  depth: 32,
  durationMs: 1000,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024
};

export interface SchemaDiscoveryResult {
  files: string[];
  limited: boolean;
  reason?: string;
  visitedEntries: number;
}

export interface SchemaDocumentReadResult {
  documents: TxtJetIpxactSchemaDocument[];
  limited: boolean;
  reasons: string[];
}

export function discoverIpxactSchemaFiles(
  roots: string[],
  isExcluded: (path: string) => boolean,
  limits: Partial<SchemaDiscoveryLimits> = {},
  now: () => number = Date.now
): SchemaDiscoveryResult {
  const effective = { ...DEFAULT_SCHEMA_DISCOVERY_LIMITS, ...limits };
  const budget = new ResourceBudget({
    "IP-XACT schema roots": effective.roots,
    "IP-XACT schema entries": effective.entries,
    "IP-XACT schema files": effective.files
  });
  const startedAt = now();
  const visited = new Set<string>();
  const files: string[] = [];
  const work: Array<{ candidate: string; root: string; depth: number }> = [];
  let limitedReason: string | undefined;

  try {
    for (const root of [...new Set(roots.map(normalize))]) {
      try {
        budget.consume("IP-XACT schema roots");
      } catch (error) {
        if (error instanceof ResourceLimitError) {
          limitedReason = error.message;
          break;
        }
        throw error;
      }
      work.push({ candidate: normalize(root), root: normalize(root), depth: 0 });
    }
    while (work.length > 0) {
      if (now() - startedAt > effective.durationMs) {
        return limitedResult(files, budget, `IP-XACT schema discovery exceeded ${effective.durationMs} ms.`);
      }
      const current = work.pop();
      if (!current) {
        break;
      }
      if (current.depth > effective.depth) {
        return limitedResult(files, budget, `IP-XACT schema discovery exceeded depth ${effective.depth}.`);
      }
      if (!isPathInsideAnyRoot(current.candidate, [current.root])) {
        continue;
      }
      let canonical: string;
      let stat: ReturnType<typeof statSync>;
      try {
        canonical = realpathSync(current.candidate);
        stat = statSync(current.candidate);
      } catch (error) {
        if (error instanceof ResourceLimitError) {
          throw error;
        }
        continue;
      }
      if (visited.has(canonical)) {
        continue;
      }
      visited.add(canonical);
      if (stat.isFile()) {
        if (current.candidate.toLowerCase().endsWith(".xsd")) {
          budget.consume("IP-XACT schema files");
          files.push(current.candidate);
        }
        continue;
      }
      if (!stat.isDirectory() || isExcluded(current.candidate)) {
        continue;
      }
      const entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }> = [];
      let directory: ReturnType<typeof opendirSync> | undefined;
      try {
        directory = opendirSync(current.candidate);
        let entry: ReturnType<typeof directory.readSync>;
        while ((entry = directory.readSync())) {
          if (now() - startedAt > effective.durationMs) {
            return limitedResult(files, budget, `IP-XACT schema discovery exceeded ${effective.durationMs} ms.`);
          }
          budget.consume("IP-XACT schema entries");
          if (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()) {
            entries.push(entry);
          }
        }
      } catch (error) {
        if (error instanceof ResourceLimitError) {
          throw error;
        }
        continue;
      } finally {
        try {
          directory?.closeSync();
        } catch {
          // The directory may already be closed after a failed read.
        }
      }
      entries.sort((left, right) => right.name.localeCompare(left.name));
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isFile() && !entry.isSymbolicLink()) {
          continue;
        }
        work.push({
          candidate: join(current.candidate, entry.name),
          root: current.root,
          depth: current.depth + 1
        });
      }
    }
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return limitedResult(files, budget, error.message);
    }
    throw error;
  }

  return {
    files: [...new Set(files)].sort(),
    limited: Boolean(limitedReason),
    reason: limitedReason,
    visitedEntries: budget.usage("IP-XACT schema entries")
  };
}

export function readIpxactSchemaDocuments(
  files: string[],
  openText: (fileName: string) => string | undefined,
  limits: Partial<SchemaDiscoveryLimits> = {}
): SchemaDocumentReadResult {
  const effective = { ...DEFAULT_SCHEMA_DISCOVERY_LIMITS, ...limits };
  const budget = new ResourceBudget({ "IP-XACT schema bytes": effective.totalBytes });
  const documents: TxtJetIpxactSchemaDocument[] = [];
  const reasons: string[] = [];

  for (const fileName of files) {
    try {
      const open = openText(fileName);
      if (open !== undefined) {
        const bytes = Buffer.byteLength(open, "utf8");
        if (bytes > effective.fileBytes) {
          reasons.push(`${fileName} exceeds the per-file schema limit of ${effective.fileBytes} bytes.`);
          continue;
        }
        budget.consume("IP-XACT schema bytes", bytes);
        documents.push({ fileName, text: open });
        continue;
      }

      const size = statSync(fileName).size;
      if (size > effective.fileBytes) {
        reasons.push(`${fileName} exceeds the per-file schema limit of ${effective.fileBytes} bytes.`);
        continue;
      }
      budget.consume("IP-XACT schema bytes", size);
      const data = readFileSync(fileName);
      if (data.byteLength > effective.fileBytes) {
        reasons.push(`${fileName} changed beyond the per-file schema limit while being read.`);
        continue;
      }
      if (data.byteLength > size) {
        budget.consume("IP-XACT schema bytes", data.byteLength - size);
      }
      documents.push({ fileName, text: data.toString("utf8") });
    } catch (error) {
      if (error instanceof ResourceLimitError) {
        reasons.push(error.message);
      }
      // Missing, unreadable, and over-budget files are omitted from the partial index.
    }
  }

  return { documents, limited: reasons.length > 0, reasons };
}

function limitedResult(
  files: string[],
  budget: ResourceBudget<"IP-XACT schema roots" | "IP-XACT schema entries" | "IP-XACT schema files">,
  reason: string
): SchemaDiscoveryResult {
  return {
    files: [...new Set(files)].sort(),
    limited: true,
    reason,
    visitedEntries: budget.usage("IP-XACT schema entries")
  };
}
