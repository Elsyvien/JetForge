# Developing JetForge

Use this guide when changing the extension or shared headless tooling. [Project documentation](README.md) explains architecture, language, and operation; [CONTRIBUTING.md](../CONTRIBUTING.md) describes contribution setup and handoff.

## Locate the change

The extension and CLI share template and project logic. Keep VS Code document, configuration, trust, and UI handling in the editor adapters so shared behavior remains runnable in a terminal.

| Change surface | Start here | Related verification |
| --- | --- | --- |
| Template blocks, directives, include expansion, Java/output projections | `src/templateModel.ts`, `src/scanner.ts` | `templateModel`, `scanner`, `previewExamples` tests |
| Target detection and highlighting | `src/detector.ts`, `syntaxes/`, `language-configuration*.json`, `snippets/` | `detector`, `grammar`, `manifest` tests; editor highlighting scenarios |
| Source origins, cursor mapping, preview refresh | `src/provenance.ts`, `src/previewSync.ts`, `src/previewCache.ts`, `src/asyncRefresh.ts` | Matching tests; unsaved include/skeleton scenarios |
| Local Java helpers and cross-template intelligence | `src/javaIntelliSenseBridge.ts`, `src/javaWorkspaceIntelligence.ts`, `src/javaSyntax.ts` | Matching tests; editor completion/navigation scenarios |
| Workspace dependencies, impact, refactors | `src/workspaceModel.ts`, `src/refactorPlans.ts`; editor adapters in `src/impactGraphView.ts`, `src/refactorCommands.ts` | `workspaceModel`, `refactorPlans` tests; review-plan scenarios |
| Doctor, generation, golden cases, CLI reports | `src/headlessProject.ts`, `src/headlessReports.ts`, `src/cli.ts`; editor adapter in `src/workspaceCommands.ts` | `headlessProject` tests and checked-in compatibility cases |
| Compiler execution, diagnostics, cancellation | `src/externalCommand.ts`, `src/compilerToolchain.ts`, `src/compilerDiagnostics.ts`, `src/validationRuns.ts`; execution in `src/extension.ts` | Matching tests; trust, timeout, superseded-run scenarios |
| Builtin compiler, models, snapshots and targets | `src/txtjetCompiler.ts`, `src/compilerSourceMap.ts`, `src/builtinCompiler.ts`, `src/builtinProject.ts`, `runtime/java/`; editor adapter in `src/builtinEditor.ts` | Compiler/JVM/CLI tests, pinned Eclipse reference, installed-VSIX execution |
| Path containment, output naming, resource limits | `src/extensionSupport.ts`, `src/generationPaths.ts`, `src/resourceBudget.ts` | Matching tests; traversal, symlink, collision, and limit cases |
| Commands, providers, settings, walkthrough | `src/extension.ts`, `package.json`, `walkthrough/` | `manifest` tests, source Extension Host smoke test, relevant QA scenarios |
| Packaging and release | `.vscodeignore`, `scripts/`, `.github/workflows/verify-vsix.yml`, `.github/workflows/publish.yml` | Package hygiene, metadata, installed-VSIX smoke tests |

Test labels above refer to adjacent `src/<name>.test.ts` files. The table is an entry point; follow callers when a change crosses surfaces.

## Behavioral contracts

### Projections and source mappings

Generated-output previews preserve outer text and expand resolvable includes while representing unevaluated expressions with placeholders. Generated Java previews project template Java into a class or configured skeleton. Neither preview evaluates arbitrary Java; real fixture evaluation uses the explicit builtin v2 backend or a configured command-mode golden case. For the model ABI, snapshot/publication contracts and dialect boundaries, read [BUILTIN_COMPILER.md](BUILTIN_COMPILER.md).

Attach navigation, edits, and diagnostics only where a mapping is deterministic. Keep ambiguous or compiler-only output visibly unmapped. Include-expanded and skeleton-rendered content must retain its contributing file and range rather than pointing at an unrelated root-template offset.

For editor previews and refactor plans, read current open buffers before disk content. Dependency edits and topology changes must refresh already-open root previews. Preserve version checks and bounded caches so stale results cannot replace current state.

### Files, configuration, and trust

Resolve editor settings against the affected resource so multi-root folders retain independent resolution, compiler and generation settings. Use the canonical containment helpers in `extensionSupport.ts` for workspace/configured-root checks, including existing symlink ancestors. The headless project contract keeps configured reads and writes inside its project root.

Keep output names collision-free across source directories and template suffixes through `generationPaths.ts`. Validation runs use isolated temporary outputs and clean them after completion; canonical generated files are reserved for explicit generation.

Compiler execution in the editor requires Workspace Trust. Preserve resource budgets and cancellation when extending scans or projections.

### External commands: two execution paths

The paths currently have different command semantics. Preserve and document the distinction when changing either one:

| Path | Current behavior | Placeholders |
| --- | --- | --- |
| Editor compiler in `src/extension.ts` | `parseExternalCommand` parses an executable and arguments, then `execFile` runs without a shell. Quotes group arguments; wrapper scripts handle shell workflows. | `${file}`, `${workspaceFolder}`, `${outputFile}` |
| Command-mode golden cases in `src/headlessProject.ts`, including the editor's golden runner | `substituteCommand` shell-quotes replacement paths, then Node's `exec` runs the configured command through a shell. Treat the command as trusted project code. | The same paths plus `${fixture}` |

The terminal has no VS Code trust dialog. Running command-mode cases executes the configured project command. Inspect unfamiliar project commands before running their golden cases.

### Refactors and baselines

Build reviewable refactor plans from current text and apply only proven reference/Java ranges. An ambiguous mapping must abort the edit rather than partially update a workspace.

Golden expected files are approved outputs. A mismatch needs investigation; update baselines only for a deliberately accepted behavior change. The editor requires confirmation for baseline replacement; the CLI's `test --update` flag explicitly requests it.

## Verification by change

The scripts in [package.json](../package.json) define the commands; this matrix selects which gate answers which question.

| Change | Verification | Completion evidence |
| --- | --- | --- |
| Documentation only | Check relative links and referenced commands against source. Run `npm run check:release-metadata` when release references change. Run package hygiene if adding packaged files or editing `.vscodeignore`. | Links resolve, examples match the implemented path, and package contents remain allowed. |
| Shared TypeScript behavior | `npm test`, then relevant `docs/QA_CHECKLIST.md` scenarios for editor consumers. | Existing unit tests pass; behavioral regressions have focused coverage. |
| Headless behavior or compatibility fixtures | Unit gate plus `npm run verify:headless` after compilation. | Doctor, local validation, and the checked-in golden cases pass without replacing baselines. |
| Grammar, snippets, or manifest | `npm test` and `npm run validate:json`; inspect affected modes in VS Code. | Contribution/grammar checks pass and the actual editor behavior matches. |
| Editor adapters, command wiring, or previews | Unit gate, `npm run test:extension`, and affected QA scenarios. | The extension activates and commands work in a real Extension Host; changed interaction is checked manually. |
| Package contents | Compile first, then `node out/packageHygiene.test.js`; inspect `node node_modules/@vscode/vsce/vsce ls --no-dependencies`. | Runtime modules are present and private, generated, test, and agent-instruction files are excluded. |
| Release preparation | `npm run verify:release`, plus the CI dependency audit and package inspection. Use `VSCODE_TEST_VERSION=1.85.2` for both local smoke paths at the declared floor. | Metadata, coverage/headless/JSON/package gate, source smoke, and installed-VSIX smoke pass; CI checks the packaged artifact on Linux/Windows at floor and stable. |

For a focused core loop, compile once and run the adjacent emitted test, for example:

```sh
npm run compile
node out/templateModel.test.js
```

`compile` replaces `out/`. Edit TypeScript source, then rebuild; emitted files are disposable. The unit runner executes `out/*.test.js` except `extensionHost.test.js` as standalone Node programs. Editor integration uses its separate smoke runner.

`npm run verify` adds enforced coverage, headless checks, JSON validation, and packaging. It does not run either Extension Host smoke path. `npm run verify:release` adds metadata validation and both smoke paths; dependency audit and package-list inspection are separate CI steps.

The source smoke runner uses an installed VS Code when available unless `VSCODE_TEST_VERSION` requests a download. `VSCODE_TEST_EXECUTABLE_PATH` selects an executable for that installed path. The installed-VSIX runner downloads/selects its requested version, defaults to the floor, and accepts `VSIX_PATH` for the artifact. Both use isolated profiles. On headless Linux, use `xvfb-run -a` as CI does. A skipped or failed smoke test is not release verification.

## Documentation ownership

- Installation and feature overview belong in the [main README](../README.md). Detailed architecture, language, headless configuration, and editor workflows belong in the corresponding chapters linked from the [documentation index](README.md). Setting types, defaults, scopes, command IDs, and scripts are authoritative in [package.json](../package.json); consult that manifest instead of maintaining a second inventory.
- Repeatable manual acceptance scenarios belong in [QA_CHECKLIST.md](QA_CHECKLIST.md). Select the branches affected by the change.
- IntelliSense scope/future direction belongs in [INTELLISENSE_ROADMAP.md](INTELLISENSE_ROADMAP.md). A roadmap claim needs confirmation in source before being described as shipped.
- Public behavior changes belong in [CHANGELOG.md](../CHANGELOG.md). Documentation cleanup alone does not need a release entry.

Before handoff, review the diff for unrelated changes and distinguish local checks from CI or published-artifact verification. Contribution completion criteria are in [CONTRIBUTING.md](../CONTRIBUTING.md).
