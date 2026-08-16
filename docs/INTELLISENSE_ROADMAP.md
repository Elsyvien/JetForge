# IntelliSense Roadmap

JetForge currently provides highlighting, parser-backed visual region differentiation, snippets, lightweight diagnostics, guided external-compiler setup and compiler-backed diagnostics, Quick Fixes, completions for TxtJet constructs and configured project metadata, generated-output language modes, read-only generated previews, per-line preview provenance, synchronized reveal for deterministic preview mappings, outline symbols, include navigation, conservative Java IntelliSense forwarding for template Java blocks, local helper References/Rename/Signature Help, workspace-aware cross-class method completion/navigation/signatures, local generated-output fallback suggestions for Java, Python, and C/C++, optional local-XSD IP-XACT intelligence, and workspace-wide TxtJet indexing for templates, includes, skeletons, IP-XACT templates, unresolved references, and generated targets. It does not implement a full Java parser/type checker or provide full generated target-language language-server behavior inside `.txtjet` files.

## Eclipse JET Reference Points

Eclipse EMF JET treats templates as source for generated Java classes. The modern Eclipse JET editor uses an embedded Java editor to provide content assist, quick assist, refactoring, and formatting. It can compile templates in memory, map Java problem markers back to template locations, and show the compiled Java output synchronized with the template.

Useful references:

- Eclipse EMF JET overview: https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet/jet.html
- Eclipse JET tutorial: https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet1/jet_tutorial1.html
- Eclipse Java editor capabilities: https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/concepts/concept-java-editor.htm
- GMF template naming conventions: https://wiki.eclipse.org/Graphical_Modeling_Framework/Development_Guidelines

## Why Full Inline IntelliSense Is Not In The Current Release

VSCode language servers generally operate on one coherent language document. A `.txtjet` file mixes generated output text with Java template code. The current TextMate embedded-language mappings improve highlighting, but they do not automatically give full Java/Python/C/XML/HTML language-server behavior inside mixed template regions.

## Implemented Preview-First Foundation

- Generated output preview
  - Opens a local read-only virtual document for the active template.
  - Preserves generated outer text, expands relative includes, and keeps template code visible as stable language-appropriate comments/placeholders.
  - Uses the selected or detected generated-output language for preview highlighting.

- Generated Java template preview
  - Opens a local read-only virtual Java approximation of the template class.
  - Uses `@jet package`, `class`, and `imports` metadata when available.
  - Falls back to deterministic generated names for invalid or missing metadata.

- Source mapping foundation
  - The transformation layer returns source-to-preview ranges for generated output and generated Java previews.
  - Current mappings support tests, preview refresh behavior, region-aware preview commands, reveal commands between source and preview, synchronized reveal between visible source/preview editors, compiler/IP-XACT diagnostic mapping, and optional generated-Java diagnostic mapping.
  - Every preview line also carries provenance for root-template text, expanded includes, expressions, skeleton tokens/layout, or intentionally unmapped compiler output.
  - The preview lens renders those origins as `R`, `I`, `E`, `S`, and `?`; hover explains direct, include-expanded, skeleton-rendered, approximate, and unmapped confidence, while dedicated source/contribution commands navigate composite lines.
  - Real external-compiler output inherits provenance only when a non-empty line has one unique exact match in the approximation; repeated, evaluated, and compiler-only lines remain visibly unmapped.

- IntelliSense-adjacent editor support
  - Outline symbols summarize directives, declarations, scriptlets, expressions, and generated-output regions.
  - Include `file="..."` references support Go to Definition for relative paths.
  - Directive completions include `skeleton`, `ipxact`, and configured project-specific metadata attributes alongside the existing directive names and attributes.
  - Scriptlet, expression, and declaration blocks can forward completion, hover, and Go to Definition requests through the generated Java preview when installed Java tooling can answer them.
  - Local helper methods declared in `<%! ... %>` blocks support Go to Definition, Find All References, conservative Rename Symbol, Hover fallback signatures, and Signature Help for direct and `this.` call sites.
  - Workspace `@jet class` templates are indexed locally so fields, locals, parameters, constructor expressions, static class calls, and simple return-value chains can complete and navigate to accessible methods declared by other templates.
  - A class-level CodeLens lists referenced workspace template classes and opens their declarations without requiring Java tooling to index virtual preview URIs.
  - Generated-output Java, Python, and C/C++ regions provide deterministic local fallback suggestions for common keywords, builtins, and standard-library members.
  - Parser-backed region classification distinguishes generated output, TxtJet markers, directives, and embedded template Java for editor decorations and fallback hover text.

- Workspace resolution, formatting, and generation helpers
  - The `JetForge Workspace` Explorer view indexes root templates, `.jetinc` include fragments, `.skeleton` files, opt-in IP-XACT templates, unresolved references, generated target entries, and include backlinks.
  - Include and skeleton references can resolve through configured workspace search paths and extensionless `.txtjet`, `.jetinc`, and `.skeleton` candidates.
  - Rendered impact reports trace direct and transitive reverse dependencies to affected templates and generated targets.
  - Conservative include/skeleton refactors rebuild from open buffers, reject unsafe paths, and update only deterministically mapped references.
  - Generated output and Java previews prefer unsaved open include/skeleton buffers over stale on-disk content and refresh already-open root previews when those dependencies change.
  - Resource-scoped resolution, compiler, generation, and IP-XACT settings keep folders independent in multi-root workspaces.
  - Reverse-reference indexes, coalesced refreshes, impacted-preview invalidation, and bounded mapping caches avoid repeated whole-workspace work during event bursts.
  - Include/skeleton reads are contained to the workspace or explicit configured roots, including canonical `..` and symlink checks.
  - Document formatting and format selection normalize directive attributes, expressions, and template Java block indentation.
  - On-demand generation preserves workspace-relative source directories and original template filenames, prevents same-stem collisions across every TxtJet suffix, and can diff against bounded local generation snapshots.
  - Large mixed templates use linear preview text construction so preview generation does not block the Extension Host quadratically.

- Compiler-backed diagnostics
  - `JetForge: Set Up and Test Compiler Toolchain` guides workspace/folder-scoped command configuration, placeholder checks, trust handling, cancellation, and an isolated test run.
  - `TxtJet: Validate Template With External Compiler` runs the configured compiler command, parses stdout/stderr with a configurable problem matcher, and maps generated Java/output locations back into `.txtjet` ranges where the preview source map is deterministic.
  - Workspace validation is cancellable and emits a structured processed/clean/failed/diagnostic/skipped/remaining summary.
  - Optional on-save validation is available but disabled by default so compiler cost stays under workspace control.
  - Per-document run generations abort superseded compiler/IP-XACT validations and discard results if the document changed or closed.
  - Compiler and IP-XACT validation runs use isolated temporary outputs so overlapping runs cannot overwrite each other's inputs or canonical generated files.

- Release verification
  - A real Extension Host smoke test activates the compiled extension in an isolated VS Code Extension Host, checks every contributed command and language, opens a sanitized template, and executes a generated-preview command.
  - The packaged VSIX is installed into clean profiles and smoke-tested on Linux and Windows against VS Code 1.85.2 and current stable before that exact checksummed artifact can publish.

- Opt-in IP-XACT workflows
  - `txtjet.ipxact.enabled` gates IP-XACT preview, generation, diff, validation, snippets, completions, and workspace indexing.
  - Templates can opt in through `@jet ipxact="true"` or configured globs.
  - Validation runs an external command and maps generated XML diagnostics back to source only where generated-output mappings are deterministic.
  - Optional resource-scoped `txtjet.ipxact.schemaPaths` index local XSD files and directories for permitted-child and attribute completions, XSD documentation hovers, and Go to Definition from templates and previews.
  - Recognized validator messages gain a short schema-focused explanation and corrective guidance while preserving the original validator output.

- Team-scale verification and safe change workflows
  - `.jetforge.json` is a checked-in project contract for source roots, resolution paths, generated output, and named golden cases.
  - Workspace Doctor, local validation, full-workspace generation, and golden output tests share one VS Code-independent implementation with the `jetforge` CLI.
  - Golden cases appear in VS Code’s Testing view and can emit JSON or JUnit in CI; local validation can emit SARIF.
  - Trusted command-mode cases pass a named model fixture to a project-owned evaluator and can open the real artifact as a read-only editor document.
  - The impact graph is an interactive local webview with typed filters, search, focus, keyboard operation, and file navigation.
  - Include extraction and reference moves now show reviewable plans; class rename, helper extraction, and import cleanup remain conservative and refuse ambiguous edits.

## Remaining Future Direction

1. Inline IntelliSense
   - Harden the generated-Java provider bridge with more real-workspace validation and expand it only where source/edit mappings are deterministic.
   - Keep full semantic rename/edit application out of scope until it can be proven safe across scriptlet, expression, declaration, include-expanded, and skeleton-rendered regions. Local helper rename remains intentionally narrow.

2. Compiler-backed diagnostics
   - Continue expanding real-world matcher examples for Eclipse JET, `javac`, and team-specific compiler wrappers as new compiler output formats appear.
   - Keep diagnostics conservative: if a compiler problem cannot be mapped deterministically, leave it in the output channel instead of attaching it to the wrong template range.

3. Workspace Intelligence
   - Validate the interactive graph, headless discovery, and golden runner against additional large real-world Eclipse JET layouts.
   - Keep the model deterministic and file-based; do not infer hidden build-system state without explicit settings.

## Additional Eclipse-Inspired Feature Ideas

- Split template/generated-Java view
  - Eclipse can show the compiled Java result below the template and synchronize cursor/selection between the views.
  - VSCode equivalent shipped as side-by-side read-only virtual previews plus optional synchronized reveal where mappings are deterministic.

- Problem marker mapping
  - Eclipse maps problems in generated Java back to originating template ranges.
  - VSCode equivalent: map generated-preview diagnostics back into the template where source ranges are known.

- Outline navigation
  - Eclipse's JET editor exposes an outline that summarizes template contents and supports navigation.
  - VSCode equivalent: a `DocumentSymbolProvider` for directives, scriptlet blocks, declarations, includes, and generated-output sections.

- Directive-aware content assist
  - Eclipse content assist exposes JET directive syntax and attributes.
  - VSCode equivalent: directive completions for `@jet`, `@include`, `package`, `class`, `imports`, `skeleton`, `ipxact`, `file`, and configured project-specific directive metadata.

- Skeleton support
  - Eclipse supports a `skeleton` attribute in the `@jet` directive to customize the compiled Java class shape.
  - VSCode equivalent: parse, navigate, validate, hover, and render local token-based `.skeleton` files in generated Java previews.

- Include navigation
  - Eclipse supports navigation for `file` and `skeleton` links.
  - VSCode equivalent: `DefinitionProvider` for include files and skeleton files, plus diagnostics for missing relative references.

- Template naming conventions
  - Eclipse and GMF conventions encode generated output type in names such as `.javajet`, `.xmljet`, `.html.jet`, `.propertiesjet`, and `.jetinc`.
  - VSCode equivalent: recognize `.propertiesjet` as a generic TxtJet template alongside the existing target-specific suffixes while preserving `.txtjet` as the primary supported extension.

- Formatting strategy
  - Eclipse benefits from Java editor formatting for generated Java portions.
  - VSCode equivalent: command-driven formatting for selected template Java blocks first, then generated-preview formatting later.

## Continuing Non-Goals

- Do not build a full parser.
- Do not implement semantic Java analysis directly.
- Do not send code to external services.
- Do not depend on internal company systems.
