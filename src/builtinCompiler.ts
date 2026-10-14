import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  join,
  relative,
  resolve,
} from "node:path";
import {
  BuiltinCompilerResult,
  CompilerDiagnostic,
  COMPILER_PROTOCOL_VERSION,
  MAX_COMPILER_INPUT_BYTES,
  MAX_COMPILER_LOG_BYTES,
  MAX_COMPILER_OUTPUT_BYTES,
} from "./compilerProtocol";
import {
  CompilerLineIndex,
  compilerOffsetAt,
  mapJavaDiagnostic,
} from "./compilerSourceMap";
import { isPathInsideAnyRoot } from "./extensionSupport";
import { detectJavaToolchain } from "./javaToolchain";
import { ResourceLimitError } from "./resourceBudget";
import { compileTxtJet } from "./txtjetCompiler";

export interface BuiltinCompileRequest {
  root: string;
  template: string;
  mode: "compile" | "evaluate";
  includePaths?: string[];
  skeletonPaths?: string[];
  fixture?: string;
  modelProvider?: string;
  classpath?: string[];
  sourceRoots?: string[];
  extraInputs?: string[];
  javaHome?: string;
  release?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  readFile?: (fileName: string) => string | undefined;
  isCurrent?: () => boolean;
  runtimeRoot?: string;
}

/** Shared editor/CLI execution boundary. No VS Code imports and no shell invocation. */
export async function runBuiltinCompiler(
  request: BuiltinCompileRequest,
): Promise<BuiltinCompilerResult> {
  const started = Date.now();
  const result: BuiltinCompilerResult = {
    ok: false,
    mode: request.mode,
    diagnostics: [],
    stdout: "",
    stderr: "",
    durationMs: 0,
  };
  let temporary: string | undefined;
  const fail = (
    code: CompilerDiagnostic["code"],
    message: string,
  ): BuiltinCompilerResult => {
    result.ok = false;
    result.diagnostics.push({ code, message, severity: "error" });
    return result;
  };
  const root = resolve(request.root);
  const contained = (fileName: string): string => {
    const path = resolve(root, fileName);
    if (!isPathInsideAnyRoot(path, [root])) {
      throw new Error(`Configured compiler input escapes project: ${fileName}`);
    }
    return path;
  };
  const read = (fileName: string): string | undefined => {
    const path = contained(fileName);
    const overridden = request.readFile?.(path);
    if (overridden !== undefined) {
      if (Buffer.byteLength(overridden) > MAX_COMPILER_INPUT_BYTES) {
        throw new ResourceLimitError(
          "compiler input bytes",
          MAX_COMPILER_INPUT_BYTES,
        );
      }
      return overridden;
    }
    if (!existsSync(path)) {
      return undefined;
    }
    if (!statSync(path).isFile()) {
      throw new Error("Compiler input must be a regular file.");
    }
    if (statSync(path).size > MAX_COMPILER_INPUT_BYTES) {
      throw new ResourceLimitError(
        "compiler input bytes",
        MAX_COMPILER_INPUT_BYTES,
      );
    }
    return readFileSync(path, "utf8");
  };
  try {
    if (request.signal?.aborted) {
      return fail("CANCELLED", "Compiler run cancelled.");
    }
    if (request.isCurrent?.() === false) {
      return fail(
        "STALE",
        "Project configuration changed before the run started.",
      );
    }
    const template = contained(request.template);
    const unit = compileTxtJet({
      fileName: template,
      readFile: read,
      includePaths: (request.includePaths ?? []).map(contained),
      skeletonPaths: (request.skeletonPaths ?? []).map(contained),
    });
    result.diagnostics.push(...unit.diagnostics);
    if (unit.diagnostics.some((problem) => problem.severity === "error")) {
      return result;
    }
    const runtimeRoot = request.runtimeRoot ?? resolve(__dirname, "../runtime");
    const runtime = join(runtimeRoot, "jetforge-runtime.jar");
    const gson = join(runtimeRoot, "lib/gson-2.14.0.jar");
    if (!existsSync(runtime) || !existsSync(gson)) {
      return fail(
        "RUNNER_ERROR",
        "Built-in runner is missing. Build with npm run build:runtime or reinstall JetForge.",
      );
    }
    let jdk;
    try {
      jdk = await detectJavaToolchain(request.javaHome);
    } catch (error) {
      return fail(
        "JDK_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
      );
    }
    const release = request.release ?? 21;
    if (!Number.isInteger(release) || release < 21 || release > jdk.version) {
      return fail(
        "JDK_UNAVAILABLE",
        `Java release must be between 21 and the selected JDK version ${jdk.version}.`,
      );
    }
    if (
      request.modelProvider &&
      !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(request.modelProvider)
    ) {
      return fail(
        "MODEL_LOAD",
        "modelProvider must be a qualified Java class name.",
      );
    }
    temporary = mkdtempSync(join(tmpdir(), "jetforge-compiler-"));
    const sources: string[] = [];
    const sourceNames: string[] = [];
    const sourceSeen = new Set<string>();
    const sourceRoots = (request.sourceRoots ?? []).map(contained);
    const sourceTraversal = { entries: 0, files: 0 };
    let sourceBytes = [...unit.dependencies.values()].reduce(
      (sum, text) => sum + Buffer.byteLength(text),
      0,
    );
    for (const sourceRoot of sourceRoots) {
      for (const fileName of compilerFiles(
        sourceRoot,
        root,
        sourceTraversal,
      ).filter((path) => path.endsWith(".java"))) {
        if (sourceSeen.has(fileName)) {
          continue;
        }
        sourceSeen.add(fileName);
        const existing = unit.dependencies.get(fileName);
        const text = existing ?? read(fileName);
        if (text === undefined) {
          return fail(
            "REFERENCE_ERROR",
            `Java source disappeared: ${fileName}`,
          );
        }
        if (existing === undefined) {
          sourceBytes += Buffer.byteLength(text);
        }
        if (sourceBytes > 16 * 1024 * 1024) {
          return fail(
            "RESOURCE_LIMIT",
            "Aggregate compiler inputs exceed 16 MiB.",
          );
        }
        unit.dependencies.set(fileName, text);
        const copy = join(
          temporary,
          "project-sources",
          relative(root, fileName),
        );
        mkdirSync(dirname(copy), { recursive: true });
        writeFileSync(copy, text, "utf8");
        sources.push(copy);
        sourceNames.push(fileName);
      }
    }
    sourceNames.sort();
    const currentSourceNames = (): string[] => {
      const traversal = { entries: 0, files: 0 };
      return [
        ...new Set(
          sourceRoots.flatMap((entry) =>
            compilerFiles(entry, root, traversal).filter((path) =>
              path.endsWith(".java"),
            ),
          ),
        ),
      ].sort();
    };
    let fixture: string | undefined;
    let fixturePath: string | undefined;
    if (request.fixture && request.mode === "evaluate") {
      fixturePath = contained(request.fixture);
      const text = read(fixturePath);
      if (text === undefined) {
        return fail("MODEL_LOAD", `Fixture could not be read: ${fixturePath}`);
      }
      fixture = join(temporary, "fixture.json");
      writeFileSync(fixture, text, "utf8");
      unit.dependencies.set(fixturePath, text);
    }
    for (const input of request.extraInputs ?? []) {
      const fileName = contained(input);
      const text = read(fileName);
      if (text !== undefined) {
        unit.dependencies.set(fileName, text);
      }
    }
    const classpath = (request.classpath ?? []).map(contained);
    const materializedClasspath: string[] = [];
    const classpathFingerprint = (copy = false): string => {
      const hash = createHash("sha256");
      let bytes = 0;
      const traversal = { entries: 0, files: 0 };
      for (const [index, entry] of classpath.entries()) {
        const isDirectory = statSync(entry).isDirectory();
        const destination = join(
          temporary!,
          "classpath",
          `${index}-${basename(entry) || "classes"}`,
        );
        if (copy) {
          materializedClasspath.push(destination);
        }
        const files = compilerFiles(entry, root, traversal, (directory) => {
          hash.update(`directory:${directory}\0`);
          if (copy) {
            mkdirSync(join(destination, relative(entry, directory)), {
              recursive: true,
            });
          }
        });
        for (const fileName of files) {
          const size = statSync(fileName).size;
          bytes += size;
          if (size > 64 * 1024 * 1024 || bytes > 256 * 1024 * 1024) {
            throw new ResourceLimitError(
              "classpath bytes (64 MiB per file)",
              256 * 1024 * 1024,
            );
          }
          const data = readFileSync(fileName);
          hash.update(JSON.stringify([fileName, data.length])).update(data);
          if (copy) {
            const path = isDirectory
              ? join(destination, relative(entry, fileName))
              : destination;
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, data);
          }
        }
      }
      return hash.digest("hex");
    };
    const classpathBefore = classpathFingerprint(true);
    const hash = createHash("sha256")
      .update(classpathBefore)
      .update(
        JSON.stringify({
          release,
          provider: request.modelProvider,
          mode: request.mode,
        }),
      );
    let inputBytes = 0;
    for (const [fileName, text] of unit.dependencies) {
      inputBytes += Buffer.byteLength(text);
      if (inputBytes > 16 * 1024 * 1024) {
        return fail(
          "RESOURCE_LIMIT",
          "Aggregate compiler inputs exceed 16 MiB.",
        );
      }
      hash
        .update(JSON.stringify([fileName, Buffer.byteLength(text)]))
        .update(text);
    }
    for (const fileName of unit.missingDependencies) {
      hash.update(JSON.stringify([fileName, null]));
    }
    result.fingerprint = hash.digest("hex");
    const source = join(
      temporary,
      "generator",
      ...unit.packageName.split("."),
      `${unit.className}.java`,
    );
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, unit.java, "utf8");
    const classes = join(temporary, "classes");
    mkdirSync(classes);
    const requestFile = join(temporary, "request.json");
    const resultFile = join(temporary, "result.json");
    writeFileSync(
      requestFile,
      JSON.stringify({
        version: COMPILER_PROTOCOL_VERSION,
        mode: request.mode,
        source,
        sources,
        classes,
        qualifiedName: unit.qualifiedName,
        classpath: [runtime, ...materializedClasspath],
        release,
        fixture,
        fixturePath,
        modelProvider: request.modelProvider,
        projectRoot: root,
      }),
      "utf8",
    );
    const outcome = await compilerProcess(
      jdk.java,
      [
        "-Xmx256m",
        "-Dfile.encoding=UTF-8",
        "-classpath",
        [runtime, gson].join(delimiter),
        "dev.jetforge.runtime.Runner",
        requestFile,
        resultFile,
      ],
      root,
      request.timeoutMs ?? 30000,
      request.signal,
    );
    result.stdout = outcome.stdout;
    result.stderr = outcome.stderr;
    if (outcome.code) {
      return fail(outcome.code, outcome.message);
    }
    if (
      !existsSync(resultFile) ||
      statSync(resultFile).size >
        MAX_COMPILER_OUTPUT_BYTES * 6 + MAX_COMPILER_LOG_BYTES * 12
    ) {
      return fail(
        "RUNNER_ERROR",
        "Runner did not write a bounded result. The template may have exited the JVM.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(resultFile, "utf8"));
    } catch {
      return fail("RUNNER_ERROR", "Runner result is not valid JSON.");
    }
    if (!isRunnerResult(parsed)) {
      return fail("RUNNER_ERROR", "Invalid built-in runner protocol response.");
    }
    result.ok = parsed.ok;
    result.output = parsed.output;
    result.stdout += parsed.stdout;
    result.stderr += parsed.stderr;
    const sourceLines = new Map<string, CompilerLineIndex>();
    result.diagnostics.push(
      ...parsed.diagnostics.map((problem) => {
        if (problem.fileName === source) {
          return mapJavaDiagnostic(unit, { ...problem, fileName: undefined });
        }
        const sourceIndex = problem.fileName
          ? sources.indexOf(problem.fileName)
          : -1;
        if (sourceIndex < 0) {
          return problem;
        }
        const fileName = resolve(
          root,
          relative(join(temporary!, "project-sources"), sources[sourceIndex]),
        );
        const text = unit.dependencies.get(fileName) ?? "";
        const start =
          problem.javaOffset !== undefined && problem.javaOffset >= 0
            ? problem.javaOffset
            : compilerOffsetAt(text, problem.javaLine ?? 1, problem.column);
        let index = sourceLines.get(fileName);
        if (!index) {
          index = new CompilerLineIndex(text);
          sourceLines.set(fileName, index);
        }
        return {
          ...problem,
          fileName,
          ...index.locationAt(start),
          range: { start, end: Math.min(text.length, start + 1) },
        };
      }),
    );
    if (request.signal?.aborted) {
      return fail("CANCELLED", "Compiler run cancelled.");
    }
    result.inputsCurrent = () => {
      try {
        return (
          !request.signal?.aborted &&
          request.isCurrent?.() !== false &&
          [...unit.dependencies].every(
            ([fileName, text]) => read(fileName) === text,
          ) &&
          [...unit.missingDependencies].every((fileName) => read(fileName) === undefined) &&
          classpathFingerprint() === classpathBefore &&
          JSON.stringify(currentSourceNames()) === JSON.stringify(sourceNames)
        );
      } catch {
        return false;
      }
    };
    result.canWriteOutput = (destination) =>
      ![
        ...unit.dependencies.keys(),
        ...classpath,
        ...(request.sourceRoots ?? []).map(contained),
      ].some((input) => isPathInsideAnyRoot(destination, [input]));
    if (!result.inputsCurrent()) {
      result.output = undefined;
      return fail(
        "STALE",
        "An input changed during compilation or evaluation. Run again for the current snapshot.",
      );
    }
    return result;
  } catch (error) {
    return fail(
      error instanceof ResourceLimitError
        ? "RESOURCE_LIMIT"
        : "REFERENCE_ERROR",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (temporary) {
      rmSync(temporary, { recursive: true, force: true });
    }
    result.durationMs = Date.now() - started;
  }
}

interface RunnerResult {
  version: number;
  ok: boolean;
  output?: string;
  stdout: string;
  stderr: string;
  diagnostics: CompilerDiagnostic[];
}
function isRunnerResult(value: unknown): value is RunnerResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as Partial<RunnerResult>;
  return (
    result.version === COMPILER_PROTOCOL_VERSION &&
    typeof result.ok === "boolean" &&
    typeof result.stdout === "string" &&
    typeof result.stderr === "string" &&
    (result.output === undefined || typeof result.output === "string") &&
    Array.isArray(result.diagnostics) &&
    result.diagnostics.length <= 201 &&
    result.diagnostics.every(
      (problem) =>
        typeof problem.message === "string" &&
        typeof problem.code === "string" &&
        (problem.severity === "error" || problem.severity === "warning"),
    )
  );
}

function compilerFiles(
  entry: string,
  root: string,
  budget = { entries: 0, files: 0 },
  directory?: (path: string) => void,
): string[] {
  const files: string[] = [];
  const visit = (path: string, depth: number): void => {
    if (++budget.entries > 10000) {
      throw new ResourceLimitError("compiler dependency entries", 10000);
    }
    if (depth > 64) {
      throw new ResourceLimitError("compiler dependency depth", 64);
    }
    if (!isPathInsideAnyRoot(path, [root])) {
      throw new Error("Compiler dependency traversal escaped its root.");
    }
    const info = statSync(path);
    if (info.isDirectory()) {
      directory?.(path);
      for (const child of readdirSync(path).sort()) {
        visit(join(path, child), depth + 1);
      }
    } else if (info.isFile()) {
      files.push(path);
      if (++budget.files > 5000) {
        throw new ResourceLimitError("compiler dependency files", 5000);
      }
    } else {
      throw new Error(
        "Compiler dependencies must be regular files or directories.",
      );
    }
  };
  visit(entry, 0);
  return files;
}

/** Publish only a successful result, with canonical containment checked again at write time. */
export function publishBuiltinOutput(
  root: string,
  output: string,
  result: BuiltinCompilerResult,
): void {
  if (!result.ok || result.output === undefined) {
    throw new Error("Only successful evaluated results can be generated.");
  }
  if (result.inputsCurrent?.() === false) {
    throw new Error(
      "Compiler inputs changed before publication; result is stale.",
    );
  }
  const destination = resolve(root, output);
  if (result.canWriteOutput?.(destination) === false) {
    throw new Error("Generated output cannot replace a compiler input.");
  }
  if (!isPathInsideAnyRoot(destination, [root])) {
    throw new Error("Output escapes project root.");
  }
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.jetforge-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, result.output, { encoding: "utf8", flag: "wx" });
    if (!isPathInsideAnyRoot(destination, [root])) {
      throw new Error("Output containment changed before publication.");
    }
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

interface ProcessOutcome {
  stdout: string;
  stderr: string;
  code?: CompilerDiagnostic["code"];
  message: string;
}
function compilerProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProcessOutcome> {
  return new Promise((resolveResult) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let code: CompilerDiagnostic["code"] | undefined;
    let message = "";
    let killTimer: NodeJS.Timeout | undefined;
    const killTree = (): void => {
      if (!child.pid) {
        return;
      }
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill("SIGKILL"));
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const stop = (reason: CompilerDiagnostic["code"], text: string): void => {
      if (code) {
        return;
      }
      code = reason;
      message = text;
      killTree();
      killTimer = setTimeout(killTree, 200);
      killTimer.unref();
    };
    const onAbort = (): void => stop("CANCELLED", "Compiler run cancelled.");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
    const timer = setTimeout(
      () => stop("TIMEOUT", "Compiler run exceeded its timeout."),
      Math.min(600000, Math.max(1000, timeoutMs)),
    );
    const capture = (data: Buffer, channel: "stdout" | "stderr"): void => {
      bytes += data.length;
      if (bytes > MAX_COMPILER_LOG_BYTES * 2) {
        stop("RESOURCE_LIMIT", "Process output exceeded its log budget.");
        return;
      }
      if (channel === "stdout") {
        stdout += data.toString("utf8");
      } else {
        stderr += data.toString("utf8");
      }
    };
    child.stdout.on("data", (data: Buffer) => capture(data, "stdout"));
    child.stderr.on("data", (data: Buffer) => capture(data, "stderr"));
    child.on("error", (error) => {
      code = "RUNNER_ERROR";
      message = error.message;
    });
    child.on("close", (status) => {
      if (process.platform !== "win32") {
        killTree();
      }
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      signal?.removeEventListener("abort", onAbort);
      if (!code && status !== 0) {
        code = "RUNNER_ERROR";
        message = `Java runner exited with status ${status}.`;
      }
      resolveResult({ stdout, stderr, code, message });
    });
  });
}
