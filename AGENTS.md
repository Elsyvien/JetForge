# Working on JetForge

## Read by task

- Code changes: read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for module boundaries, behavioral contracts, and the verification matrix.
- Architecture, template semantics, project configuration, or operational documentation: use [docs/README.md](docs/README.md) to reach the matching project chapter.
- User-visible workflows or settings: read the relevant section of [README.md](README.md) and the matching `package.json` contribution before editing.
- Editor or release validation: use the relevant scenarios in [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md).
- IntelliSense or IP-XACT scope: consult [docs/INTELLISENSE_ROADMAP.md](docs/INTELLISENSE_ROADMAP.md) or [docs/IPXACT_ROADMAP.md](docs/IPXACT_ROADMAP.md), then confirm implemented behavior in source.

## Change workflow

1. Inspect the working tree and preserve unrelated local changes. Use sanitized fixtures for reproducible examples; private templates and their outputs stay local.
2. Locate the responsible module using the development guide. Keep shared template/project logic independent of VS Code and preserve the contracts documented there.
3. Run the verification branch for the changed surface. Completion requires passing applicable checks, current documentation for changed behavior, and a diff containing only intended changes. Report any check that could not run and its reason.

## Commit attribution

When creating a Git commit with Codex, preserve the user's Git author identity and append this trailer to the commit message, separated from the body by a blank line:

Co-authored-by: Codex <noreply@openai.com>

Include the trailer exactly once. Verify it in the resulting commit message.
