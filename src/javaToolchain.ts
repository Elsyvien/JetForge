import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { MINIMUM_JDK_VERSION } from "./compilerProtocol";

const execute = promisify(execFile);
export interface JavaToolchain {
  java: string;
  javac: string;
  version: number;
  description: string;
}

/** Explicit selection fails closed; stale automatic JAVA_HOME can fall back to PATH. */
export async function detectJavaToolchain(
  selectedHome?: string,
): Promise<JavaToolchain> {
  const explicit = selectedHome || process.env.JETFORGE_JAVA_HOME;
  const homes: Array<string | undefined> = explicit
    ? [explicit]
    : [process.env.JAVA_HOME, undefined];
  if (!explicit && process.platform === "darwin") {
    try {
      homes.push(
        (
          await execute("/usr/libexec/java_home", [], { timeout: 5000 })
        ).stdout.trim(),
      );
    } catch {
      /* PATH may still provide a JDK. */
    }
  }
  for (const home of [...new Set(homes)]) {
    const executable = (name: string): string =>
      home
        ? join(home, "bin", process.platform === "win32" ? `${name}.exe` : name)
        : name;
    try {
      const [runtime, compiler] = await Promise.all([
        execute(executable("java"), ["--version"], {
          timeout: 5000,
          maxBuffer: 65536,
          windowsHide: true,
        }),
        execute(executable("javac"), ["--version"], {
          timeout: 5000,
          maxBuffer: 65536,
          windowsHide: true,
        }),
      ]);
      const version = Number(
        (runtime.stdout + runtime.stderr).match(
          /(?:openjdk|java)\s+(\d+)/,
        )?.[1],
      );
      const compilerVersion = Number(
        (compiler.stdout + compiler.stderr).match(/javac\s+(\d+)/)?.[1],
      );
      if (version >= MINIMUM_JDK_VERSION && compilerVersion === version) {
        return {
          java: executable("java"),
          javac: executable("javac"),
          version,
          description: runtime.stdout.split(/\r?\n/)[0],
        };
      }
    } catch {
      /* Try the next automatic installation. */
    }
  }
  throw new Error(
    `A JDK ${MINIMUM_JDK_VERSION}+ with matching java and javac is required. Set JETFORGE_JAVA_HOME or select a JDK in JetForge settings.${explicit ? ` Selected: ${explicit}.` : ""}`,
  );
}
