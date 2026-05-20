# IntelliSense Roadmap

TxtJet Syntax currently provides highlighting, snippets, lightweight diagnostics, Quick Fixes, completions for TxtJet constructs, generated-output language modes, read-only generated previews, outline symbols, and include navigation. It does not provide full semantic IntelliSense for Java or generated target languages inside `.txtjet` files.

## Eclipse JET Reference Points

Eclipse EMF JET treats templates as source for generated Java classes. The modern Eclipse JET editor uses an embedded Java editor to provide content assist, quick assist, refactoring, and formatting. It can compile templates in memory, map Java problem markers back to template locations, and show the compiled Java output synchronized with the template.

Useful references:

- Eclipse EMF JET overview: https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet/jet.html
- Eclipse JET tutorial: https://help.eclipse.org/latest/topic/org.eclipse.emf.doc/tutorials/jet1/jet_tutorial1.html
- Eclipse Java editor capabilities: https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/concepts/concept-java-editor.htm
- GMF template naming conventions: https://wiki.eclipse.org/Graphical_Modeling_Framework/Development_Guidelines

## Why Full Inline IntelliSense Is Not In 0.0.8

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
  - Current mappings support tests, preview refresh behavior, reveal commands between source and preview, and optional generated-Java diagnostic mapping.

- IntelliSense-adjacent editor support
  - Outline symbols summarize directives, declarations, scriptlets, expressions, and generated-output regions.
  - Include `file="..."` references support Go to Definition for relative paths.
  - Directive completions include `skeleton` alongside the existing directive names and attributes.

## Remaining Future Direction

1. Inline IntelliSense
   - Only after the preview and mapping model is stable, evaluate inline completions/hovers for Java template blocks.
   - Avoid a broad language-server bridge until there is evidence that preview-based workflows are insufficient.

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
