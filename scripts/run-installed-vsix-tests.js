const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests
} = require("@vscode/test-electron");

function findVsix(root, expectedName) {
  const configured = process.env.VSIX_PATH;
  if (configured) {
    return resolve(configured);
  }
  const matches = readdirSync(root).filter((file) => file.endsWith(".vsix"));
  if (matches.includes(expectedName)) {
    return resolve(root, expectedName);
  }
  if (matches.length === 1) {
    return resolve(root, matches[0]);
  }
  throw new Error(`Expected exactly one VSIX or ${expectedName}; found: ${matches.join(", ") || "none"}`);
}

function runCli(executablePath, args) {
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executablePath, {
    reuseMachineInstall: true
  });
  const result = spawnSync(process.platform === "win32" ? `"${cli}"` : cli, [...cliArgs, ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`VS Code CLI failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

async function main() {
  const root = resolve(__dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const extensionId = `${manifest.publisher}.${manifest.name}`;
  const expectedVsixName = `${manifest.name}-${manifest.version}.vsix`;
  const vsixPath = findVsix(root, expectedVsixName);
  if (!existsSync(vsixPath) || basename(vsixPath) !== expectedVsixName) {
    throw new Error(`Expected packaged artifact ${expectedVsixName}, received ${vsixPath}`);
  }

  const version = process.env.VSCODE_TEST_VERSION || "1.85.2";
  const executablePath = await downloadAndUnzipVSCode({ version });
  const temporaryRoot = mkdtempSync(join(tmpdir(), "jf-vsix-"));
  const userDataDir = join(temporaryRoot, "user-data");
  const extensionsDir = join(temporaryRoot, "extensions");
  const successPath = join(temporaryRoot, "installed-smoke-passed.json");
  const errorPath = join(temporaryRoot, "installed-smoke-error.txt");
  const workspacePath = join(temporaryRoot, "smoke.code-workspace");
  writeFileSync(workspacePath, JSON.stringify({ folders: [
    { path: resolve(root, "examples") },
    { path: resolve(root, "compatibility-projects", "builtin-compiler") }
  ] }));

  try {
    runCli(executablePath, [
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      "--install-extension",
      vsixPath,
      "--force"
    ]);
    const installed = runCli(executablePath, [
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      "--list-extensions",
      "--show-versions"
    ]);
    const expectedInstalled = `${extensionId}@${manifest.version}`.toLowerCase();
    if (!installed.toLowerCase().split(/\r?\n/).includes(expectedInstalled)) {
      throw new Error(`Installed extension list does not contain ${expectedInstalled}:\n${installed}`);
    }

    console.log(`Running installed VSIX smoke test with VS Code ${version}: ${expectedInstalled}`);
    await runTests({
      vscodeExecutablePath: executablePath,
      extensionDevelopmentPath: resolve(__dirname, "vsix-test-harness"),
      extensionTestsPath: resolve(__dirname, "vsix-test-harness", "test.js"),
      extensionTestsEnv: {
        TXTJET_EXPECTED_EXTENSION_ID: extensionId,
        TXTJET_EXPECTED_VERSION: manifest.version,
        TXTJET_TEST_WORKSPACE: root,
        TXTJET_VSIX_TEST_SUCCESS_PATH: successPath,
        TXTJET_VSIX_TEST_ERROR_PATH: errorPath
      },
      launchArgs: [
        workspacePath,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        "--disable-workspace-trust",
        "--disable-updates",
        "--disable-telemetry",
        "--skip-welcome",
        "--skip-release-notes"
      ]
    });
    if (!existsSync(successPath)) { throw new Error("Installed VSIX exited without completing smoke assertions."); }
  } catch (error) {
    if (existsSync(errorPath)) console.error(readFileSync(errorPath, "utf8"));
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Installed VSIX smoke test failed.");
  console.error(error);
  process.exitCode = 1;
});
