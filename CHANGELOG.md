# Changelog

## 0.0.18

- Added TxtJet impact graph reports that trace direct and transitive include/skeleton dependencies to affected templates and generated-output targets.
- Added safe refactor commands for extracting selected template text into `.jetinc` includes and renaming or moving include/skeleton files while updating resolved references.
- Hardened refactors to create missing target folders, reject malformed directive paths, and avoid saving unrelated editor changes.
- Documented the new workspace impact and refactor workflows.

## 0.0.17

- Disabled external compiler and IP-XACT validator commands in VSCode Restricted Mode and declared limited untrusted-workspace support.
- Tightened generated diagnostic mapping so unrelated files with the same basename cannot attach diagnostics to a template.
- Prevented missing-reference Quick Fixes from creating files outside the workspace or configured reference roots.
- Fixed workspace refresh races that could clear fresh compiler or IP-XACT diagnostics after saves and file changes.
- Removed unused preview synchronizer state, disposed the output channel correctly, and made workspace validation report skipped templates accurately.
- Updated the VSIX packaging toolchain to resolve its vulnerable temporary-file dependency and added full dependency audits to CI and publishing.

## 0.0.16

- Added opt-in IP-XACT workflows with matched-template preview, generation, diffing, external-command validation, mapped diagnostics, workspace indexing, node snippets, and generated-output completions.
- Added synchronized source/preview reveal for visible generated previews where source maps are deterministic.
- Added configurable project-specific directive metadata completions and diagnostics support.
- Added `.propertiesjet` recognition as a generic TxtJet template suffix.
- Updated roadmap, README, QA checklist, examples, manifest coverage, and package version references for the `0.0.16` VSIX.

## 0.0.15

- Added a configurable timeout for external compiler commands so compile and compiler-diagnostic runs cannot hang indefinitely.
- Fixed `.jetinc` Command Palette visibility for TxtJet preview, generation, and language-mode commands.
- Updated QA/install documentation to reference the current `0.0.15` VSIX.

## 0.0.14

- Added `TxtJet: Toggle Region Background Coloring` so users can quickly turn parser-backed region background decorations on or off without opening settings.
- Added TxtJet Workspace Intelligence with a `TxtJet Workspace` Explorer view, workspace-wide template/include/skeleton indexing, include backlinks, unresolved-reference grouping, generated target entries, and workspace validation commands.

## 0.0.13

- Hardened release packaging so local browser snapshots, static site files, source files, tests, fixtures, logs, and generated VSIX files stay out of packaged extensions.
- Promoted local helper References, Rename Symbol, and Signature Help to documented Java IntelliSense features gated by `txtjet.javaIntelliSense.enabled`.
- Improved local helper Signature Help so active parameters are computed across nested calls and overloads.
- Added regression coverage for multiline Java mappings, trimmed expressions, skeleton-rendered previews, conservative helper rename/reference ranges, and compiler problem matcher variants.
- Added practical compiler matcher documentation and manual Marketplace publish workflow prep.

## 0.0.12

- Added directive value completions for include `file`, skeleton, Java `imports`, `package`, and `class` attributes.
- Added local Go to Definition and Peek Definition fallback support for TxtJet template Java helper methods declared in `<%! ... %>` blocks.
- Added local hover fallback signatures for TxtJet template Java helper calls when external Java tooling has no answer.
- Fixed Windows-local test portability for path assertions and package hygiene validation.

## 0.0.11

- Added parser-backed visual differentiation for TxtJet markers, directives, embedded Java, and generated-output regions.
- Added region-aware hover fallback text and the `txtjet.visualDifferentiation.enabled` setting.
- Added region-aware preview commands for jumping from generated-output regions to output previews and template-Java regions to generated Java previews.
- Tightened TextMate scopes for template delimiters, directive names, directive attributes, and directive strings.
- Added generated-output fallback completions for Python and C/C++ TxtJet modes.
- Improved generated-output completion target selection so generic `.txtjet` files use detected Java, Python, or C/C++ output mode when no manual mode is selected.
- Added C/C++ `std::...` and vector member fallbacks plus Python list, dict, string, and math member fallbacks.

## 0.0.9

- Added Java IntelliSense forwarding for TxtJet scriptlet, expression, and declaration blocks through the generated Java preview when Java tooling is available.
- Added local Java-block completion fallbacks so TxtJet still shows suggestions when external Java tooling ignores virtual preview documents.
- Added on-demand generated-output writing plus a command to diff the current generated output against the last saved generation snapshot.
- Added template-aware document and selection formatting for directives, expressions, scriptlets, and declarations.
- Added configurable include and skeleton search paths with extensionless `.txtjet`, `.jetinc`, and `.skeleton` candidate resolution.
- Added deterministic token-based skeleton rendering for generated Java previews with `${packageDeclaration}`, `${imports}`, `${class}`, `${members}`, and `${generateMethod}`.
- Added stricter directive validation for duplicate attributes, unknown directive attributes, invalid `@jet` package/class/import values, and invalid skeleton paths.
- Added hover status and Quick Fix file creation for unresolved include and skeleton references.
- Added nested, valid, missing, and invalid skeleton examples plus mapping regressions for expanded includes and skeleton-rendered Java previews.

## 0.0.8

- Added labeled preview headers, recursive relative include expansion, and preview/source reveal commands.
- Improved generated-output placeholders across Java, C, Python, HTML, and XML previews while keeping template code visible as comments.
- Added relative `@jet skeleton="..."` validation, navigation, preview annotation, and a sanitized skeleton example.
- Added example-wide preview regression tests and optional generated-Java diagnostic mapping behind `txtjet.diagnostics.generatedJava.enabled`.

## 0.0.6

- Added read-only generated output and generated Java template preview commands with local virtual documents.
- Added a reusable template transformation layer with parsed blocks, directive metadata, and preview range mappings.
- Added outline symbols, relative include Go to Definition, richer directive completions, and directive-level diagnostics.
- Added an IntelliSense roadmap based on Eclipse JET editor behavior and future preview/source-mapping ideas.
- Added a manual QA checklist for workplace rollout validation.
- Added manifest and package hygiene tests to catch broken contributions and private/dev-only packaging regressions.
- Added detector regressions for Eclipse-style JET filename conventions such as `.javajet`, `.xmljet`, `.htmljet`, and `.jetinc`.
- Added scanner regressions for adjacent template blocks, escaped directive quotes, and multiple directives.

## 0.0.5

- Packaged the workplace-ready hardening as a Marketplace-updateable release.
- Kept the internal rollout controls for diagnostics, Quick Fixes, completions, status bar visibility, and diagnostic file-size limits.
- Kept the documented local-only behavior with no runtime telemetry and no runtime network access.

## 0.0.4

- Improved template delimiter highlighting inside target-language strings, comments, and preprocessor regions.
- Expanded embedded template injection coverage from expressions to directives, declarations, and scriptlets.
- Added grammar regression checks for the embedded template injection grammar.
- Added workspace-safe settings for diagnostics, Quick Fixes, completions, status bar visibility, and diagnostic file-size limits.
- Documented local-only behavior, no runtime telemetry, and no runtime network access for internal workplace review.

## 0.0.3

- Added Quick Fix actions for common TxtJet diagnostics.
- Clarified language mode persistence in the selector and status bar tooltip.
- Added single-quoted directive string highlighting.
- Updated tests and packaging metadata for the `0.0.3` Marketplace upload.

## 0.0.2

- Clarified generated output language modes in the language selector and commands.
- Made auto-detection non-sticky, refreshed the status bar after language switches, and kept remote workspace `.txtjet` files eligible for TxtJet behavior.
- Reduced completion popup noise by only triggering template marker snippets after `<`.
- Pinned VSIX packaging to a project-local `@vscode/vsce` dependency for repeatable Marketplace update uploads.

## 0.0.1

- Initial syntax extension for `.txtjet` Java emitter templates.
- Added default and target-specific TxtJet language modes.
- Added TextMate grammars, snippets, diagnostics, completions, language configuration, documentation, and sanitized examples.
