# Template language and output modes

TxtJet templates mix generated text with JET/JSP-style Java blocks. JetForge understands the local structure needed for highlighting, diagnostics, previews, navigation, and conservative edits. Version 2 projects can select the [built-in `jetforge-v1` compiler](BUILTIN_COMPILER.md); other projects can connect their own external compiler.

## Block syntax

| Syntax | Meaning | Local preview behavior |
| --- | --- | --- |
| Ordinary text | Text intended for generated output | Copied into the output projection; converted into Java string append statements in the Java projection. |
| `<% ... %>` | Java scriptlet | Shown as a placeholder/comment in output; projected inside the Java `generate()` method. |
| `<%= ... %>` | Java expression contributing output | Replaced by a target-aware placeholder in output; projected as an append expression in Java. |
| `<%! ... %>` | Class-level declarations/helpers | Shown as a placeholder/comment in output; placed at class scope in Java. |
| `<%@ ... %>` | Template directive | Parsed for metadata and file references; includes can expand in the output preview. |

JetForge's structural scanner reports missing closing delimiters, unexpected `%>`, malformed directives, and unterminated quoted directive values. This is template validation, not Java compilation.

## A small template

```jsp
<%@ jet package="demo.templates" class="GreetingTemplate" %>
<%! public String greet(String name) { return "Hello, " + name; } %>
<% String name = "Ada"; %>
<message><%= greet(name) %></message>
```

Select `TxtJet XML Output` for the outer XML. The Java declaration and scriptlet remain Java. The local output preview shows the `<message>` shape and an expression placeholder; it does not call `greet`. The Java preview shows the helper at class scope and the scriptlet/expression in its generated method.

For a template containing a Java loop, the output projection shows the loop's text body without executing or repeating it. Use a real compiler or an explicitly configured evaluator when validating runtime output.

## The `jet` directive

```jsp
<%@ jet package="demo.templates" class="ComponentTemplate"
    imports="java.util.List;java.util.Map"
    skeleton="skeletons/base.skeleton" %>
```

| Attribute | JetForge use |
| --- | --- |
| `package` | Package of the generated Java preview and workspace class identity. |
| `class` | Generated preview class name and cross-template class index. |
| `imports` | Imports in the Java preview and local Java assistance. |
| `skeleton` | Relative reference to a preview class layout. |
| `ipxact="true"` | Per-template IP-XACT match when the feature is enabled. |

Directive attributes use single- or double-quoted values. Duplicate attributes and malformed attribute text are diagnosable. Only one root `jet` directive is expected; duplicate directives are reported. Project-specific completion attributes can be configured through `txtjet.completions.directiveMetadata`; the target compiler still decides what custom metadata means.

The Java preview splits `imports` on semicolons or commas. Separate import names with one of those delimiters rather than spaces.

Without usable package/class metadata, the Java projection falls back to `txtjet.generated.GeneratedTxtJetTemplate`. These are editor defaults rather than a prescribed output class for every compiler.

## Includes and search roots

```jsp
<%@ include file="partials/header.jetinc" %>
```

An include is a reusable fragment. `.jetinc` files are indexed as includes rather than standalone generation roots. An included `.txtjet` file is also a recognized template and can therefore appear as a standalone generation root when it is inside the discovered sources.

Resolution checks candidates in this order:

1. The directory containing the referencing template.
2. Configured include or skeleton search roots, in their configured order.
3. Within each root, the exact reference; if it is extensionless, also `.txtjet`, `.jetinc`, and `.skeleton` variants.

An explicit extension uses the exact filename. References are relative; absolute directive references are rejected. A relative `..` reference must still satisfy the caller's allowed-root checks.

For editor resolution, configure `txtjet.resolution.includePaths` and `txtjet.resolution.skeletonPaths`. For disk-based project operations, configure `includePaths` and `skeletonPaths` in `.jetforge.json`. Keep fragments/skeletons within discovered source directories when they must participate in workspace indexing and validation, not merely be readable by a preview.

The output preview expands includes with visible boundary annotations and retains the fragment's filename/ranges for provenance. Missing references, cycles, and excessive nesting produce explanatory preview content instead of unbounded recursion. Editor previews use unsaved open fragment text; the CLI reads disk.

## Preview skeletons

```jsp
<%@ jet package="demo.templates" class="ComponentTemplate"
    skeleton="skeletons/base.skeleton" %>
```

A minimal `skeletons/base.skeleton`:

```java
${packageDeclaration}

${imports}

public final class ${class} {
${members}
${generateMethod}
}
```

The Java preview recognizes these tokens:

| Token | Replacement |
| --- | --- |
| `${package}` | Package name only. |
| `${packageDeclaration}` | Complete `package ...;` declaration. |
| `${imports}` | Generated import declarations. |
| `${class}` | Class name. |
| `${members}` | Projected `<%! ... %>` declarations. |
| `${generateMethod}` | Projected method with scriptlets, expressions, and append statements. |

This token layout is JetForge's preview convention. It does not establish compatibility with every Eclipse JET skeleton format. If the skeleton cannot be loaded or lacks supported tokens, the Java preview uses its default class layout with reference/status information. See the sanitized [skeleton example](../examples/skeleton-directive.txtjet).

## Choosing the outer language

The generic mode is `txtjet`; target modes are `txtjet-java`, `txtjet-html`, `txtjet-xml`, `txtjet-c`, `txtjet-python`, and `txtjet-latex`. Supported template suffixes include `.txtjet`, `.jet`, `.javajet`, `.htmljet`, `.xmljet`, `.cjet`, `.pythonjet`, `.texjet`, `.latexjet`, `.propertiesjet`, and `.jetinc`.

Use the status bar or **TxtJet: Select Generated Output Mode** for a manual choice. Manual choices are remembered per file in the workspace; automatic guesses are not. Detection prefers filename hints, then content. It switches default-mode files without overriding a manually selected target mode.

Outer-language suggestions and highlighting follow this choice. A Python output template can still use Java inside `<% ... %>`; selecting Python does not change its embedded language.

For explicit output generation, target extensions are `txt`, `java`, `html`, `xml`, `c`, `python`, and `tex`. The Python mode currently appends `.python`, reflecting the implementation's `targetOutputExtension` behavior; it does not append `.py`. Golden expected filenames can use any project-contained name, including `.py`.

## What language assistance covers

Directive assistance suggests core attributes and local reference candidates. Local helper methods in declaration blocks support navigation, references, narrow rename, hover signatures, and signature help for direct calls and `this.` calls. Calls on unrelated receivers, strings, and comments are excluded from local helper rename.

Workspace templates with `@jet class` metadata can supply accessible methods to common cross-template Java receiver patterns. Installed Java tooling can provide additional completion, hover, and definition when it accepts the generated virtual Java document. Full semantic Java analysis, arbitrary cross-file Java rename, and runtime execution remain outside the local parser/index.

Formatting normalizes supported template Java/directive structure while preserving generated outer text. Treat a formatter result as an edit to review when templates have unusual whitespace-sensitive output.

Continue with [Editor workflows](WORKFLOWS.md) or [Headless projects](HEADLESS.md).
