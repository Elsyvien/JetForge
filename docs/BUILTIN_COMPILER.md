# Built-in TxtJet compiler

JetForge can compile and execute Java-based templates locally with a JDK 21 or
newer. The `jetforge-v1` dialect is explicit: it preserves the existing preview
workflow and adds real execution through a version 2 project. No Eclipse
installation or handwritten compiler command is needed for this backend.

## First project

```json
{
  "version": 2,
  "sourcePaths": ["templates"],
  "includePaths": ["templates/partials"],
  "skeletonPaths": ["templates/skeletons"],
  "compiler": {
    "backend": "builtin",
    "dialect": "jetforge-v1",
    "release": 21,
    "timeoutMs": 30000
  },
  "targets": [{
    "name": "greeting",
    "template": "templates/greeting.xmljet",
    "fixture": "fixtures/ada.json",
    "output": "generated/greeting.xml"
  }],
  "tests": [{
    "name": "greeting-golden",
    "target": "greeting",
    "expected": "golden/greeting.xml"
  }]
}
```

`templates/greeting.xmljet`:

```jsp
<%@ jet package="demo.templates" class="Greeting" imports="java.util.Map" %><% Map<?, ?> model = (Map<?, ?>) argument; %><message><%= model.get("name") %></message>
```

`fixtures/ada.json`:

```json
{"name":"Ada"}
```

Targets have unique names and output paths. Template, fixture, baseline,
classpath, and Java-source paths remain inside the project, including symlink
containment. Generation cannot overwrite compiler inputs or golden baselines.
A v2 project uses this backend explicitly; v1 and command-mode cases retain
their existing behavior. A target-backed case is normalized to `mode: "builtin"`.

## Compile, evaluate, generate, test

After compiling the toolkit, run:

```sh
node out/cli.js doctor --root /path/to/project
node out/cli.js compile --target greeting --root /path/to/project
node out/cli.js evaluate --target greeting --root /path/to/project --format json
node out/cli.js generate --target greeting --root /path/to/project
node out/cli.js validate --compiler --root /path/to/project --format sarif
node out/cli.js test --root /path/to/project --format junit
```

- `compile` translates and checks Java without invoking the template or loading
  its fixture. All named targets are compiled when `--target` is omitted.
- `evaluate` returns the real output from a temporary run. It does not write the
  configured output file.
- `generate` evaluates and atomically publishes each successful, current target.
  A failed target leaves its previous valid output in place. Targets run in order;
  this is not an all-project transaction.
- `validate` keeps its existing local checks. `--compiler` additionally compiles
  targets; JSON includes `compilerResults`, and SARIF includes mapped compiler
  locations. Unmapped Java problems have no invented template location.
- `test` evaluates named targets in temporary runs and compares the exact bytes
  with saved golden files, including CRLF/LF. Existing preview/command cases keep
  their historical normalized-line-ending comparison.
- `test --update` explicitly replaces approved baselines. Review the resulting
  diff; ordinary generation never updates them.

Formats for compile/evaluate/generate are text and JSON. Existing CLI exit codes
remain `0` for success, `1` for failed checks/execution, and `2` for invalid
arguments/configuration. A selected unknown target is a configuration error.

The checked-in example is [compatibility-projects/builtin-compiler](../compatibility-projects/builtin-compiler/).

## Editor workflow

Open a v2 project and use **JetForge: Compile Built-in Target**, **Evaluate
Built-in Target**, **Generate Built-in Target**, or **Validate Built-in Project**.
Choose a target when its template has multiple fixtures. Actual output opens in
a read-only `jetforge-builtin-output` document. The ordinary compile/generate/diff
commands also select the builtin path for templates belonging to named targets.
The quick output preview remains an unevaluated, JDK-free shape preview.

Direct builtin target commands read open buffers for templates, includes,
skeletons, configuration, JSON fixtures and configured Java sources. The CLI
reads disk. Deterministic templates using the same snapshot and JDK/environment
produce identical bytes through either adapter. The Java authoring
projection exposes `argument` for a configured builtin template but is still an
approximation; installed Java language tooling has its own project classpath.

Execution requires Workspace Trust, including programmatic commands and golden
test profiles. Local preview authoring remains available in Restricted Mode.
The compiler reads resource-scoped `txtjet.compiler.javaHome` if selected.
Otherwise it checks `JETFORGE_JAVA_HOME`, then automatic `JAVA_HOME`/PATH and
macOS installations. An explicit invalid selection fails; a stale automatic
`JAVA_HOME` may fall back. Both matching `java` and `javac` must be present.
`release` defaults to 21 and cannot exceed the selected JDK version.

IP-XACT remains opt-in. A builtin IP-XACT target is evaluated before its external
validator runs. The validator consumes the real XML, not expression placeholders.
Problems without proven dynamic output mappings appear on the evaluated XML.
The configured schema and validator remain authoritative for full IP-XACT/XSD
validation.

## Model ABI and project classes

The generated class exposes:

Missing package/class metadata uses `txtjet.generated.GeneratedTxtJetTemplate`,
the same default identity as the authoring projection. Explicit invalid metadata
fails compilation rather than being replaced.

```java
public String generate(Object argument) throws Exception
```

Default JSON objects become maps, arrays become lists, booleans/strings/null
retain their meanings, and every number becomes `java.math.BigDecimal`. This
preserves large integers and decimal precision. Use explicit casts rather than
implicit template variables. Duplicate JSON keys are rejected even when their
first value is null. A missing fixture passes null as `argument`.

For typed Java/EMF models, add `modelProvider` and dependencies:

```json
{
  "backend": "builtin",
  "dialect": "jetforge-v1",
  "classpath": ["lib/model.jar", "build/classes"],
  "sourceRoots": ["model-src"],
  "modelProvider": "example.ComponentProvider"
}
```

This object belongs under `compiler`. A target-level `modelProvider` overrides
the project provider. Classpath entries are concrete directories/JARs; Java files
under explicitly configured source roots are copied into the same run snapshot
and compiled with the generator. Prebuilt dependencies stay project-owned.

```java
package example;
import dev.jetforge.runtime.ModelContext;
import dev.jetforge.runtime.ModelProvider;

public class ComponentProvider implements ModelProvider {
  public Object load(ModelContext context) {
    return new ComponentModel(context.fixture());
  }
}
```

Compile provider classes against JetForge's bundled `runtime/jetforge-runtime.jar`.
`ModelContext` supplies the project root, original fixture path and parsed fixture
snapshot. Providers decide how to construct actual model classes; JSON maps are
not automatically converted into arbitrary EMF objects. Only configured compiler
inputs are fingerprinted; arbitrary provider filesystem/network activity is
project code.

## Dialect and mapping contracts

- Literal text, `<% … %>`, `<%= … %>`, `<%! … %>`, `<%-- … --%>`, core `@jet`
  metadata and nested `@include file="…"` are supported. `ipxact` is metadata.
- Declarations become class members; scriptlets run inside `generate`; expression
  values use Java `StringBuilder.append` overload semantics. An untyped literal
  `null` may need an Object/String cast, just as other overloaded Java calls do.
- Literal UTF-8 text and LF/CRLF remain unchanged. Directives/comments emit no
  text, while surrounding literal whitespace remains. Escape sequences, long
  literal chunks and supplementary Unicode characters are preserved.
- `%>` is a template delimiter even inside Java strings; use ordinary Java
  concatenation when that literal is required. JET comments close with `--%>`.
- Token skeletons support `${package}`, `${packageDeclaration}`, `${imports}`,
  `${class}`, `${members}`, and `${generateMethod}`. Each token is used once;
  class and method are required, and declarations require members.
- Classic Eclipse `CLASS` skeletons, include alternatives, custom tags, and
  attributes such as `builder`, `nlString` and `minimize` produce
  `UNSUPPORTED_SYNTAX`. There is no silent fallback to approximate output.
- Java source ranges retain root/include/Java-source origins. Scaffolding errors
  remain generated-Java problems. Runtime stack locations are mapped only where
  the compiler can prove their origin. Dynamic output has no fabricated line map.

The Eclipse reference gate documents intentional dialect differences separately
from matching outputs. It is a limited semantic comparison, not a claim that all
Eclipse projects, skeletons or tooling are supported.

## Execution, budgets and packaging

The frontend is independent of VS Code and returns Java, mappings, dependencies
and diagnostics. The shared service snapshots inputs, detects a JDK, launches the
packaged runner without a shell, checks current inputs and publishes output.
Runner protocol version 1 keeps JSON results separate from template logs.
`JavaCompiler` runs with `-proc:none`; each evaluation has a fresh JVM/classloader.
Successive runs cannot reuse template static state. Annotation processors are
not executed. These process boundaries are not a sandbox for trusted Java code.

Bounds: 4 MiB per input, 4 MiB frontend aggregate, 16 MiB combined inputs, 256
frontend files, 100000 delimiter tokens/mappings, 200 reported diagnoses, 64 include levels, 512 expansions, 8 MiB output, 256 KiB per
template log, and 256 MiB JVM heap. Fixtures additionally allow depth 128 and
100000 JSON tokens. Classpath fingerprinting permits 5000 files/10000 entries,
64 MiB per file and 256 MiB total. v2 path lists have at most 64 roots. The default
JVM timeout is 30 seconds, configurable from 1 to 600 seconds. Children are
terminated on cancellation/timeout and on normal runner completion.

Configured source, include, skeleton, fixture, config and classpath changes make
a result stale. Editor changes also abort the active run. Temp run directories
are removed on success/failure; explicit generation alone changes a canonical
output. Protocol failure, model load failure, Java compile failure, runtime
exception, timeout, cancellation and stale results have separate error codes.

Classpath directories/JARs and Java sources are copied into each run snapshot;
later changes cannot alter an executing classloader's dependencies. Generated
destinations stay outside configured classpath/source-root inputs. Providers
receive the original project/fixture paths alongside the parsed fixture snapshot.

The reference gate pins Eclipse EMF codegen 2.29.0 and its checksummed development
dependencies. Its standalone harness disables only the workspace-bound JDT
package/class name validator; the reference parser/emitter is unchanged and
`javac` validates both emitted classes. The driver fixes LF for reference line
separators. Literal escaping, model expressions, loops, nested includes and JET
comments match. Leading directive whitespace and CRLF normalization differ
deliberately; `<%! … %>` class declarations are a JetForge dialect extension.

Gson 2.14.0 is bundled with its license and verified SHA-256. The runtime does not
download anything. `npm run compile` builds TypeScript and the Java runner, so
development needs Node.js 22+ and a JDK 21+. JAR entry timestamps are fixed;
reproduce bytes with the same JDK/compiler version. Installed users need a JDK
only for actual execution. See [runtime/README.md](../runtime/README.md).

## Verification entry points

Run `npm run test:compiler` for frontend, JVM and CLI contracts; `npm run test:eclipse`
for the pinned, explicit-network reference gate; `npm run verify:release` for unit,
coverage, headless, package and source/installed Extension Host checks. CI runs
the compiler on macOS/Linux/Windows with JDK 21 and 25 and verifies packaged VSIX
execution at the supported VS Code floor and stable. Read
[QA_CHECKLIST.md](QA_CHECKLIST.md) for editor acceptance scenarios.

### Larger-project measurement

An indicative local measurement on 2026-10-14 used macOS arm64 and JBR 21.0.7:
32 included fragments, 100 configured Java source files and 4000 model rows
(418900 fixture bytes) produced 565546 output bytes. Three evaluations, each
with a fresh JVM and Java compilation, took 580, 521 and 556 ms. Node's recorded
maximum resident set was 66784 KiB; the runner reported 43.6–44.4 MB of occupied
Java heap after generation. The heap measurement is a sample, not a process peak.
These timings describe this synthetic workload and machine, not a latency guarantee.
