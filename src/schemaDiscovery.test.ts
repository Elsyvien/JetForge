import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverIpxactSchemaFiles, readIpxactSchemaDocuments } from "./schemaDiscovery";

const fixtureRoot = mkdtempSync(join(tmpdir(), "jetforge-schema-discovery-"));
const schemas = join(fixtureRoot, "schemas");
const outside = join(fixtureRoot, "outside");
mkdirSync(join(schemas, "nested"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(schemas, "root.xsd"), "<schema/>");
writeFileSync(join(schemas, "nested", "child.xsd"), "<schema><element/></schema>");
writeFileSync(join(schemas, "nested", "ignored.txt"), "not a schema");
writeFileSync(join(outside, "secret.xsd"), "<secret/>");
if (process.platform !== "win32") {
  symlinkSync(outside, join(schemas, "outside-link"));
}

try {
  const discovered = discoverIpxactSchemaFiles([schemas], () => false);
  assert.deepEqual(discovered.files, [join(schemas, "nested", "child.xsd"), join(schemas, "root.xsd")]);
  assert.equal(discovered.limited, false);

  const entryLimited = discoverIpxactSchemaFiles([schemas], () => false, { entries: 1 });
  assert.equal(entryLimited.limited, true);
  assert.match(entryLimited.reason ?? "", /schema entries exceeded its limit of 1/);
  assert.equal(entryLimited.visitedEntries, 1, "directory enumeration must stop before retaining a second entry");

  const fileLimited = discoverIpxactSchemaFiles([schemas], () => false, { files: 1 });
  assert.equal(fileLimited.limited, true);
  assert.equal(fileLimited.files.length, 1);
  assert.match(fileLimited.reason ?? "", /schema files exceeded its limit of 1/);

  const rootLimited = discoverIpxactSchemaFiles([schemas, outside], () => false, { roots: 1 });
  assert.equal(rootLimited.limited, true);
  assert.match(rootLimited.reason ?? "", /schema roots exceeded its limit of 1/);

  let clock = 0;
  const timeLimited = discoverIpxactSchemaFiles([schemas], () => false, { durationMs: 0 }, () => clock++);
  assert.equal(timeLimited.limited, true);
  assert.match(timeLimited.reason ?? "", /discovery exceeded 0 ms/);

  const depthLimited = discoverIpxactSchemaFiles([schemas], () => false, { depth: 0 });
  assert.equal(depthLimited.limited, true);
  assert.match(depthLimited.reason ?? "", /exceeded depth 0/);

  const documents = readIpxactSchemaDocuments(discovered.files, () => undefined, {
    fileBytes: 1024,
    totalBytes: 1024
  });
  assert.equal(documents.documents.length, 2);
  assert.equal(documents.limited, false);

  const byteLimited = readIpxactSchemaDocuments(discovered.files, (fileName) =>
    fileName.endsWith("root.xsd") ? "x".repeat(20) : undefined,
  { fileBytes: 10, totalBytes: 100 });
  assert.equal(byteLimited.documents.some((document) => document.fileName.endsWith("root.xsd")), false);
  assert.equal(byteLimited.limited, true);
  assert.match(byteLimited.reasons.join("\n"), /per-file schema limit/);

  const aggregateLimited = readIpxactSchemaDocuments(discovered.files, () => undefined, {
    fileBytes: 1024,
    totalBytes: 30
  });
  assert.equal(aggregateLimited.limited, true);
  assert.equal(aggregateLimited.documents.length, 1);
  assert.match(aggregateLimited.reasons.join("\n"), /schema bytes exceeded its limit of 30/);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("schema discovery tests ok");
