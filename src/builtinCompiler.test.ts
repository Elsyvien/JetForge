import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publishBuiltinOutput, runBuiltinCompiler } from "./builtinCompiler";
import { detectJavaToolchain } from "./javaToolchain";

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "jetforge built-in ä-"));
  const template = join(root, "main.xmljet");
  const fixture = join(root, "model.json");
  const input =
    '<%@ jet package="demo" class="Component" imports="java.util.Map;java.util.List" %><% Map<?, ?> model = (Map<?, ?>)argument; %><%-- invisible --%><%@ include file="item.jetinc" %>';
  const fragment =
    '<%! private String upper(String s) { return s.toUpperCase(java.util.Locale.ROOT); } %><% for (Object field : (List<?>)model.get("fields")) { %><item><%= upper(field.toString()) %></item><% } %>|<%= model.get("large") %>';
  try {
    writeFileSync(template, input);
    writeFileSync(join(root, "item.jetinc"), fragment);
    writeFileSync(
      fixture,
      '{"fields":["alpha","β"],"large":9007199254740993123456789}',
    );
    const run = (
      extra: Partial<Parameters<typeof runBuiltinCompiler>[0]> = {},
    ) =>
      runBuiltinCompiler({
        root,
        template,
        fixture,
        mode: "evaluate",
        ...extra,
      });
    const result = await run();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      result.output,
      "<item>ALPHA</item><item>Β</item>|9007199254740993123456789",
    );
    publishBuiltinOutput(root, "generated/result.xml", result);
    assert.equal(
      readFileSync(join(root, "generated/result.xml"), "utf8"),
      result.output,
    );
    assert.throws(() => publishBuiltinOutput(root, "../escape.xml", result));
    assert.throws(() => publishBuiltinOutput(root, template, result), /compiler input/);
    assert.throws(() =>
      publishBuiltinOutput(root, "generated/result.xml", {
        ...result,
        ok: false,
      }),
    );
    const compiled = await run({ mode: "compile" });
    assert.equal(compiled.ok, true);
    assert.equal(compiled.output, undefined);
    const absentJdk = await run({ javaHome: join(root, "no-jdk") });
    assert.equal(absentJdk.diagnostics[0].code, "JDK_UNAVAILABLE");
    assert.equal(
      (await run({ release: 8 })).diagnostics[0].code,
      "JDK_UNAVAILABLE",
    );
    assert.equal(
      (await run({ runtimeRoot: root })).diagnostics[0].code,
      "RUNNER_ERROR",
    );
    assert.equal(
      (await run({ modelProvider: "wrong name" })).diagnostics[0].code,
      "MODEL_LOAD",
    );
    writeFileSync(join(root, "item.jetinc"), "<%= unknownSymbol %>");
    assert.throws(() => publishBuiltinOutput(root, "generated/result.xml", result), /stale/i);
    const invalid = await run();
    assert.equal(invalid.ok, false);
    assert.equal(invalid.diagnostics[0].code, "JAVA_COMPILE");
    assert.equal(invalid.diagnostics[0].fileName, join(root, "item.jetinc"));
    writeFileSync(
      join(root, "item.jetinc"),
      "<%\tint value = unknownSymbol; %>",
    );
    const tabError = await run();
    assert.equal(
      tabError.diagnostics[0].range?.start,
      "<%\tint value = unknownSymbol; %>".indexOf("unknownSymbol"),
    );
    writeFileSync(
      join(root, "item.jetinc"),
      '<% throw new IllegalStateException("failure"); %>',
    );
    assert.equal((await run()).diagnostics[0].code, "JAVA_COMPILE"); // unconditional throw makes emitter return unreachable
    writeFileSync(
      join(root, "item.jetinc"),
      '<% if (argument != null) throw new IllegalStateException("failure"); %>',
    );
    assert.equal((await run()).diagnostics[0].code, "TEMPLATE_RUNTIME");
    writeFileSync(
      join(root, "item.jetinc"),
      '<% System.out.println("log"); System.err.println("error log"); %>ok',
    );
    const logs = await run();
    assert.equal(logs.ok, true);
    assert.equal(logs.output, "ok");
    assert.match(logs.stdout, /log/);
    assert.match(logs.stderr, /error log/);
    writeFileSync(fixture, "{");
    assert.equal((await run()).diagnostics[0].code, "MODEL_LOAD");
    writeFileSync(fixture, '{"a":null,"a":1}');
    assert.equal((await run()).diagnostics[0].code, "MODEL_LOAD");
    writeFileSync(fixture, "{}");
    assert.equal(
      (await run({ fixture: "missing.json" })).diagnostics[0].code,
      "MODEL_LOAD",
    );
    assert.equal(
      (await run({ modelProvider: "demo.NoSuchProvider" })).diagnostics[0].code,
      "MODEL_LOAD",
    );
    assert.equal(
      (await run({ isCurrent: () => false })).diagnostics[0].code,
      "STALE",
    );
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(
      (await run({ signal: aborted.signal })).diagnostics[0].code,
      "CANCELLED",
    );
    writeFileSync(join(root, "item.jetinc"), "<% Thread.sleep(10000); %>late");
    assert.equal(
      (await run({ timeoutMs: 1000 })).diagnostics[0].code,
      "TIMEOUT",
    );
    const cancel = new AbortController();
    const pending = run({ signal: cancel.signal });
    setTimeout(() => cancel.abort(), 600);
    assert.equal((await pending).diagnostics[0].code, "CANCELLED");
    writeFileSync(join(root, "item.jetinc"), "<% Thread.sleep(600); %>old");
    const stale = run();
    setTimeout(() => writeFileSync(join(root, "item.jetinc"), "new"), 400);
    assert.equal((await stale).diagnostics[0].code, "STALE");
    const fallback = join(root, "fallback");
    mkdirSync(fallback);
    writeFileSync(join(fallback, "late.jetinc"), "fallback");
    writeFileSync(template, '<% Thread.sleep(600); %><%@ include file="late.jetinc" %>');
    const changedIncludeResolution = run({ includePaths: ["fallback"] });
    setTimeout(() => writeFileSync(join(root, "late.jetinc"), "preferred"), 200);
    assert.equal((await changedIncludeResolution).diagnostics[0].code, "STALE");
    rmSync(join(root, "late.jetinc"));
    const fallbackOutput = await run({ includePaths: ["fallback"] });
    assert.equal(fallbackOutput.ok, true, JSON.stringify(fallbackOutput));
    assert.equal(fallbackOutput.output, "fallback");
    writeFileSync(join(root, "late.jetinc"), "preferred");
    assert.throws(() => publishBuiltinOutput(root, "generated/result.xml", fallbackOutput), /stale/i);
    rmSync(join(root, "late.jetinc"));
    const tokenSkeleton = "${packageDeclaration} public class ${class} { ${generateMethod} }";
    writeFileSync(join(fallback, "late.skeleton"), tokenSkeleton);
    writeFileSync(template, '<%@ jet skeleton="late.skeleton" %><% Thread.sleep(600); %>fallback');
    const changedSkeletonResolution = run({ skeletonPaths: ["fallback"] });
    setTimeout(() => writeFileSync(join(root, "late.skeleton"), tokenSkeleton), 200);
    assert.equal((await changedSkeletonResolution).diagnostics[0].code, "STALE");
    writeFileSync(join(root, "late.skeleton"), "public class ${class} { ${generateMethod} }");
    for (const mode of ["compile", "evaluate"] as const) {
      assert.equal((await run({ mode })).diagnostics[0].code, "UNSUPPORTED_SYNTAX");
    }
    writeFileSync(template, input);
    writeFileSync(
      join(root, "item.jetinc"),
      '<%= "x".repeat(9 * 1024 * 1024) %>',
    );
    assert.equal((await run()).diagnostics[0].code, "RESOURCE_LIMIT");
    writeFileSync(
      join(root, "item.jetinc"),
      '<% System.out.print("x".repeat(300000)); %>ok',
    );
    assert.match((await run()).stdout, /log truncated/);
    writeFileSync(join(root, "item.jetinc"), "<% System.exit(0); %>");
    assert.equal((await run()).diagnostics[0].code, "RUNNER_ERROR");
    writeFileSync(
      template,
      '<%@ jet imports="example.Model" %><%= ((Model)argument).name() %>',
    );
    const javaRoot = join(root, "model-src/example");
    mkdirSync(javaRoot, { recursive: true });
    writeFileSync(
      join(javaRoot, "Model.java"),
      "package example; public record Model(String name) {}",
    );
    writeFileSync(
      join(javaRoot, "Provider.java"),
      'package example; import dev.jetforge.runtime.*; public class Provider implements ModelProvider { public Object load(ModelContext c) { return new Model("typed"); } }',
    );
    const provider = await run({
      sourceRoots: ["model-src"],
      modelProvider: "example.Provider",
    });
    assert.equal(provider.ok, true, JSON.stringify(provider));
    assert.equal(provider.output, "typed");
    const jdk = await detectJavaToolchain();
    const classes = join(root, "model-classes");
    mkdirSync(classes);
    execFileSync(jdk.javac, [
      "--release",
      "21",
      "-cp",
      resolve("runtime/jetforge-runtime.jar"),
      "-d",
      classes,
      join(javaRoot, "Model.java"),
      join(javaRoot, "Provider.java"),
    ]);
    const jar = jdk.java.replace(
      /java(?:\.exe)?$/,
      process.platform === "win32" ? "jar.exe" : "jar",
    );
    execFileSync(jar, [
      "--create",
      "--file",
      join(root, "model.jar"),
      "-C",
      classes,
      ".",
    ]);
    assert.equal(
      (
        await run({
          classpath: ["model.jar"],
          modelProvider: "example.Provider",
        })
      ).output,
      "typed",
    );
    assert.equal((await run({ classpath: ["missing.jar"] })).ok, false);
    assert.equal((await run({ template: "../outside.txtjet" })).ok, false);
    writeFileSync(
      template,
      '<?xml version="1.0"?>' + "x".repeat(7999) + '😀\r\n\\"\u0000',
    );
    const unicode = await run({ fixture: undefined });
    assert.equal(unicode.ok, true, JSON.stringify(unicode));
    assert.equal(unicode.output, readFileSync(template, "utf8"));
    console.log("builtin compiler JVM integration tests ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
