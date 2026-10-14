"use strict";

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { detectJavaToolchain } = require("../out/javaToolchain");
const root = resolve(__dirname, "..");
const gson = join(root, "runtime/lib/gson-2.14.0.jar");
const digest = createHash("sha256").update(readFileSync(gson)).digest("hex");
if (
  digest !== "2cbd119bf1961c28788310963dc80ba65f58cdeec1dd139c8bdb1240faa2c36f"
)
  throw new Error("Gson runtime checksum mismatch.");
async function main() {
  const jdk = await detectJavaToolchain();
  const tool = (name) =>
    name === "javac"
      ? jdk.javac
      : jdk.java.replace(
          /java(?:\.exe)?$/,
          process.platform === "win32" ? "jar.exe" : "jar",
        );
  const temporary = mkdtempSync(join(tmpdir(), "jetforge-runtime-build-"));
  try {
    const sources = ["ModelContext", "ModelProvider", "Runner"].map((name) =>
      join(root, `runtime/java/dev/jetforge/runtime/${name}.java`),
    );
    execFileSync(
      tool("javac"),
      [
        "--release",
        "21",
        "-encoding",
        "UTF-8",
        "-proc:none",
        "-classpath",
        gson,
        "-d",
        temporary,
        ...sources,
      ],
      { stdio: "inherit" },
    );
    execFileSync(
      tool("jar"),
      [
        "--create",
        "--file",
        join(root, "runtime/jetforge-runtime.jar"),
        "--date",
        "2026-10-13T00:00:00Z",
        "-C",
        temporary,
        ".",
      ],
      { stdio: "inherit" },
    );
    console.log("Java runner built for JDK 21 (pinned Gson verified).");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
