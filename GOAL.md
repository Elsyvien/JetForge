# TxtJet Syntax Roadmap

TxtJet Syntax is a VSCode extension for `.txtjet` Java emitter template files.

## Current Scope

- Syntax highlighting for JET/JSP-style template blocks:
  - `<% ... %>`
  - `<%= ... %>`
  - `<%! ... %>`
  - `<%@ ... %>`
- Embedded Java highlighting inside template blocks.
- Default `txtjet` mode for generic template text.
- Manual target modes for Java, HTML, XML, C, and Python output.
- Auto Alpha target-language detection with manual override commands.
- Brackets, pairs, snippets, completions, diagnostics, and conservative indentation helpers.
- Sanitized example templates for supported target languages.
- MIT-licensed, open-source-ready project metadata.

## Near-Term Roadmap

- Improve diagnostics with more precise ranges and quick fixes.
- Add completion context awareness for directive attributes.
- Expand C and XML fixture coverage for common template patterns.
- Add integration-style tests for scanner and language detection behavior.
- Prepare Marketplace metadata, screenshots, and release notes.

## Non-Goals

- Full Java semantic analysis.
- Template-context IntelliSense.
- A full parser for generated output languages.
- Automatic perfect highlighting for multiple target languages in the same file.
