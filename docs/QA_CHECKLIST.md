# JetForge QA Checklist

Use sanitized files only. Private workplace templates may be opened locally for validation, but must not be committed or packaged.

## Install And Version

- Run `npm ci` to reproduce the locked dependency tree.
- Run `npm run check:release-metadata` and confirm package, lockfile, changelog, README, QA, tag, and VSIX version references agree.
- Run `VSCODE_TEST_VERSION=1.85.2 npm run verify:release` and confirm the full gate, source Extension Host smoke test, packaging, and clean-profile installed-VSIX smoke test pass at the declared VS Code floor.
- Install the generated `.vsix` with `code --install-extension txtjet-syntax-0.1.0.vsix --force`.
- Confirm VSCode reports `elsyvien.txtjet-syntax@0.1.0`.
- Reload VSCode after install.

## First-Run Experience

- Run `JetForge: Open Getting Started` on VS Code 1.85.2 and current stable; confirm all six walkthrough steps render with their packaged guidance.
- Open an empty folder and confirm `JetForge Workspace` shows links for Getting Started, refresh, and compiler setup instead of a blank tree.
- Run `JetForge: Set Up and Test Compiler Toolchain`; confirm it selects the active workspace folder, explains `${file}`, `${workspaceFolder}`, and `${outputFile}`, saves at the correct workspace/folder scope, and produces a structured success/failure report.
- Repeat compiler setup in Restricted Mode; confirm configuration is allowed but execution remains blocked with a Workspace Trust action.

## Language Modes

- Open each sanitized example in `examples/`.
- Confirm `.txtjet` opens in `TxtJet` mode by default.
- Confirm `.propertiesjet` opens in `TxtJet` mode by default.
- Manually switch to each generated output mode:
  - `TxtJet Java Output`
  - `TxtJet HTML Output`
  - `TxtJet XML Output`
  - `TxtJet C Output`
  - `TxtJet Python Output`
  - `TxtJet LaTeX Output`
- Confirm the status bar shows the selected generated output mode.
- Confirm remembered manual mode survives closing and reopening the file.
- Run `TxtJet: Clear Remembered Target Language` and confirm the file returns to generic mode.

## Highlighting

- Confirm all delimiters are visually distinct:
  - `<%`
  - `<%=`
  - `<%!`
  - `<%@`
  - `%>`
- Confirm Java inside template blocks is highlighted.
- Confirm generated outer text is highlighted for the selected output mode.
- Confirm template blocks inside strings, comments, and C preprocessor-style regions still highlight.
- Confirm template markers, directives, embedded Java, and generated-output regions have distinct subtle editor decorations.
- Run `TxtJet: Toggle Region Background Coloring` and confirm those extra decorations hide/show without changing TextMate highlighting.
- Toggle `txtjet.visualDifferentiation.enabled` directly and confirm the command reflects the same setting.

## Diagnostics And Quick Fixes

- Open `examples/malformed.txtjet`.
- Confirm diagnostics appear for malformed TxtJet syntax.
- Confirm directive diagnostics appear for duplicate `@jet`, missing include `file`, unresolved include paths, malformed attributes, and unknown core directives.
- Confirm Quick Fixes are offered for:
  - unexpected `%>`
  - unclosed `<% ...`
  - empty directives
  - malformed directive names
  - unterminated directive strings
- Confirm disabling `txtjet.diagnostics.enabled` removes diagnostics.
- Confirm disabling `txtjet.codeActions.enabled` removes Quick Fixes.

## Completions And Snippets

- Type `<` outside a template block and confirm TxtJet marker completions appear.
- Confirm normal typing on spaces does not show noisy marker completions.
- Inside `<%@ ... %>`, confirm directive completions for `jet`, `include`, `package`, `class`, `imports`, and `file`.
- Confirm `skeleton` is offered as a directive attribute completion.
- Inside `file=""`, confirm local `.txtjet`/`.jetinc` include path completions appear without listing unrelated file types.
- Inside `skeleton=""`, confirm local `.skeleton` path completions appear.
- Inside `imports=""`, `package=""`, and `class=""`, confirm Java-oriented value completions appear and replace only the active value segment.
- In `examples/sample-java.txtjet`, place the cursor inside generated Java output, type `ret` or press Cmd+Space/Ctrl+Space, and confirm Java fallback suggestions appear.
- In `examples/sample-python.txtjet`, place the cursor in generated Python output and confirm Python keyword/builtin suggestions appear; after `items.ap`, confirm `append` is offered when a local list assignment is present.
- In `examples/sample-c.txtjet` or a C++-style `.cjet` scratch, confirm C/C++ suggestions appear; after `std::co`, confirm `cout` is offered.
- Inside a `<% ... %>` scriptlet, `<%= ... %>` expression, and `<%! ... %>` declaration, confirm Java suggestions appear for identifiers and after `.`.
- Switch the same generated-output region to a non-Java TxtJet mode and confirm Java fallback suggestions are not offered there.
- Confirm snippets appear in every TxtJet mode.
- Confirm disabling `txtjet.completions.enabled` removes TxtJet completions.

## Preview And Navigation

- Run `TxtJet: Open Generated Output Preview` for each sanitized example and confirm the preview preserves outer generated text.
- Confirm `examples/include-main.txtjet` expands `partials/header.txtjet` and `partials/nav.txtjet` in the generated output preview.
- Keep the root generated-output preview open, edit an included file without saving, and confirm the existing preview refreshes immediately from the open buffer instead of stale disk content.
- Run `TxtJet: Open Generated Java Template Preview` and confirm the preview uses `@jet package`, `class`, and `imports` metadata.
- Run `TxtJet: Open Preview Beside Source` and confirm the preview opens beside the template.
- Place the cursor in generated XML/HTML/Python/C/Java/LaTeX output and run `TxtJet: Open Region In Generated Preview`; confirm the mapped generated-output preview region is selected.
- Open generated-output, generated-Java, and IP-XACT previews and confirm every line shows a provenance marker: `R` root, `I` include, `E` expression, `S` skeleton, or `?` unmapped.
- Hover root, include, expression, and skeleton preview lines and confirm the origin and contributing file are explained; run Go to Definition and confirm deterministic origins open at their source range.
- Run `TxtJet: Show Source for This Output Line` and `TxtJet: Show All Contributions for This Output Line`; confirm the primary source opens and composite origins remain individually inspectable.
- Compile a sanitized template with an external tool and confirm uniquely matching output lines inherit provenance while evaluated, repeated, and compiler-only lines show `?` instead of a speculative source.
- Run `TxtJet: Toggle Generated Preview Provenance Lens` and confirm the markers hide/show without changing preview text.
- Place the cursor in a scriptlet, expression, or declaration and run `TxtJet: Open Region In Java Preview`; confirm the mapped generated Java preview region is selected.
- Run `TxtJet: Reveal Generated Output Preview From Source` and confirm the matching preview region is selected.
- Run `TxtJet: Reveal Source From Preview` from an open preview and confirm the matching template region is selected.
- Run `TxtJet: Open Synchronized Preview`, move the cursor through deterministic generated-output regions, and confirm the visible preview selection follows.
- Move the cursor inside the visible generated preview and confirm the source selection follows where mappings exist.
- Run `TxtJet: Toggle Preview Synchronization` and confirm selection synchronization stops/starts without closing the preview.
- Confirm changing the source template refreshes open preview documents.
- Confirm the generated output preview language follows the selected generated-output mode.
- Create a sanitized relative include and confirm Go to Definition from `file="..."` opens it.
- Open `examples/skeleton-directive.txtjet` and confirm Go to Definition from `skeleton="..."` opens `templates/base.skeleton`.
- In a scriptlet or expression that calls a helper declared in `<%! ... %>`, confirm Go to Definition jumps to the helper method name.
- Open `examples/cross-class-consumer.txtjet`, type after `service.`, and confirm completion includes `render` from `cross-class-service.txtjet` even when Java tooling does not index virtual preview documents.
- On the cross-class `render` call, confirm Hover and Signature Help show the service signature and Go to Definition opens the method in `cross-class-service.txtjet`.
- Confirm the CodeLens above `CrossClassConsumer` reports one referenced workspace class and opens a picker that navigates to `CrossClassService`.
- With multiple same-name helper overloads in `<%! ... %>`, confirm Peek Definition shows each local overload.
- Hover a local helper call and confirm the helper signature appears when Java tooling does not provide hover content.
- Run Find All References on a local helper call and confirm the helper declarations plus direct/`this.` calls are listed, excluding comments, strings, and non-local receivers.
- Run Rename Symbol on a local helper declaration and confirm matching direct/`this.` call sites update while comments, strings, and `service.helper(...)` calls do not.
- Trigger Signature Help inside a local helper call and confirm overloads appear with the active parameter moving after commas and ignoring nested-call commas.
- Hover over include and skeleton references and confirm the resolved path/status is shown.
- Open the generated Java preview for `examples/skeleton-directive.txtjet` and confirm the `.skeleton` token layout is used.
- Keep the generated Java preview open, edit the referenced `.skeleton` without saving, and confirm the existing preview refreshes immediately from the open buffer.
- Open `examples/skeleton-nested.txtjet` and confirm nested skeleton resolution works.
- Add a temporary missing `skeleton="..."` reference and confirm a missing-skeleton diagnostic appears.
- Trigger Quick Fix on a missing include or skeleton diagnostic and confirm the referenced file is created locally.
- Add a missing reference such as `../outside.txtjet` and confirm no file-creation Quick Fix can target a path outside the workspace or configured resolution roots.
- Enable `txtjet.diagnostics.generatedJava.enabled`, open a generated Java preview, and confirm Java diagnostics can map back to template ranges where mappings exist.
- Configure `txtjet.compiler.command` with a sanitized local wrapper that emits `generated/sample.java:line:column: error: message` and confirm the default compiler problem matcher maps deterministic diagnostics.
- Configure the wrapper-style matcher `^\\[txtjet\\]\\s+(?<file>.*?):(?<line>\\d+):(?<column>\\d+):\\s*(?<severity>error|warning|info|information|hint):\\s*(?<message>.+)$` and confirm `[txtjet] file:line:column: error: message` output is parsed.
- Set `txtjet.compiler.timeoutMs` to a low value with a slow sanitized wrapper and confirm the external compiler command times out instead of hanging VSCode.
- Start a slow compiler validation, edit/save the template, and start another validation; confirm the superseded process is aborted and cannot restore stale diagnostics.
- Confirm disabling `txtjet.previews.enabled` disables preview commands.
- Confirm disabling `txtjet.previews.generatedJava.enabled` disables the generated Java preview command.
- Confirm disabling `txtjet.navigation.includeDefinitions.enabled` removes include and skeleton Go to Definition.

## Workspace Intelligence

- Open the `JetForge Workspace` Explorer view and confirm only applicable Templates, Includes, Skeletons, Unresolved References, IP-XACT, and Generated Output groups are shown for sanitized examples.
- Run `TxtJet: Refresh Workspace Model` and confirm the tree refreshes without changing files.
- Open an include fragment and run `TxtJet: Open Including Template`; confirm the referencing template opens.
- Open a Generated Output Target in the tree and confirm the target-language generated output opens rather than the generated Java template.
- Run `TxtJet: Open Generated Java For Template` from a template and confirm the generated Java preview opens beside the source.
- Add a temporary unresolved include or skeleton reference, confirm it appears in the workspace tree and editor diagnostics, then open it and confirm its exact directive value range is selected.
- Create the referenced file and confirm the unresolved tree entry and diagnostic disappear after refresh/save.
- Keep a root preview open while creating, deleting, or newly referencing an include; confirm the preview refreshes from the rebuilt dependency topology.
- Run `TxtJet: Validate Workspace Templates` with a sanitized compiler wrapper, cancel partway through, and confirm the summary reports processed, skipped, cancelled, and remaining templates without forcing unmappable diagnostics into source ranges.
- Run `TxtJet: Show Impact Graph` for a template, include, and skeleton; confirm the interactive map supports search, edge filters, source focus, neighbor isolation, pan/zoom, keyboard selection, and direct file opening.
- With an unsaved include-reference edit, run the impact graph and confirm it reflects the current open buffer rather than the last saved model.
- Extract a selection to the default `partials/*.jetinc` path when `partials/` does not exist; confirm the directory and include are created and no unrelated dirty editor is saved.
- Rename or move an include/skeleton into a new workspace directory and confirm every resolved reference is updated before the file move, including a self-reference if present.
- Confirm refactors reject absolute paths, directory-only paths, quotes, line breaks, and targets outside the workspace.
- Confirm rename/move aborts without changing files if any reference range cannot be mapped.
- Create `a/component.txtjet` and `b/component.txtjet`, generate both, and confirm distinct workspace-relative targets are written without either output overwriting the other.
- Create sibling `component.txtjet`, `component.jet`, and `component.javajet` files, generate each, and confirm the original template filename keeps every output collision-free.
- Extract a selection from a `.jetinc` file and confirm the suggested include name strips the source suffix instead of producing `.jetinc.jetinc`.

## IP-XACT

- Set `txtjet.ipxact.enabled` to true.
- Open `examples/ipxact-component.txtjet` and confirm the `JetForge Workspace` Explorer shows it under IP-XACT Templates.
- In a multi-root workspace, enable IP-XACT only for one folder and confirm workspace navigation indexes and opens templates from that folder without requiring the global setting.
- In generated-output XML text, type `<` and confirm IP-XACT node completions appear for `component`, `busInterface`, `memoryMap`, `addressBlock`, `register`, and `field`.
- Configure `txtjet.ipxact.schemaPaths` with a sanitized local XSD, then confirm completions narrow to schema-permitted children and attributes, mark required attributes, preserve a typed namespace prefix, and show XSD documentation.
- Hover a schema-declared element or attribute and run Go to Definition from both the mixed template and IP-XACT preview; confirm the local XSD declaration opens.
- Open the IP-XACT preview Outline and confirm named components, bus interfaces, memory maps, address blocks, registers, and fields form a navigable hierarchy.
- Run `TxtJet: Open IP-XACT Preview` and confirm a read-only XML preview opens beside the template.
- Run `TxtJet: Generate IP-XACT Output` and confirm output is written under `txtjet.ipxact.outputDirectory`.
- Run `TxtJet: Diff Current IP-XACT Output Against Last Generation` after changing the template and confirm the diff opens.
- Configure `txtjet.ipxact.validation.command` with a sanitized wrapper that emits `${outputFile}:line:column: error: message`, run `TxtJet: Validate IP-XACT Output`, and confirm deterministic generated-output diagnostics map back to the template.
- Emit an unexpected-child, disallowed-attribute, invalid-value, or missing-declaration validator message and confirm the mapped diagnostic includes concise guidance, retains the original validator text, and links a configured schema declaration when available.
- Start a slow IP-XACT validation, edit/save the template, and start another validation; confirm the superseded process is aborted and cannot restore stale diagnostics.
- Confirm overlapping IP-XACT validations use isolated temporary output files and clean them after completion instead of overwriting the canonical generated XML.
- Disable `txtjet.ipxact.enabled` and confirm IP-XACT commands are hidden/guarded.

## Workspace Doctor, Golden Tests, And Headless CI

- Run `JetForge: Run Workspace Doctor`; confirm configuration, templates, references, compiler placeholders, output containment, golden cases, and local validation have evidence-backed statuses and focused fixes.
- Run `JetForge: Validate Workspace Locally` and confirm the editor report matches `node out/cli.js validate` for the same `.jetforge.json`.
- Open VS Code’s Testing view and confirm every configured golden case appears under its workspace folder, can run independently, and reports duration plus the first differing line on failure.
- Run `JetForge: Update Golden Output Baselines`; confirm the modal names the destructive batch operation and no baseline changes without explicit confirmation.
- Run `JetForge: Evaluate Named Fixture`; confirm a configured command-mode case opens the real command-produced artifact in a read-only editor and never presents placeholder expressions as evaluated output.
- Run `node out/cli.js doctor`, `validate`, `generate`, and `test`; confirm stable success/failure exit codes and workspace-contained reads/writes.
- Run `node out/cli.js validate --format sarif` and `node out/cli.js test --format junit`; parse both reports and confirm paths, locations, case names, failures, and durations are present.
- Change one compatibility-project template, confirm the corresponding golden case fails, restore it, and confirm all four checked-in cases pass.
- Run `npm run coverage` and confirm the enforced 85% line/statement, 75% branch, and 90% function thresholds pass for the shared core.

## Settings And Privacy

- Open the workspace in Restricted Mode and confirm compiler and IP-XACT validator commands do not execute while highlighting, workspace-local previews, generation, and navigation remain available.
- Configure a schema path outside the workspace and confirm Restricted Mode ignores it while workspace-local XSD intelligence remains available.
- Add `../` and symlink-escape include/skeleton references and confirm previews never read outside the workspace or explicitly configured trusted roots.
- Configure external include/skeleton or output directories from workspace settings and confirm Restricted Mode blocks them until the workspace is trusted.
- Point an output subdirectory through a symlink outside the workspace and confirm generation fails closed; then confirm an explicit external output root works only after the workspace is trusted.
- Toggle `txtjet.statusBar.enabled` and confirm the status bar item hides/shows.
- Run `TxtJet: Toggle Region Background Coloring` and confirm mixed-language region decorations hide/show.
- Set `txtjet.diagnostics.severity` to `error`, `warning`, `information`, and `hint`; confirm diagnostics update.
- Set `txtjet.diagnostics.maxFileSizeKb` to a low value and confirm diagnostics are skipped for larger files.
- Run `node node_modules/@vscode/vsce/vsce ls --no-dependencies` and inspect the package file list.
- Run `npm audit` and confirm production and development dependencies have no known vulnerabilities.
- Run `git diff --check` and confirm tree hygiene is clean.
- Generate snapshots for 21 distinct templates in one workflow and one output larger than 1 MB; confirm only 20 entries are retained, the large output is written without retaining its snapshot, then run `TxtJet: Clear Generated Output Snapshots` and confirm previous diffs are cleared.
- Confirm the package contains no private templates, root-level local `example*` files, generated output folders, Extension Host test sources/runners, `src`, `test-fixtures`, `node_modules`, `.github`, `.playwright-cli`, static site files, logs, or local VSIX files.
- Confirm the package contains only the manifest, README, changelog, license, language configuration, approved product images, docs, examples, snippets, syntaxes, walkthrough guidance, and compiled `out/*.js` files.
