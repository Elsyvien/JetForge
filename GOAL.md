# Goal: TxtJet VSCode Extension

Build a VSCode extension for `.txtjet` Java emitter template files.

The first deliverable is a locally installable `.vsix` package that can later be released on the VSCode Marketplace.

- A default `txtjet` language mode for `.txtjet` files.
- Optional manual language modes for `txtjet-java`, `txtjet-html`, `txtjet-xml`, `txtjet-c`, and `txtjet-python`.
- TextMate syntax highlighting for JET/JSP-style template blocks:
  - `<% ... %>`
  - `<%= ... %>`
  - `<%! ... %>`
  - `<%@ ... %>`
- Java highlighting inside embedded template blocks.
- Visible highlighting for all template delimiters.
- Basic editor support: brackets, auto-closing pairs, surrounding pairs, and comments.
- Snippets for common template constructs.
- Sanitized example `.txtjet` files only.
- A README with local install and usage instructions.

Keep Version 1 simple:

- Do not build semantic Java IntelliSense.
- Do not implement a full parser.
- Do not auto-detect the target output language.
- Do not connect to internal systems.
- Do not include proprietary, confidential, company-specific, or production template code.
- Keep the project open-source-ready under the MIT license.

Development-only private examples may be used to tune the grammar, but they must not be committed, documented, packaged, or shared. If saved locally, keep them under an ignored path such as `private-examples/` and verify with `git status` before committing.

Use normal Git hygiene:

- Make scoped commits.
- Review staged files before committing.
- Keep generated and private files intentional.
- Do not commit unrelated changes.

## Next Sweep Goal: Editor Intelligence V1

Implement the next feature pass in one focused sweep after the current highlighting and language-mode baseline is stable.

### 1. Diagnostics V1

Add lightweight diagnostics for `.txtjet` documents.

Detect:

- Unclosed template blocks such as `<% ...` without a matching `%>`.
- Unexpected `%>` without a matching opening marker.
- Malformed directives starting with `<%@`.
- Empty directive names such as `<%@ %>`.
- Unterminated quoted strings inside directives when feasible.

Constraints:

- Use a small scanner, not a full parser.
- Diagnostics should work in all TxtJet language modes.
- Keep diagnostics non-semantic; do not analyze Java correctness.
- Avoid noisy diagnostics inside normal generated output text.

### 2. Completion Provider V1

Add basic completions for common TxtJet constructs.

Suggest:

- `<%`
- `<%=`
- `<%!`
- `<%@`
- `jet`
- `include`
- `package`
- `class`
- `imports`
- `file`

Behavior:

- Offer marker completions in normal template text.
- Offer directive keyword and attribute completions inside directive blocks.
- Keep completions simple and predictable.
- Do not infer project-specific variables or template context values.

### 3. Formatting And Indentation Helpers V1

Add minimal editor helpers that improve common typing flows without reformatting entire files.

Support:

- Reasonable indentation after lines like `<% if (...) { %>`.
- Reasonable indentation after lines like `<% for (...) { %>`.
- Dedent around closing template control lines like `<% } %>` when feasible.
- Preserve generated-language formatting as much as possible.

Constraints:

- Do not implement a full formatter in this pass.
- Do not rewrite whole documents.
- Prefer VSCode language configuration and small on-type behavior over heavy formatting logic.
- If indentation becomes unreliable, keep this feature conservative.

### 4. Better C/XML Robustness

Improve the most common C and XML template cases without trying to build a true mixed-language parser.

C cases:

- C preprocessor blocks around template output.
- Template expressions inside declarations, struct fields, enum values, and macros.
- C comments near or around template blocks.

XML cases:

- Template expressions inside XML attribute values, e.g. `<tag name="<%= value %>">`.
- Template expressions inside text nodes, e.g. `<tag><%= value %></tag>`.
- Template control blocks around XML nodes, e.g. `<% for (...) { %><item>...</item><% } %>`.
- Temporarily invalid XML caused by template control flow should look stable, not aggressively broken.

Constraints:

- Manual modes remain the correctness baseline.
- Auto Alpha may help choose a mode, but it should not override stored manual choices.
- Do not attempt simultaneous full default highlighting for multiple outer languages in the same file.
- Use sanitized examples and tests only.

### Delivery Requirements For The Sweep

- Update TypeScript extension code and grammars as needed.
- Add or update sanitized examples that cover diagnostics, completions, indentation, C, and XML.
- Add focused tests for scanner/detection logic where practical.
- Rebuild `txtjet-syntax-0.0.1.vsix`.
- Reinstall the package locally.
- Commit source changes and package changes separately.
- Keep `example.txt`, `example.txtjet`, private examples, `node_modules`, and generated scratch files out of Git and out of the VSIX.
