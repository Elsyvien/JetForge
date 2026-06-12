# IP-XACT Support

IP-XACT support in TxtJet is optional, opt-in tooling that helps author and validate IP-XACT outputs without imposing file naming rules. All IP-XACT features remain disabled by default and activate only through settings. The implementation reuses existing generation, preview, diagnostics, and workspace-indexing flows while keeping IP-XACT logic strictly scoped and off by default.

## Scope and Guardrails

- Everything is opt-in via settings (default: off).
- No filename requirement; IP-XACT behavior is enabled only by configuration (toggle + optional match list or per-template metadata).
- Do not introduce background indexing or validation work when the feature is disabled.
- Prefer reusing existing generate/preview/diff and diagnostics infrastructure.
- Validation is an explicit command (or on-save only if explicitly enabled).

## Implemented Capabilities (Opt-In)

1. Language mode / output recognition
   - `txtjet.ipxact.enabled` gates all IP-XACT behavior.
   - Templates match through `txtjet.ipxact.templateGlobs` or per-template `@jet ipxact="true"` metadata.
   - IP-XACT previews and diffs use XML mode.
   - Disable state reverts to standard TxtJet behavior.

2. IP-XACT snippets / completions
   - Shared snippets include `component`, `busInterface`, `memoryMap`, `addressBlock`, `register`, and `field`.
   - Matched IP-XACT generated-output regions offer local node snippet completions.
   - `@jet ipxact="true"` is accepted by diagnostics and offered as metadata.

3. IP-XACT validation
   - `TxtJet: Validate IP-XACT Output` writes generated XML and runs `txtjet.ipxact.validation.command`.
   - Validation supports `${file}`, `${workspaceFolder}`, and `${outputFile}` placeholders.
   - Diagnostics use `txtjet.ipxact.validation.problemMatcher` and map to template locations where generated-output source maps allow it.
   - Validation never runs when disabled.

4. Navigation / indexing
   - The workspace model exposes `ipxactTemplates` and the Explorer shows an IP-XACT group.
   - `TxtJet: Open IP-XACT Template` opens a quick-pick over matched templates.
   - Indexing runs only when the setting is enabled.

5. Generated output workflows
   - `TxtJet: Open IP-XACT Preview`, `TxtJet: Generate IP-XACT Output`, and `TxtJet: Diff Current IP-XACT Output Against Last Generation` reuse the existing preview/diff infrastructure.
   - Settings include enable flag, template globs, output directory override, validator command/matcher, validation timeout, on-save validation, and auto-open behavior.
   - Commands remain hidden/disabled when the feature is off.

## Non-Goals (Near Term)

- Full semantic IP-XACT authoring or schema-aware refactors inside mixed TxtJet files.
- Background validation or indexing when the user has not explicitly enabled it.
- Forcing IP-XACT naming conventions or file extensions.
