export interface ExternalCommandPlaceholders {
  file: string;
  workspaceFolder: string;
  outputFile: string;
}

export interface ExternalCommandInvocation {
  executable: string;
  args: string[];
}

const PLACEHOLDERS: Array<[token: string, key: keyof ExternalCommandPlaceholders]> = [
  ["${workspaceFolder}", "workspaceFolder"],
  ["${outputFile}", "outputFile"],
  ["${file}", "file"]
];

export class ExternalCommandSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalCommandSyntaxError";
  }
}

/**
 * Parses JetForge's deliberately small executable-and-arguments command syntax.
 * Quotes only group arguments; no shell performs expansion after placeholders are
 * inserted, so workspace-controlled paths remain inert data in every context.
 */
export function parseExternalCommand(
  template: string,
  placeholders: ExternalCommandPlaceholders
): ExternalCommandInvocation {
  const args: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | "\"" | undefined;

  const finishToken = () => {
    if (!tokenStarted) {
      return;
    }
    args.push(token);
    token = "";
    tokenStarted = false;
  };

  for (let offset = 0; offset < template.length;) {
    const placeholder = PLACEHOLDERS.find(([candidate]) => template.startsWith(candidate, offset));
    if (placeholder) {
      token += placeholders[placeholder[1]];
      tokenStarted = true;
      offset += placeholder[0].length;
      continue;
    }

    const character = template[offset];
    if (character === "\0" || character === "\r" || character === "\n") {
      throw new ExternalCommandSyntaxError("External commands cannot contain NUL or line breaks.");
    }
    if (!quote && /\s/.test(character)) {
      finishToken();
      offset += 1;
      continue;
    }
    if (character === "'" || character === "\"") {
      if (!quote) {
        quote = character;
        tokenStarted = true;
        offset += 1;
        continue;
      }
      if (quote === character) {
        quote = undefined;
        offset += 1;
        continue;
      }
    }
    if (character === "\\" && quote !== "'") {
      const next = template[offset + 1];
      if (next && (/\s/.test(next) || "\\'\"|&;<>()`$".includes(next))) {
        token += next;
        tokenStarted = true;
        offset += 2;
        continue;
      }
    }
    if (!quote && "|&;<>()".includes(character)) {
      throw new ExternalCommandSyntaxError(
        `Shell operator ${JSON.stringify(character)} is not supported; configure an executable and arguments instead.`
      );
    }
    if (character === "`" || (character === "$" && template[offset + 1] === "(")) {
      throw new ExternalCommandSyntaxError("Shell command substitution is not supported.");
    }
    if (character === "$" && (template[offset + 1] === "{" || /[A-Za-z_]/.test(template[offset + 1] ?? ""))) {
      throw new ExternalCommandSyntaxError(
        "Shell variable expansion is not supported; use ${file}, ${workspaceFolder}, or ${outputFile}."
      );
    }

    token += character;
    tokenStarted = true;
    offset += 1;
  }

  if (quote) {
    throw new ExternalCommandSyntaxError("External command contains an unterminated quoted argument.");
  }
  finishToken();
  const [executable, ...commandArgs] = args;
  if (!executable) {
    throw new ExternalCommandSyntaxError("External command must include an executable.");
  }
  rejectShellCommandMode(executable, commandArgs);
  return { executable, args: commandArgs };
}

function rejectShellCommandMode(executable: string, args: string[]): void {
  const name = executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  const normalizedArgs = args.map((argument) => argument.toLowerCase());
  const flags = new Set(normalizedArgs);
  const unixShell = ["sh", "bash", "dash", "zsh", "fish"].includes(name);
  const windowsShell = name === "cmd" || name === "cmd.exe";
  const powershell = name === "powershell" || name === "powershell.exe" || name === "pwsh" || name === "pwsh.exe";
  if (
    (unixShell && (normalizedArgs.some((argument) => /^-[^-]*c/.test(argument)) || flags.has("--command")))
    || (windowsShell && (flags.has("/c") || flags.has("/k")))
    || (powershell && (
      flags.has("-c")
      || flags.has("-command")
      || flags.has("-commandwithargs")
      || flags.has("-encodedcommand")
      || flags.has("-ec")
      || flags.has("/c")
    ))
  ) {
    throw new ExternalCommandSyntaxError(
      "Shell command mode is not supported; invoke a wrapper script as a file and pass placeholders as separate arguments."
    );
  }
}
