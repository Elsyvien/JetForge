# Changelog

## 0.0.9

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
