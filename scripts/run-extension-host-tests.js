const { accessSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { delimiter, join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const DEFAULT_TIMEOUT_MS = 120_000;

function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(command) {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = join(directory, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findVSCodeExecutable() {
  const requested = process.env.VSCODE_TEST_EXECUTABLE_PATH;
  if (requested) {
    const requestedPath = requested.includes("/") || requested.includes("\\")
      ? resolve(requested)
      : findOnPath(requested);
    if (!requestedPath || !isExecutable(requestedPath)) {
      throw new Error(`VSCODE_TEST_EXECUTABLE_PATH is not executable: ${requested}`);
    }
    return requestedPath;
  }

  const candidates = process.platform === "darwin"
    ? [
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
      ]
    : process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
          process.env.ProgramFiles && join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe")
        ].filter(Boolean)
      : ["/usr/bin/code", "/usr/local/bin/code", "/snap/bin/code"];

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  const pathExecutable = process.platform === "win32" ? undefined : findOnPath("code");
  if (pathExecutable) {
    return pathExecutable;
  }

  throw new Error(
    "Visual Studio Code was not found. Set VSCODE_TEST_EXECUTABLE_PATH to the Code CLI or executable."
  );
}

function testTimeoutMs() {
  const configured = Number(process.env.VSCODE_TEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000) {
    throw new Error("VSCODE_TEST_TIMEOUT_MS must be a finite number of at least 1000 milliseconds.");
  }
  return configured;
}

function runExtensionTests(executablePath, args, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executablePath, args, {
      cwd: resolve(__dirname, ".."),
      env: process.env,
      stdio: "inherit"
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        rejectRun(new Error(`VS Code extension-host test timed out after ${timeoutMs}ms.`));
      } else if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`VS Code extension-host test exited with code ${code ?? "null"} (${signal || "no signal"}).`));
      }
    });
  });
}

async function main() {
  const extensionDevelopmentPath = resolve(__dirname, "..");
  const extensionTestsPath = resolve(extensionDevelopmentPath, "out", "extensionHost.test.js");

  if (!existsSync(extensionTestsPath)) {
    throw new Error(`Compiled extension-host test not found: ${extensionTestsPath}`);
  }

  const executablePath = findVSCodeExecutable();
  const temporaryRoot = mkdtempSync(join(tmpdir(), "txtjet-vscode-test-"));
  const userDataDir = join(temporaryRoot, "user-data");
  const extensionsDir = join(temporaryRoot, "extensions");
  mkdirSync(userDataDir);
  mkdirSync(extensionsDir);

  const args = [
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
    `--extensionTestsPath=${extensionTestsPath}`,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--disable-updates",
    "--disable-telemetry",
    "--skip-welcome",
    "--skip-release-notes",
    "--wait",
    resolve(extensionDevelopmentPath, "examples")
  ];

  console.log(`Running VS Code extension-host smoke test with: ${executablePath}`);
  try {
    await runExtensionTests(executablePath, args, testTimeoutMs());
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("VS Code extension-host smoke test failed.");
  console.error(error);
  process.exitCode = 1;
});
