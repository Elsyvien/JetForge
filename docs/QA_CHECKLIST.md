# TxtJet Syntax QA Checklist

Use sanitized files only. Private workplace templates may be opened locally for validation, but must not be committed or packaged.

## Install And Version

- Run `npm run verify`.
- Install the generated `.vsix` with `code --install-extension txtjet-syntax-0.0.6.vsix --force`.
- Confirm VSCode reports `elsyvien.txtjet-syntax@0.0.6`.
- Reload VSCode after install.

## Language Modes

- Open each sanitized example in `examples/`.
- Confirm `.txtjet` opens in `TxtJet` mode by default.
- Manually switch to each generated output mode:
  - `TxtJet Java Output`
  - `TxtJet HTML Output`
  - `TxtJet XML Output`
  - `TxtJet C Output`
  - `TxtJet Python Output`
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

## Diagnostics And Quick Fixes

- Open `examples/malformed.txtjet`.
- Confirm diagnostics appear for malformed TxtJet syntax.
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
- Confirm snippets appear in every TxtJet mode.
- Confirm disabling `txtjet.completions.enabled` removes TxtJet completions.

## Settings And Privacy

- Toggle `txtjet.statusBar.enabled` and confirm the status bar item hides/shows.
- Set `txtjet.diagnostics.severity` to `error`, `warning`, `information`, and `hint`; confirm diagnostics update.
- Set `txtjet.diagnostics.maxFileSizeKb` to a low value and confirm diagnostics are skipped for larger files.
- Confirm the package contains no private templates, local example files, `src`, `test-fixtures`, `node_modules`, or `.github`.
