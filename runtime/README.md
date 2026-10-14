# Built-in compiler runtime

`java/dev/jetforge/runtime/` is JetForge-owned source. `npm run build:runtime`
reproducibly builds `jetforge-runtime.jar` with `javac --release 21` and fixed JAR
entry timestamps. The JAR is a generated packaging artifact, not committed code.
The installed VSIX includes it, Gson, and the third-party license; runtime use
never downloads dependencies.

Gson **2.14.0** is pinned from Maven Central:
https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.14.0/gson-2.14.0.jar

SHA-256: `2cbd119bf1961c28788310963dc80ba65f58cdeec1dd139c8bdb1240faa2c36f`.
Its Apache-2.0 license is in `lib/GSON-LICENSE`. The build verifies this digest.

Protocol version 1 uses a request JSON file and a separate result JSON file in
one temporary run directory. The JVM receives `-Xmx256m`, UTF-8, and a bounded
process timeout. Template logs are separate from result JSON. Annotation
processing is disabled. A fresh process and classloader isolate successive
runs; this does not sandbox arbitrary project Java code.

Model ABI: `public String generate(Object argument) throws Exception`.
Default JSON objects/arrays become maps/lists; all JSON numbers become
`java.math.BigDecimal`. Strict parsing rejects malformed input; a streaming preflight rejects duplicate
object keys. Fixtures are limited to 4 MiB, depth 128, and 100000 tokens. Projects
can implement `dev.jetforge.runtime.ModelProvider` and receive a `ModelContext`
with project root, original fixture location, and parsed immutable input snapshot.
They compile against the bundled `jetforge-runtime.jar` and supply their classes
or JARs through the configured classpath/source roots.
