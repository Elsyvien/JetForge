# TxtJet Syntax

Private/internal VSCode extension for `.txtjet` Java emitter template files.

## Features

- Default `txtjet` language mode for `.txtjet` files.
- Manual target modes for `txtjet-java`, `txtjet-html`, `txtjet-xml`, `txtjet-c`, and `txtjet-python`.
- TextMate highlighting for JET/JSP-style blocks:
  - `<% ... %>`
  - `<%= ... %>`
  - `<%! ... %>`
  - `<%@ ... %>`
- Java highlighting inside embedded template blocks.
- Basic brackets, pairs, comments, and snippets.
- Auto Alpha detection that can switch a newly opened `.txtjet` file to the likely target mode.

## Install Locally

Package the extension:

```bash
npx @vscode/vsce package
```

Install the generated package:

```bash
code --install-extension txtjet-syntax-0.0.1.vsix
```

Reload VSCode after installation if the language mode is not immediately available.

## Usage

Open a `.txtjet` file. VSCode should select the `txtjet` language mode automatically.

If the generated outer content should be highlighted as a specific language, use the language mode selector and choose one of:

- `TxtJet Java`
- `TxtJet HTML`
- `TxtJet XML`
- `TxtJet C`
- `TxtJet Python`

The extension does not auto-detect the generated target language.
Auto Alpha can also infer the target language from content when a default `.txtjet` file is opened. It only switches files that are still in the default `TxtJet` mode, and it does not override a manual `TxtJet ...` language mode selection.

If the VSCode language selector is inconvenient, use the TxtJet commands:

- `TxtJet: Select Target Language`
- `TxtJet: Use C Mode`
- `TxtJet: Use Python Mode`
- `TxtJet: Use XML Mode`
- `TxtJet: Use HTML Mode`
- `TxtJet: Use Java Mode`
- `TxtJet: Use Generic Mode`

TxtJet files also show a clickable status bar item for selecting the target language.

You can rerun detection manually with the command:

```txt
TxtJet: Detect Target Language
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

## Development Notes

Version 1 does not provide Java semantic analysis, template-context IntelliSense, or diagnostics. Auto Alpha target detection is heuristic and may guess wrong on ambiguous mixed-output templates.

Private development examples must stay untracked and out of the package.
