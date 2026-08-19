import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseExternalCommand } from "./externalCommand";

const paths = {
  file: "/workspace/templates/$(touch pwn) `also-pwn`.txtjet",
  workspaceFolder: "/workspace/Team Project",
  outputFile: "/workspace/generated/Output File.java"
};

assert.deepEqual(
  parseExternalCommand('java -jar "tools/jet compiler.jar" "${file}" --root=${workspaceFolder} "${outputFile}"', paths),
  {
    executable: "java",
    args: [
      "-jar",
      "tools/jet compiler.jar",
      paths.file,
      `--root=${paths.workspaceFolder}`,
      paths.outputFile
    ]
  }
);
assert.deepEqual(parseExternalCommand('"/Applications/Jet Compiler/bin/jetc" ${file}', paths), {
  executable: "/Applications/Jet Compiler/bin/jetc",
  args: [paths.file]
});
assert.deepEqual(parseExternalCommand("jetc 'literal value' empty=\"\" ${file}", paths), {
  executable: "jetc",
  args: ["literal value", "empty=", paths.file]
});
assert.deepEqual(parseExternalCommand("C:\\Tools\\jetc.exe ${file}", paths), {
  executable: "C:\\Tools\\jetc.exe",
  args: [paths.file]
});

assert.throws(() => parseExternalCommand("jetc ${file} | tee output.log", paths), /Shell operator/);
assert.throws(() => parseExternalCommand("jetc $(cat ${file})", paths), /command substitution/);
assert.throws(() => parseExternalCommand("jetc $HOME/${file}", paths), /variable expansion/);
assert.throws(() => parseExternalCommand("jetc \"${file}", paths), /unterminated/);
assert.throws(() => parseExternalCommand("   ", paths), /executable/);
assert.throws(() => parseExternalCommand('sh -c "jetc ${file}"', paths), /Shell command mode/);
assert.throws(() => parseExternalCommand('bash -lc "jetc ${file}"', paths), /Shell command mode/);
assert.throws(() => parseExternalCommand('cmd.exe /c "jetc ${file}"', paths), /Shell command mode/);
assert.throws(() => parseExternalCommand('pwsh -EncodedCommand "${file}"', paths), /Shell command mode/);
assert.deepEqual(parseExternalCommand("bash ./trusted-wrapper.sh ${file}", paths).args, ["./trusted-wrapper.sh", paths.file]);

const executionRoot = mkdtempSync(join(tmpdir(), "jetforge-external-command-"));
try {
  const marker = join(executionRoot, "shell-side-effect");
  const maliciousFile = `$(touch ${marker})`;
  const invocation = parseExternalCommand(
    '"${workspaceFolder}" -e "process.stdout.write(process.argv[1])" "${file}"',
    { file: maliciousFile, workspaceFolder: process.execPath, outputFile: join(executionRoot, "output") }
  );
  const output = execFileSync(invocation.executable, invocation.args, { encoding: "utf8" });
  assert.equal(output, maliciousFile, "workspace filename must reach the child as one literal argument");
  assert.equal(existsSync(marker), false, "shell command substitution must never execute");
} finally {
  rmSync(executionRoot, { recursive: true, force: true });
}

console.log("external command tests ok");
