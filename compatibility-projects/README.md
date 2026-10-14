# JetForge compatibility projects

These sanitized projects exercise the checked-in headless contract against representative Eclipse JET patterns:

- `eclipse-basic`: `@jet` metadata, a skeleton, and an expanded include.
- `mixed-targets`: Python and HTML generated-output modes in one workspace.
- `fixture-evaluation`: trusted command-mode evaluation using a JSON model fixture.
- `builtin-compiler`: a standalone v2 project with nested includes, a token skeleton, precise JSON models, and byte-exact real JVM golden cases. Run `node out/cli.js test --root compatibility-projects/builtin-compiler`; the root v1 example excludes this project.

Run all cases from the repository root:

```sh
npm run headless -- doctor
npm run headless -- validate --format sarif
npm run headless -- test
```

Golden baselines are updated deliberately with `npm run headless -- test --update`.
