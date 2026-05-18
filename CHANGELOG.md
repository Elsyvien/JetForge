# Changelog

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
