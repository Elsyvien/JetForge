# Contributing to JetForge

JetForge welcomes focused bug fixes, compatibility fixtures, documentation improvements, and editor features that preserve deterministic source mappings.

## Development setup

1. Install Node.js 22 (the CI version) and Visual Studio Code.
2. Run `npm ci`.
3. Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to locate the responsible module and select verification for the changed surface.
4. For code changes, run `npm run verify`. For editor or package changes, also run the applicable smoke tests from the development guide. Release preparation requires `npm run verify:release`.

Keep generated files, private templates, VSIX packages, and test-runtime downloads out of commits. Add regression coverage for behavioral changes, especially path containment, Restricted Mode, source mappings, refactors, external-command cancellation, and multi-root configuration.

## Pull requests

- Keep the change focused and explain the user-visible result.
- Update relevant task-oriented documentation; add a changelog entry for public behavior changes.
- Include sanitized fixtures only; never commit proprietary templates or generated customer output.
- Report which checks passed and any check that could not run. CI additionally audits dependencies, inspects package contents, and tests the installed VSIX on Linux and Windows at the minimum and stable VS Code versions.

The change is ready for review when applicable checks pass, changed behavior is documented, and the diff contains only intended source and sanitized fixtures. Use [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) for manual acceptance scenarios.

JetForge intentionally fails closed when a source mapping or workspace edit cannot be proven safe. Changes should preserve that contract.
