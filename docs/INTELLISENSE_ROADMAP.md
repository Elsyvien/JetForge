# IntelliSense Roadmap

TxtJet Syntax currently provides highlighting, parser-backed visual region differentiation, snippets, lightweight diagnostics, compiler-backed diagnostics through a configured external compiler, Quick Fixes, completions for TxtJet constructs, generated-output language modes, read-only generated previews, outline symbols, include navigation, conservative Java IntelliSense forwarding for template Java blocks, local helper References/Rename/Signature Help, and local generated-output fallback suggestions for Java, Python, and C/C++. It does not implement full semantic analysis directly or provide full generated target-language language-server behavior inside `.txtjet` files.

## Eclipse JET Reference Points

Eclipse EMF JET treats templates as source for generated Java classes. The modern Eclipse JET editor uses an embedded Java editor to provide content assist, quick assist, refactoring, and formatting. It can compile templates in memory, map Java problem markers back to template locations, and show the compiled Java output synchronized with the template.

Useful references:

- Eclipse EMF JET overview: https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet/jet.html
- Eclipse JET tutorial: https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet1/jet_tutorial1.html
- Eclipse Java editor capabilities: https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/concepts/concept-java-editor.htm
- GMF template naming conventions: https://wiki.eclipse.org/Graphical_Modeling_Framework/Development_Guidelines

## Why Full Inline IntelliSense Is Not In The Current Release

VSCode language servers generally operate on one coherent language document. A `.txtjet` file mixes generated output text with Java template code. The current TextMate embedded-language mappings improve highlighting, but they do not automatically give full Java/Python/C/XML/HTML language-server behavior inside mixed template regions.

## Implemented Preview-First Foundation

- Generated output preview
  - Opens a local read-only virtual document for the active template.
  - Preserves generated outer text, expands relative includes, and keeps template code visible as stable language-appropriate comments/placeholders.
  - Uses the selected or detected generated-output language for preview highlighting.

- Generated Java template preview
  - Opens a local read-only virtual Java approximation of the template class.
  - Uses `@jet package`, `class`, and `imports` metadata when available.
  - Falls back to deterministic generated names for invalid or missing metadata.

- Source mapping foundation
  - The transformation layer returns source-to-preview ranges for generated output and generated Java previews.
  - Current mappings support tests, preview refresh behavior, region-aware preview commands, reveal commands between source and preview, and optional generated-Java diagnostic mapping.

- IntelliSense-adjacent editor support
  - Outline symbols summarize directives, declarations, scriptlets, expressions, and generated-output regions.
  - Include `file="..."` references support Go to Definition for relative paths.
  - Directive completions include `skeleton` alongside the existing directive names and attributes.
  - Scriptlet, expression, and declaration blocks can forward completion, hover, and Go to Definition requests through the generated Java preview when installed Java tooling can answer them.
  - Local helper methods declared in `<%! ... %>` blocks support Go to Definition, Find All References, conservative Rename Symbol, Hover fallback signatures, and Signature Help for direct and `this.` call sites.
  - Generated-output Java, Python, and C/C++ regions provide deterministic local fallback suggestions for common keywords, builtins, and standard-library members.
  - Parser-backed region classification distinguishes generated output, TxtJet markers, directives, and embedded template Java for editor decorations and fallback hover text.

- Workspace resolution, formatting, and generation helpers
  - Include and skeleton references can resolve through configured workspace search paths and extensionless `.txtjet`, `.jetinc`, and `.skeleton` candidates.
  - Document formatting and format selection normalize directive attributes, expressions, and template Java block indentation.
  - On-demand generation writes the generated-output approximation to disk and can diff the current output against the last generation snapshot.

- Compiler-backed diagnostics
  - `TxtJet: Validate Template With External Compiler` runs the configured compiler command, parses stdout/stderr with a configurable problem matcher, and maps generated Java/output locations back into `.txtjet` ranges where the preview source map is deterministic.
  - Optional on-save validation is available but disabled by default so compiler cost stays under workspace control.

## Remaining Future Direction

1. Inline IntelliSense
   - Harden the generated-Java provider bridge with more real-workspace validation and expand it only where source/edit mappings are deterministic.
   - Keep full semantic rename/edit application out of scope until it can be proven safe across scriptlet, expression, declaration, include-expanded, and skeleton-rendered regions. Local helper rename remains intentionally narrow.

2. Compiler-backed diagnostics
   - Continue expanding real-world matcher examples for Eclipse JET, `javac`, and team-specific compiler wrappers as new compiler output formats appear.
   - Keep diagnostics conservative: if a compiler problem cannot be mapped deterministically, leave it in the output channel instead of attaching it to the wrong template range.

## Additional Eclipse-Inspired Feature Ideas

- Split template/generated-Java view
  - Eclipse can show the compiled Java result below the template and synchronize cursor/selection between the views.
  - VSCode equivalent: a read-only side-by-side virtual document with range mapping back to the `.txtjet` source.

- Problem marker mapping
  - Eclipse maps problems in generated Java back to originating template ranges.
  - VSCode equivalent: map generated-preview diagnostics back into the template where source ranges are known.

- Outline navigation
  - Eclipse's JET editor exposes an outline that summarizes template contents and supports navigation.
  - VSCode equivalent: a `DocumentSymbolProvider` for directives, scriptlet blocks, declarations, includes, and generated-output sections.

- Directive-aware content assist
  - Eclipse content assist exposes JET directive syntax and attributes.
  - VSCode equivalent: richer directive completions for `@jet`, `@include`, `package`, `class`, `imports`, `skeleton`, `file`, and future project-specific directive metadata.

- Skeleton support
  - Eclipse supports a `skeleton` attribute in the `@jet` directive to customize the compiled Java class shape.
  - VSCode equivalent: parse, navigate, validate, hover, and render local token-based `.skeleton` files in generated Java previews.

- Include navigation
  - Eclipse supports navigation for `file` and `skeleton` links.
  - VSCode equivalent: `DefinitionProvider` for include files and skeleton files, plus diagnostics for missing relative references.

- Template naming conventions
  - Eclipse and GMF conventions encode generated output type in names such as `.javajet`, `.xmljet`, `.html.jet`, `.propertiesjet`, and `.jetinc`.
  - VSCode equivalent: expand filename hint detection while preserving `.txtjet` as the primary supported extension.

- Formatting strategy
  - Eclipse benefits from Java editor formatting for generated Java portions.
  - VSCode equivalent: command-driven formatting for selected template Java blocks first, then generated-preview formatting later.

## Non-Goals For The Next Release

- Do not build a full parser.
- Do not implement semantic Java analysis directly.
- Do not send code to external services.
- Do not depend on internal company systems.
