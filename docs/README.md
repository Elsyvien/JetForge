# JetForge project documentation

JetForge is a VS Code extension and headless toolkit for TxtJet and Eclipse JET-style templates. It helps a developer understand mixed generated text and embedded Java, follow template dependencies, inspect approximate output, connect an external compiler, and protect expected output with golden tests.

The repository contains three related surfaces: the editor extension, a CLI sharing its template/project core, and the static project website. JetForge's own analysis runs locally; configured compilers and fixture evaluators are project-owned tools.

## Read by task

| Goal | Documentation |
| --- | --- |
| Install the extension and open a first preview | [Main README](../README.md#60-second-quickstart) |
| Understand the components and data flow | [Architecture](ARCHITECTURE.md) |
| Write templates, includes, and skeletons | [Template language](TEMPLATE_LANGUAGE.md) |
| Configure a reproducible project and use the CLI | [Headless projects and golden tests](HEADLESS.md) |
| Navigate dependencies, connect a compiler, validate IP-XACT, or diagnose a problem | [Editor workflows and troubleshooting](WORKFLOWS.md) |
| Change the implementation and choose tests | [Development guide](DEVELOPMENT.md) and [contribution guide](../CONTRIBUTING.md) |
| Perform manual editor or release acceptance checks | [QA checklist](QA_CHECKLIST.md) |

For current limitations and future direction, see the [IntelliSense roadmap](INTELLISENSE_ROADMAP.md) and [IP-XACT scope](IPXACT_ROADMAP.md). These describe direction as well as shipped behavior; source and tests determine what the implementation currently supports.

## The central distinction

A template has two languages: Java inside template blocks and a selected target language outside them. An XML output template still contains Java expressions; choosing XML changes how the surrounding text and output preview are presented.

JetForge offers three ways to inspect a template:

| Result | What produces it | What it establishes |
| --- | --- | --- |
| Generated-output preview | Local template transformation | Output shape, expanded includes, expression locations, and source origins |
| Generated Java preview | Local projection into a Java class or token skeleton | Where embedded Java belongs and where Java tooling can provide assistance |
| Evaluated output | Configured external compiler or command-mode fixture evaluator | The actual result produced by that project tool for its input |

Both local previews are approximations. Scriptlets become visible placeholders in the output preview, expressions remain unevaluated, and a loop is not executed. The Java preview is an editor projection rather than Eclipse compiler output. This distinction also applies to the CLI: `generate` writes preview output; a `command` golden case executes the configured evaluator.

## A typical project lifecycle

1. Author a root template and reusable include fragments. Choose or detect the target language.
2. Open the output preview and inspect origins; use the Java preview for embedded Java navigation.
3. Resolve missing dependencies and inspect the impact graph before shared-file edits.
4. For repeatable terminal/editor project operations, check in a `.jetforge.json` contract with source roots and named golden cases.
5. Connect a project compiler when real evaluation or compiler diagnostics are required.
6. Run local validation and golden tests. Review an output change before updating its expected baseline.

## Where authoritative definitions live

Command contributions, setting defaults/scopes, supported language IDs, and npm scripts are declared in `package.json`. `.jetforge.json` is a separate, project-level headless contract. The two configuration systems serve different workflows and are not automatically merged. The [headless guide](HEADLESS.md#editor-settings-and-project-configuration) explains how to choose between them.

Use [SUPPORT.md](../SUPPORT.md) for help and [SECURITY.md](../SECURITY.md) for private vulnerability reporting. Compatibility examples are sanitized; keep private templates and generated customer output outside contributions.
