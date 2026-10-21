# Headless projects, CLI, and golden tests

The `jetforge` CLI provides Doctor checks, structural validation, approximate output generation, and named golden tests. The editor's project commands use the same core. A checked-in `.jetforge.json` makes these operations repeatable on disk.

`generate` and preview-mode golden tests use JetForge's local output projection. Actual template evaluation requires a command-mode case and a project-owned compiler/evaluator. See [Template language](TEMPLATE_LANGUAGE.md) for the projection's limits.

## Run the tool

Inside this repository:

```sh
npm ci
npm run compile
node out/cli.js --help
node out/cli.js doctor
node out/cli.js validate
node out/cli.js test
```

`npm run headless -- doctor` is convenient during development because it recompiles before invoking the CLI. Use `node out/cli.js` after compilation when redirecting machine-readable output; npm's build messages would otherwise be mixed into the report.

In a separate template project, the main README describes installing a tagged Git revision and using `npx jetforge`. Pin a revision so the same implementation is used locally and in CI.

## Editor settings and project configuration

| Configuration | Consumers | Example |
| --- | --- | --- |
| VS Code `txtjet.*` settings | Ordinary editor previews, resource-scoped resolution, compiler validation | `txtjet.resolution.includePaths`, `txtjet.compiler.command` |
| `.jetforge.json` | CLI and shared project commands such as Doctor, local validation, full-workspace generation, and golden cases | `includePaths`, `compiler.command`, `tests` |

The systems are not merged. Configuring `txtjet.compiler.command` does not configure command-mode CLI cases, and configuring `.jetforge.json` does not change the ordinary editor's resolution settings. For shared layouts, set the corresponding search roots in both places.

Shared project commands read saved files. Save template/configuration changes before comparing their results with the editor's live preview.

## Project contract

This chapter describes the preserved **v1** contract. For real compilation,
named targets, model providers, and the v2 configuration, use the
[built-in compiler guide](BUILTIN_COMPILER.md). `compile`, `evaluate`, target-aware
`generate`, and `validate --compiler` select that explicit backend.

```json
{
  "version": 1,
  "sourcePaths": ["templates"],
  "excludePaths": ["templates/archive"],
  "includePaths": ["templates/partials"],
  "skeletonPaths": ["templates/skeletons"],
  "outputDirectory": "generated/jetforge",
  "tests": [
    {
      "name": "greeting-preview",
      "template": "templates/greeting.txtjet",
      "expected": "test/golden/greeting.preview.txt",
      "mode": "preview",
      "targetLanguage": "txtjet"
    }
  ]
}
```

All configured paths are resolved against the project root, not the directory of a custom config file. They must remain inside that root, including canonical symlink containment checks. Paths are concrete files/directories rather than glob patterns; VS Code's `${workspaceFolder}` setting syntax is not expanded in project path fields.

| Project field | Meaning and default |
| --- | --- |
| `version` | Supported contract version is `1`; omission is accepted. Set it explicitly for a checked-in contract. |
| `sourcePaths` | Files/directories to discover recursively. Missing or empty list uses `.`. |
| `excludePaths` | Additional paths/subtrees to exclude during discovery. Default: none. |
| `includePaths` | Extra include-resolution roots. Default: none. |
| `skeletonPaths` | Extra skeleton-resolution roots. Default: none. |
| `outputDirectory` | Persistent approximate generation directory. Default: `generated`. |
| `compiler.command` | Fallback command for command-mode cases lacking their own command. |
| `compiler.timeoutMs` | Fallback command-case timeout. Default: 60,000 ms. |
| `tests` | Named golden cases. Default: none. |

Recognized discovery inputs are template suffixes and `.skeleton` files. Discovered symlink entries are skipped. Built-in excluded directory names include `node_modules`, `out`, `.git`, test-runtime directories, and `private-examples`. Keep output outside `sourcePaths`, or explicitly exclude it, when generated filenames can themselves be recognized as templates. Include/skeleton search roots help resolution; they do not automatically add those directories to discovery.

The loader validates JSON-object shape, supported version, and the tests-array shape; subsequent operations check paths/cases. It is not a complete JSON Schema validator. Use Doctor and validation to inspect a new contract rather than assuming every malformed field is rejected at parse time.

## CLI reference

| Command | Operation | Formats |
| --- | --- | --- |
| `doctor` | Check configuration presence, discovered templates, references, compiler placeholder guidance, output containment, golden cases, and local syntax. | `text`, `json` |
| `validate` | Scan saved templates/includes for template syntax and directive/reference issues. Executes no compiler. | `text`, `json`, `sarif` |
| `generate` | Write approximate output for discovered root templates, expanding includes where readable. Executes no compiler. | `text`, `json` |
| `test` | Run configured golden cases; preview cases transform locally, command cases execute their evaluator. | `text`, `json`, `junit` |

Common options:

| Option | Meaning |
| --- | --- |
| `--root DIR` | Project root; default is the terminal's current directory. |
| `--config FILE` | Config path resolved against that root; default is `.jetforge.json`. A contained absolute config path is also accepted. |
| `--format FORMAT` | Select a supported report format; default is `text`. |
| `--help`, `-h` | Print usage and exit successfully. |
| `--update` | Replace expected baselines; valid only with `test`. |

Examples after compilation:

```sh
node out/cli.js doctor --root /path/to/project
node out/cli.js validate --root /path/to/project --config config/jetforge.json
node out/cli.js validate --format sarif
node out/cli.js test --format junit
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Requested operation succeeded. Doctor warnings alone do not fail the command. |
| `1` | Doctor has failed checks, validation has issues, or the golden run has failed/error cases. |
| `2` | Invalid arguments/configuration or an uncaught operation error. No command without `--help` also returns `2`. |

A missing config is a Doctor warning, not a loader error; default discovery still works. Missing tests yield an empty golden run, so a successful `test` alone does not establish that any template has coverage. Confirm case counts in the report.

## Preview-mode cases

A preview case records the shape of JetForge's approximate output, including placeholder and include-boundary text. `targetLanguage` can override detection for the case. Without it, filename hints and content determine the mode.

```json
{
  "name": "component-shape",
  "template": "templates/Component.javajet",
  "expected": "test/golden/Component.preview.java",
  "mode": "preview",
  "targetLanguage": "txtjet-java"
}
```

Use these cases to catch include/output-projection regressions. They do not prove that Java expressions compile or generate the correct runtime values. The default mode is `preview`.

## Command-mode evaluation

```json
{
  "name": "greeting-from-model",
  "template": "templates/greeting.txtjet",
  "fixture": "test/fixtures/ada.json",
  "expected": "test/golden/greeting.txt",
  "mode": "command",
  "command": "node tools/evaluate.js ${file} ${fixture} ${outputFile}",
  "timeoutMs": 60000
}
```

`tools/evaluate.js` is supplied by your project; it is not a general evaluator bundled with JetForge. The repository's `compatibility-projects/fixture-evaluation/evaluate.js` is a small demonstration that handles `model.<name>` expressions from JSON, not arbitrary JET Java.

The evaluator receives these placeholders:

| Placeholder | Value |
| --- | --- |
| `${file}` | Absolute template path. |
| `${workspaceFolder}` | Absolute project root. |
| `${outputFile}` | Case output path under `.jetforge/run`, to be written by the evaluator. |
| `${fixture}` | Absolute configured fixture path, or an empty value when no fixture is configured. |

JetForge shell-quotes each substituted value; write these placeholder tokens directly in the command rather than surrounding them with another layer of shell quotes. Execution uses the project root as working directory and Node's shell-based `exec`. The command string and any wrapper code are trusted project code; the CLI has no Workspace Trust prompt.

The editor's golden/fixture command handlers and Testing run profile enforce Workspace Trust, as do builtin target and ordinary compiler/validator commands. The terminal has no trust dialog; running configured cases explicitly executes project code.

Before execution, an existing case output is removed. A nonzero process result, timeout, or successful command that fails to write `${outputFile}` is an evaluation error. JetForge reads the output as UTF-8 and removes it after a successful read. Failed runs can leave temporary files; inspect them when diagnosing an evaluator.

Case `command` overrides `compiler.command`. Case `timeoutMs` overrides `compiler.timeoutMs`; supported effective timeouts are clamped between 1,000 and 600,000 ms, with a 60,000 ms fallback. Captured command output is bounded. Cases execute sequentially in the shared runner.

Golden case fields are `name`, `template`, `expected`, optional `mode`, `targetLanguage`, `command`, `fixture`, and `timeoutMs`. Use unique nonempty names and project-contained template/expected/fixture paths. `targetLanguage` controls local preview cases and editor fixture presentation; it does not instruct an external compiler how to evaluate a template.

## Baselines and comparison

Ordinary `test` runs preserve expected files. A missing expected file is a failed case; a content mismatch reports the first differing line. Comparison normalizes CRLF to LF but preserves other whitespace, including trailing newlines.

For a deliberately approved new baseline:

```sh
node out/cli.js test --update
git diff -- test/golden
node out/cli.js test
```

`--update` affects every configured case; the CLI currently has no case-selection flag. It can create missing expected directories/files. Review each updated output before committing it. An update can write some baselines before another case fails, so review the filesystem/diff even after a failed update run.

## Persistent generated files

`generate` writes root templates only, not standalone `.jetinc`/`.skeleton` entries. It preserves each source's directory relative to the project root and retains the complete template filename before appending the target extension:

```text
templates/Component.javajet
  -> generated/jetforge/templates/Component.javajet.java

templates/Component.txtjet   (detected Java output)
  -> generated/jetforge/templates/Component.txtjet.java
```

Existing files at those targets are overwritten. This is independent of golden expected paths; generation does not update baselines or invoke `compiler.command`.

## CI reports

After the build, emit report files without npm build output:

```sh
mkdir -p reports
node out/cli.js validate --format sarif > reports/jetforge-validation.sarif
node out/cli.js test --format junit > reports/jetforge-golden.junit.xml
```

Check command exit codes as well as report presence. SARIF identifies template issues and source locations; JUnit includes named cases, failures, and durations. JSON reports retain structured Doctor checks, generation results, or golden results for custom automation.

The repository's `.jetforge.json` exercises Eclipse-style metadata/skeleton/includes, mixed targets, and a real fixture command. Run its four golden cases to check compatibility without replacing their expected outputs.

For editor equivalents and troubleshooting, continue with [WORKFLOWS.md](WORKFLOWS.md).
