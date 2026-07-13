# Contributing to JetForge

JetForge welcomes focused bug fixes, compatibility fixtures, documentation improvements, and editor features that preserve deterministic source mappings.

## Development setup

1. Install Node.js 20 and Visual Studio Code.
2. Run `npm ci`.
3. Run `npm run verify` while developing.
4. Run `npm run verify:release` before opening a pull request.

Keep generated files, private templates, VSIX packages, and test-runtime downloads out of commits. Add regression coverage for behavioral changes, especially path containment, Restricted Mode, source mappings, refactors, external-command cancellation, and multi-root configuration.

## Pull requests

- Keep the change focused and explain the user-visible result.
- Update the changelog and relevant task-oriented documentation.
- Include sanitized fixtures only; never commit proprietary templates or generated customer output.
- Confirm `npm audit`, the Extension Host smoke test, package inspection, and release metadata validation pass.

JetForge intentionally fails closed when a source mapping or workspace edit cannot be proven safe. Changes should preserve that contract.
