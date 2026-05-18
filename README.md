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

Version 1 is syntax-only. It does not provide Java semantic analysis, template-context IntelliSense, diagnostics, or target-language detection.

Private development examples must stay untracked and out of the package.
