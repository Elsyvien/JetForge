# Editor workflows and troubleshooting

This guide connects the main JetForge features into practical tasks. Install/open instructions are in the [main README](../README.md). Exact command contributions and setting defaults are declared in `package.json`; search VS Code Settings for `@ext:elsyvien.txtjet-syntax` to inspect the installed version's settings.

## Inspect a template before compiling

1. Open a template and choose its outer target with **TxtJet: Select Generated Output Mode**. Keep the embedded Java language separate from that choice.
2. Run **TxtJet: Open Preview Beside Source**. Check outer text, include expansion, and expression placeholders.
3. Inspect the provenance marker on a relevant preview line. **TxtJet: Show Source for This Output Line** opens the primary origin; **TxtJet: Show All Contributions for This Output Line** exposes composite origins.
4. Run **TxtJet: Open Generated Java Template Preview** when the question concerns embedded Java rather than output shape.

A local preview is useful when its placeholders are understood. It does not prove compilation or runtime output. An expression marker (`E`) describes an expression origin, not the evaluated value of that expression.

Use **TxtJet: Open Synchronized Preview** for cursor following between visible source and output. Selection reveal is limited to mapped ranges. If a line is unmapped, inspect the origin list or the relevant source directly instead of expecting a forced jump.

## Resolve dependencies and assess an edit

Open **JetForge Workspace** in Explorer. Applicable groups show templates, includes, skeletons, unresolved references, generated targets. An unresolved entry opens its directive value so the path can be corrected.

For a missing reference, confirm the file's relative location and configured search roots. A missing-file Quick Fix can create the file within allowed roots. After creation or a path edit, refresh the model if necessary with **TxtJet: Refresh Workspace Model**. Unsaved include/skeleton changes should already refresh root previews.

Before changing a shared include, run **TxtJet: Show Impact Graph**. Filter edge types and focus the affected file to inspect direct/transitive consumers. **TxtJet: Open Including Template** navigates from a fragment back to a referencing root.

For a move or extraction, use the refactor commands instead of relying on filename edits alone:

- **TxtJet: Extract Selection to Include** creates a fragment and replaces the mapped selection with a reference.
- **TxtJet: Rename or Move Include/Skeleton** plans reference updates and a file operation.
- Java class rename, helper extraction, and import cleanup provide conservative recipes for supported syntax.

Review the plan before applying it. A refused operation can indicate ambiguous references or an unsupported Java selection; narrowing the selection or correcting references is preferable to bypassing the mapping checks.

## Connect a real compiler

Run **JetForge: Set Up and Test Compiler Toolchain** to select the appropriate workspace folder, configure a command, and test it. The compiler is supplied by your project. It must accept an input template and write the intended output to the supplied path.

A representative configuration for a project-owned Node wrapper:

```json
{
  "txtjet.compiler.command": "node tools/compile-template.js ${file} ${outputFile}",
  "txtjet.compiler.timeoutMs": 60000
}
```

`tools/compile-template.js` is an integration wrapper, not a bundled file. Give it absolute `${file}` and `${outputFile}` arguments, invoke the project's real JET/compiler pipeline, and write the resulting artifact at the requested output path. `${workspaceFolder}` is available when the wrapper needs an explicit project root.

Editor commands use executable-and-arguments syntax without shell evaluation. Quotes group arguments for executable paths or literal arguments containing spaces. Shell pipes, redirection, variable expansion, and shell command mode belong in a wrapper script rather than in the setting. Placeholder path values remain child-process arguments.

Use **TxtJet: Compile Template With External Compiler** to inspect real output beside the source. Use **TxtJet: Validate Template With External Compiler** to run validation and populate mapped diagnostics. Both require Workspace Trust. On-save validation is an explicit opt-in through `txtjet.diagnostics.compiler.runOnSave`.

The default problem matcher expects a line such as:

```text
generated/Component.java:12:5: error: incompatible types
```

For a custom matcher, use named `file`, `line`, `column`, `message`, and optional `severity` groups in `txtjet.diagnostics.compiler.problemMatcher`. A wrapper can normalize multi-line compiler output into one problem per line. Generated locations attach to the template only when the source map supports them; inspect the output channel for unmatched or unmappable problems.

Superseded validation is aborted and stale results are discarded. Validation uses temporary outputs distinct from persistent generated files. Diagnose timeouts/cancellation separately from a template compilation failure.

## Run a project contract in the editor

Create `.jetforge.json` as described in [HEADLESS.md](HEADLESS.md), then save files before running these disk-based operations:

| Editor command | Shared operation |
| --- | --- |
| **JetForge: Run Workspace Doctor** | Project configuration/reference/output/golden checks |
| **JetForge: Validate Workspace Locally** | Structural template validation without a compiler |
| **JetForge: Generate All Workspace Outputs** | Approximate output generation for discovered roots |
| **JetForge: Run Golden Output Tests** | Preview and command cases from the project contract |
| **JetForge: Update Golden Output Baselines** | Explicit batch baseline replacement after confirmation |
| **JetForge: Evaluate Named Fixture** | Actual command-mode fixture result in a read-only document |

Configured cases also appear in VS Code's Testing view under the corresponding workspace folder. The project contract determines their inputs; ordinary `txtjet.*` editor settings do not fill in missing headless configuration.

**TxtJet: Validate Workspace Templates** is a different workflow: it runs the editor's configured external compiler across templates and reports processed/skipped/cancelled/remaining counts. Local project validation checks structure, while compiler validation checks what the connected tool reports.

## Generate and compare output

**TxtJet: Generate Output File** writes the current local output approximation under `txtjet.generation.outputDirectory`. Output names retain the relative source directory and original template filename. Use the real compiler workflow when placeholders are insufficient.

**TxtJet: Diff Current Output Against Last Generation** compares current approximate output with a retained local snapshot. **TxtJet: Clear Generated Output Snapshots** removes retained snapshots. Snapshot diffs help local inspection; golden cases provide repeatable checked-in expected output.

## Troubleshooting

| Symptom | Check and next action |
| --- | --- |
| A `.txtjet` opens with the wrong outer mode | Inspect a remembered manual choice. Clear it or select the intended mode; detection is heuristic and gives filename hints priority. |
| A preview still contains expressions or a loop appears once | This is the local projection. Connect the real compiler or use a command-mode golden evaluator for runtime output. |
| Java completion is limited | Check the region and `txtjet.javaIntelliSense.enabled`; install compatible Java tooling. Providers may ignore virtual documents, leaving local fallbacks. |
| An include works in the editor but fails in CLI validation | Align `.jetforge.json` roots with editor resolution settings and ensure the dependency is in discovered sources. Save files first. |
| A shared project command ignores an unsaved edit | Save the file. Shared project operations read disk while ordinary previews can read open buffers. |
| Workspace entries or graph edges are missing | Refresh and inspect the output channel for a partial-index budget message. Narrow source scope and inspect excluded directories. |
| Source reveal does not select a range | Inspect provenance. The output may be approximate, composite, repeated, or unmapped. |
| An external command is unavailable | Check Workspace Trust, the executable, current folder configuration, and placeholder guidance from compiler setup. |
| A shell pipeline fails in the editor setting | Move the workflow into a script and invoke that script with separate path arguments. |
| Compiler output is visible but no source diagnostic appears | Check the matcher and generated path/line/column. A parsed problem can still lack a deterministic source mapping. |
| A command golden case reports no output file | Ensure the evaluator writes to `${outputFile}` and exits successfully; stdout alone is not the generated artifact. |
| A golden case differs only at a line ending or final line | CRLF/LF are normalized; other whitespace and the final newline remain significant. Inspect expected and actual text before updating. |
| `test` succeeds unexpectedly with no coverage | Inspect the case count and the selected root/config; an empty tests list can succeed. |
| A refactor refuses to proceed | Resolve ambiguous references or narrow the selection. The command aborts when it cannot prove every required edit. |

For a reproducible report, include the command/workflow, selected target mode, relevant sanitized configuration, expected behavior, and exact observed error. Use a small sanitized template/include/skeleton set rather than proprietary project content. See [SUPPORT.md](../SUPPORT.md) for reporting channels.
