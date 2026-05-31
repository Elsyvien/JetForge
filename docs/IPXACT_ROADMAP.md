# IP-XACT Roadmap

IP-XACT support in TxtJet is focused on optional, opt-in tooling that helps author and validate IP-XACT outputs without imposing file naming rules. All IP-XACT features remain disabled by default and activate only through settings. The goal is to reuse existing generation, preview, and diagnostics flows, while keeping IP-XACT logic strictly scoped and off by default.

## Scope and Guardrails

- Everything is opt-in via settings (default: off).
- No filename requirement; IP-XACT behavior is enabled only by configuration (toggle + optional match list or per-template metadata).
- Do not introduce background indexing or validation work when the feature is disabled.
- Prefer reusing existing generate/preview/diff and diagnostics infrastructure.
- Validation is an explicit command (or on-save only if explicitly enabled).

## Targeted Capabilities (Opt-In)

1. Language mode / output recognition
   - Add a setting to enable IP-XACT mode; no extension naming requirement.
   - Allow selection via template match list (glob) or per-template metadata.
   - When enabled, inject XML highlighting into generated-output previews and diffs.
   - Ensure disable state reverts to standard TxtJet behavior immediately.

2. IP-XACT snippets / completions
   - Provide a snippet/completion provider (so it can be toggled).
   - Include common nodes: `component`, `busInterface`, `memoryMap`, `addressBlock`, `register`, `field`.
   - Offer minimal namespace boilerplate snippets.
   - Activate only for IP-XACT-matched templates or when IP-XACT mode is on.

3. IP-XACT validation
   - Add a command "Validate IP-XACT" that validates generated XML.
   - Support external validator command or XSD-based validation (configurable XSD path).
   - Surface diagnostics in VSCode and map to template locations where the source map allows it.
   - Ensure validation never runs when disabled.

4. Navigation / indexing
   - Add optional indexing for IP-XACT-related templates/includes and expose navigation via quick-pick or view.
   - Prefer existing workspace model hooks where available.
   - Indexing runs only when the setting is enabled.

5. Generated output workflows
   - Add optional commands to generate IP-XACT outputs and show diff/preview.
   - Settings: enable flag, output directory override, and auto-open behavior.
   - Commands remain hidden/disabled when the feature is off.

## Non-Goals (Near Term)

- Full semantic IP-XACT authoring or schema-aware refactors inside mixed TxtJet files.
- Background validation or indexing when the user has not explicitly enabled it.
- Forcing IP-XACT naming conventions or file extensions.
