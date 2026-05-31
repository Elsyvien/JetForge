# TxtJet Syntax QA Checklist

Use sanitized files only. Private workplace templates may be opened locally for validation, but must not be committed or packaged.

## Install And Version

- Run `npm run verify`.
- Install the generated `.vsix` with `code --install-extension txtjet-syntax-0.0.14.vsix --force`.
- Confirm VSCode reports `elsyvien.txtjet-syntax@0.0.14`.
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
- Confirm template markers, directives, embedded Java, and generated-output regions have distinct subtle editor decorations.
- Run `TxtJet: Toggle Region Background Coloring` and confirm those extra decorations hide/show without changing TextMate highlighting.
- Toggle `txtjet.visualDifferentiation.enabled` directly and confirm the command reflects the same setting.

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
- Inside `file=""`, confirm local `.txtjet`/`.jetinc` include path completions appear without listing unrelated file types.
- Inside `skeleton=""`, confirm local `.skeleton` path completions appear.
- Inside `imports=""`, `package=""`, and `class=""`, confirm Java-oriented value completions appear and replace only the active value segment.
- In `examples/sample-java.txtjet`, place the cursor inside generated Java output, type `ret` or press Cmd+Space/Ctrl+Space, and confirm Java fallback suggestions appear.
- In `examples/sample-python.txtjet`, place the cursor in generated Python output and confirm Python keyword/builtin suggestions appear; after `items.ap`, confirm `append` is offered when a local list assignment is present.
- In `examples/sample-c.txtjet` or a C++-style `.cjet` scratch, confirm C/C++ suggestions appear; after `std::co`, confirm `cout` is offered.
- Inside a `<% ... %>` scriptlet, `<%= ... %>` expression, and `<%! ... %>` declaration, confirm Java suggestions appear for identifiers and after `.`.
- Switch the same generated-output region to a non-Java TxtJet mode and confirm Java fallback suggestions are not offered there.
- Confirm snippets appear in every TxtJet mode.
- Confirm disabling `txtjet.completions.enabled` removes TxtJet completions.

## Preview And Navigation

- Run `TxtJet: Open Generated Output Preview` for each sanitized example and confirm the preview preserves outer generated text.
- Confirm `examples/include-main.txtjet` expands `partials/header.txtjet` and `partials/nav.txtjet` in the generated output preview.
- Run `TxtJet: Open Generated Java Template Preview` and confirm the preview uses `@jet package`, `class`, and `imports` metadata.
- Run `TxtJet: Open Preview Beside Source` and confirm the preview opens beside the template.
- Place the cursor in generated XML/HTML/Python/C/Java output and run `TxtJet: Open Region In Generated Preview`; confirm the mapped generated-output preview region is selected.
- Place the cursor in a scriptlet, expression, or declaration and run `TxtJet: Open Region In Java Preview`; confirm the mapped generated Java preview region is selected.
- Run `TxtJet: Reveal Generated Output Preview From Source` and confirm the matching preview region is selected.
- Run `TxtJet: Reveal Source From Preview` from an open preview and confirm the matching template region is selected.
- Confirm changing the source template refreshes open preview documents.
- Confirm the generated output preview language follows the selected generated-output mode.
- Create a sanitized relative include and confirm Go to Definition from `file="..."` opens it.
- Open `examples/skeleton-directive.txtjet` and confirm Go to Definition from `skeleton="..."` opens `templates/base.skeleton`.
- In a scriptlet or expression that calls a helper declared in `<%! ... %>`, confirm Go to Definition jumps to the helper method name.
- With multiple same-name helper overloads in `<%! ... %>`, confirm Peek Definition shows each local overload.
- Hover a local helper call and confirm the helper signature appears when Java tooling does not provide hover content.
- Run Find All References on a local helper call and confirm the helper declarations plus direct/`this.` calls are listed, excluding comments, strings, and non-local receivers.
- Run Rename Symbol on a local helper declaration and confirm matching direct/`this.` call sites update while comments, strings, and `service.helper(...)` calls do not.
- Trigger Signature Help inside a local helper call and confirm overloads appear with the active parameter moving after commas and ignoring nested-call commas.
- Hover over include and skeleton references and confirm the resolved path/status is shown.
- Open the generated Java preview for `examples/skeleton-directive.txtjet` and confirm the `.skeleton` token layout is used.
- Open `examples/skeleton-nested.txtjet` and confirm nested skeleton resolution works.
- Add a temporary missing `skeleton="..."` reference and confirm a missing-skeleton diagnostic appears.
- Trigger Quick Fix on a missing include or skeleton diagnostic and confirm the referenced file is created locally.
- Enable `txtjet.diagnostics.generatedJava.enabled`, open a generated Java preview, and confirm Java diagnostics can map back to template ranges where mappings exist.
- Configure `txtjet.compiler.command` with a sanitized local wrapper that emits `generated/sample.java:line:column: error: message` and confirm the default compiler problem matcher maps deterministic diagnostics.
- Configure the wrapper-style matcher `^\\[txtjet\\]\\s+(?<file>.*?):(?<line>\\d+):(?<column>\\d+):\\s*(?<severity>error|warning|info|information|hint):\\s*(?<message>.+)$` and confirm `[txtjet] file:line:column: error: message` output is parsed.
- Confirm disabling `txtjet.previews.enabled` disables preview commands.
- Confirm disabling `txtjet.previews.generatedJava.enabled` disables the generated Java preview command.
- Confirm disabling `txtjet.navigation.includeDefinitions.enabled` removes include and skeleton Go to Definition.

## Workspace Intelligence

- Open the `TxtJet Workspace` Explorer view and confirm Templates, Includes, Skeletons, Unresolved References, and Generated Output Targets are populated for sanitized examples.
- Run `TxtJet: Refresh Workspace Model` and confirm the tree refreshes without changing files.
- Open an include fragment and run `TxtJet: Open Including Template`; confirm the referencing template opens.
- Run `TxtJet: Open Generated Java For Template` from a template and from the workspace tree; confirm the generated Java preview opens beside the source.
- Add a temporary unresolved include or skeleton reference and confirm it appears in the workspace tree and editor diagnostics.
- Create the referenced file and confirm the unresolved tree entry and diagnostic disappear after refresh/save.
- Run `TxtJet: Validate Workspace Templates` with a sanitized compiler wrapper and confirm root templates are validated without forcing unmappable diagnostics into source ranges.

## Settings And Privacy

- Toggle `txtjet.statusBar.enabled` and confirm the status bar item hides/shows.
- Run `TxtJet: Toggle Region Background Coloring` and confirm mixed-language region decorations hide/show.
- Set `txtjet.diagnostics.severity` to `error`, `warning`, `information`, and `hint`; confirm diagnostics update.
- Set `txtjet.diagnostics.maxFileSizeKb` to a low value and confirm diagnostics are skipped for larger files.
- Run `node node_modules/@vscode/vsce/vsce ls --no-dependencies` and inspect the package file list.
- Confirm the package contains no private templates, root-level local `example*` files, `src`, `test-fixtures`, `node_modules`, `.github`, `.playwright-cli`, static site files, logs, or local VSIX files.
- Confirm the package contains only the manifest, README, changelog, license, language configuration, icon, docs, examples, snippets, syntaxes, and compiled `out/*.js` files.
