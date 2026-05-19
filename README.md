# TxtJet Syntax

VSCode extension for `.txtjet` Java emitter template files.

## Features

- Default `txtjet` language mode for `.txtjet` files.
- Also recognizes `.jet`, `.javajet`, `.htmljet`, `.xmljet`, `.cjet`, and `.pythonjet` files.
- Manual target modes for `txtjet-java`, `txtjet-html`, `txtjet-xml`, `txtjet-c`, and `txtjet-python`.
- TextMate highlighting for JET/JSP-style blocks:
  - `<% ... %>`
  - `<%= ... %>`
  - `<%! ... %>`
  - `<%@ ... %>`
- Java highlighting inside embedded template blocks.
- Basic brackets, pairs, comments, snippets, diagnostics, and completions.
- Read-only generated output and generated Java template previews.
- Outline symbols for directives, template Java blocks, expressions, declarations, and generated-output regions.
- Go to Definition for relative `@include file="..."` references.
- Auto Alpha detection that can switch a newly opened `.txtjet` file to the likely target mode.
- Remembered per-file language choices with commands to clear them.
- No runtime network access, telemetry, or proprietary template content.

## Install Locally

Package the extension:

```bash
npm run package
```

Run the full local release check:

```bash
npm run verify
```

Install the generated package:

```bash
code --install-extension txtjet-syntax-0.0.8.vsix
```

Reload VSCode after installation if the language mode is not immediately available.

CI packages the extension as a workflow artifact. Marketplace publishing is intentionally not automated yet.

## Usage

Open a `.txtjet` file. VSCode should select the `txtjet` language mode automatically.

If the generated outer content should be highlighted as a specific language, use the language mode selector and choose one of:

- `TxtJet Java Output`
- `TxtJet HTML Output`
- `TxtJet XML Output`
- `TxtJet C Output`
- `TxtJet Python Output`

These modes describe the generated output language outside template blocks. Embedded Java inside `<% ... %>`, `<%= ... %>`, `<%! ... %>`, and `<%@ ... %>` is highlighted in every TxtJet mode.
Template delimiters are also injected into common outer-language strings, comments, and preprocessor regions so generated C/XML/HTML/Python/Java text does not hide TxtJet blocks.

Auto Alpha can infer the generated target language from filename hints and file content when a default `.txtjet` file is opened. It only switches files that are still in the default `TxtJet` mode, and it does not override a manual `TxtJet ...` language mode selection.

If the VSCode language selector is inconvenient, use the TxtJet commands:

- `TxtJet: Select Generated Output Mode`
- `TxtJet: Auto Detect Generated Output Mode`
- `TxtJet: Use Generated C Output Mode`
- `TxtJet: Use Generated Python Output Mode`
- `TxtJet: Use Generated XML Output Mode`
- `TxtJet: Use Generated HTML Output Mode`
- `TxtJet: Use Generated Java Output Mode`
- `TxtJet: Use Generic Template Mode`
- `TxtJet: Clear Remembered Target Language`
- `TxtJet: Clear All Remembered Target Languages`

TxtJet files also show a clickable status bar item for selecting the target language.

Manual selections are remembered for the file in the current workspace. Auto-detected choices are not remembered, so detection can be rerun after file content changes. The selector and status bar indicate whether the current mode is remembered or auto/default. Auto Alpha checks filename hints before scanning content, so names like `packet.c.txtjet`, `model.py.txtjet`, and `schema.xml.txtjet` open in the expected target mode.

You can rerun detection manually with the command:

```txt
TxtJet: Auto Detect Generated Output Mode
```

## Snippets

Snippets are available in all TxtJet modes:

- `scriptlet`
- `expr`
- `decl`
- `jet`
- `include`
- `if`
- `for`

## Diagnostics And Completions

The extension reports lightweight TxtJet syntax diagnostics:

- unclosed `<% ... %>` blocks
- unexpected `%>` delimiters
- malformed or empty directives
- unterminated quoted strings inside directives

Completions are available for template markers after typing `<`, plus directive names and common directive attributes inside `<%@ ... %>` blocks.

Quick Fix actions are available for common diagnostics, including unexpected closing delimiters, missing closing delimiters, empty or malformed directive names, and unterminated directive strings.

Additional directive diagnostics report duplicate `@jet` directives, missing or unresolved include files, malformed directive attributes, and unknown core directive names.

Diagnostics, Quick Fixes, completions, and the status bar selector can be disabled from VSCode settings if a workspace needs a quieter editor.

## Preview And Navigation

TxtJet can open local, read-only preview documents for the active template:

- `TxtJet: Open Generated Output Preview`
- `TxtJet: Open Generated Java Template Preview`
- `TxtJet: Open Preview Beside Source`
- `TxtJet: Reveal Generated Output Preview From Source`
- `TxtJet: Reveal Source From Preview`

The generated output preview preserves outer template text, expands relative includes, keeps directives, scriptlets, and declarations visible as language-appropriate comments, and renders expressions as readable or syntax-friendly placeholders. The preview language follows the selected or detected generated-output mode.

The generated Java template preview approximates the Java class that a template compiler would produce. It uses `@jet package`, `class`, and `imports` attributes when present, turns declarations into class members, scriptlets into method-body Java, expressions into `stringBuffer.append(...)`, and outer text into escaped append calls. It is intended for editor inspection and future mapping work, not as a byte-for-byte Eclipse JET compiler output.

Relative include references can be opened through Go to Definition from `file="..."` attributes. Reveal commands use the preview source map to jump between a source selection and the corresponding generated-output preview region, or back from an open preview to its source template.

## Formatting Helpers

TxtJet modes include conservative indentation rules for common control blocks such as:

```jsp
<% if (condition) { %>
    ...
<% } %>
```

## Development Notes

Version 1 does not provide Java semantic analysis or template-context IntelliSense. Auto Alpha target detection is heuristic and may guess wrong on ambiguous mixed-output templates.

Further IntelliSense work is tracked in [docs/INTELLISENSE_ROADMAP.md](docs/INTELLISENSE_ROADMAP.md). The production validation checklist is in [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md).

Settings:

- `txtjet.autoDetect.enabled`
- `txtjet.defaultTargetLanguage`
- `txtjet.diagnostics.enabled`
- `txtjet.diagnostics.severity`
- `txtjet.diagnostics.maxFileSizeKb`
- `txtjet.diagnostics.generatedJava.enabled`
- `txtjet.codeActions.enabled`
- `txtjet.completions.enabled`
- `txtjet.statusBar.enabled`
- `txtjet.previews.enabled`
- `txtjet.previews.openBeside`
- `txtjet.previews.generatedJava.enabled`
- `txtjet.navigation.includeDefinitions.enabled`

Privacy and workplace use:

- The extension runs locally inside VSCode.
- It does not send source files, template content, diagnostics, or usage data anywhere.
- It does not connect to internal company systems.
- Example files are artificial and sanitized; local/private examples are excluded from the package.

Local-only development examples should stay untracked and out of the package.

## Example Files

The `examples/` folder contains sanitized templates for manual testing:

- `sample-*.txtjet` cover the supported generated-output modes.
- `include-main.txtjet` and `partials/*.txtjet` test relative include navigation.
- `skeleton-directive.txtjet` tests directive attributes including `skeleton`.
- `java-declaration-heavy.txtjet` stresses generated Java preview declarations and imports.
- `diagnostics-directives.txtjet` intentionally triggers directive diagnostics.
- `fallback-java-preview.txtjet` tests fallback generated Java metadata.

## License

MIT
