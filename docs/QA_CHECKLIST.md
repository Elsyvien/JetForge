# TxtJet Syntax QA Checklist

Use sanitized files only. Private workplace templates may be opened locally for validation, but must not be committed or packaged.

## Install And Version

- Run `npm run verify`.
- Install the generated `.vsix` with `code --install-extension txtjet-syntax-0.0.8.vsix --force`.
- Confirm VSCode reports `elsyvien.txtjet-syntax@0.0.8`.
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
- Confirm directive diagnostics appear for duplicate `@jet`, missing include `file`, unresolved include paths, malformed attributes, and unknown core directives.
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
- Confirm `skeleton` is offered as a directive attribute completion.
- Confirm snippets appear in every TxtJet mode.
- Confirm disabling `txtjet.completions.enabled` removes TxtJet completions.

## Preview And Navigation

- Run `TxtJet: Open Generated Output Preview` for each sanitized example and confirm the preview preserves outer generated text.
- Confirm `examples/include-main.txtjet` expands `partials/header.txtjet` and `partials/nav.txtjet` in the generated output preview.
- Run `TxtJet: Open Generated Java Template Preview` and confirm the preview uses `@jet package`, `class`, and `imports` metadata.
- Run `TxtJet: Open Preview Beside Source` and confirm the preview opens beside the template.
- Run `TxtJet: Reveal Generated Output Preview From Source` and confirm the matching preview region is selected.
- Run `TxtJet: Reveal Source From Preview` from an open preview and confirm the matching template region is selected.
- Confirm changing the source template refreshes open preview documents.
- Confirm the generated output preview language follows the selected generated-output mode.
- Create a sanitized relative include and confirm Go to Definition from `file="..."` opens it.
- Open `examples/skeleton-directive.txtjet` and confirm Go to Definition from `skeleton="..."` opens `templates/base.skeleton`.
- Hover over include and skeleton references and confirm the resolved path/status is shown.
- Open the generated Java preview for `examples/skeleton-directive.txtjet` and confirm the `.skeleton` token layout is used.
- Open `examples/skeleton-nested.txtjet` and confirm nested skeleton resolution works.
- Add a temporary missing `skeleton="..."` reference and confirm a missing-skeleton diagnostic appears.
- Trigger Quick Fix on a missing include or skeleton diagnostic and confirm the referenced file is created locally.
- Enable `txtjet.diagnostics.generatedJava.enabled`, open a generated Java preview, and confirm Java diagnostics can map back to template ranges where mappings exist.
- Confirm disabling `txtjet.previews.enabled` disables preview commands.
- Confirm disabling `txtjet.previews.generatedJava.enabled` disables the generated Java preview command.
- Confirm disabling `txtjet.navigation.includeDefinitions.enabled` removes include and skeleton Go to Definition.

## Settings And Privacy

- Toggle `txtjet.statusBar.enabled` and confirm the status bar item hides/shows.
- Set `txtjet.diagnostics.severity` to `error`, `warning`, `information`, and `hint`; confirm diagnostics update.
- Set `txtjet.diagnostics.maxFileSizeKb` to a low value and confirm diagnostics are skipped for larger files.
- Confirm the package contains no private templates, local example files, `src`, `test-fixtures`, `node_modules`, or `.github`.
