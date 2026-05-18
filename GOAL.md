# Goal: TxtJet VSCode Extension

Build a small private VSCode extension for `.txtjet` Java emitter template files.

The first deliverable is a locally installable `.vsix` package that provides:

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

Development-only private examples may be used to tune the grammar, but they must not be committed, documented, packaged, or shared. If saved locally, keep them under an ignored path such as `private-examples/` and verify with `git status` before committing.

Use normal Git hygiene:

- Make scoped commits.
- Review staged files before committing.
- Keep generated and private files intentional.
- Do not commit unrelated changes.
