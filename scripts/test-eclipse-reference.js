"use strict";

const assert = require("node:assert/strict");
const https = require("node:https");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { delimiter, join, resolve } = require("node:path");
const { detectJavaToolchain } = require("../out/javaToolchain");
const { runBuiltinCompiler } = require("../out/builtinCompiler");

// Explicit development/CI gate only. None of these artifacts is shipped in the VSIX.
const artifacts = [
  [
    "codegen",
    "org/eclipse/emf/org.eclipse.emf.codegen/2.29.0/org.eclipse.emf.codegen-2.29.0.jar",
    "ef4d7335cd4151ea547192f3212f85e403aa1e95f0d9c5248c0d257d73752ffe",
  ],
  [
    "common",
    "org/eclipse/emf/org.eclipse.emf.common/2.46.0/org.eclipse.emf.common-2.46.0.jar",
    "8329ca6f84a27a46517e6351697fc44060ed413ad231b4bbc0d813dd7ac87264",
  ],
  [
    "equinox-common",
    "org/eclipse/platform/org.eclipse.equinox.common/3.21.0/org.eclipse.equinox.common-3.21.0.jar",
    "2545ed27d408f19882695703097e5998bf25652bd0dac76a8e6d1391ec228ab7",
  ],
  [
    "core-runtime",
    "org/eclipse/platform/org.eclipse.core.runtime/3.35.0/org.eclipse.core.runtime-3.35.0.jar",
    "5b0c2794e9fe1785360dec920cc802f3388a0eb72ee25b89054b79ff3e2f07c9",
  ],
  [
    "jdt-core",
    "org/eclipse/jdt/org.eclipse.jdt.core/3.43.0/org.eclipse.jdt.core-3.43.0.jar",
    "d7cd3377d8c67e6b4ef6135625240d795e9a5626f1c2d85162835532351e5b50",
  ],
  [
    "ecj",
    "org/eclipse/jdt/ecj/3.43.0/ecj-3.43.0.jar",
    "c786468c65e906498e7e36ece4e0d04c6d3dd34c9a61b34a3a5b512801911a82",
  ],
  [
    "text",
    "org/eclipse/platform/org.eclipse.text/3.14.300/org.eclipse.text-3.14.300.jar",
    "a3e66c15596165de0869da6d18ce0d837eaa0584ff988a27c95618066e55cf04",
  ],
  [
    "resources",
    "org/eclipse/platform/org.eclipse.core.resources/3.22.200/org.eclipse.core.resources-3.22.200.jar",
    "0ab02f23810e0fce1ac95110ad7080a890471ed144ad32adbf228cdea59bf616",
  ],
  [
    "jobs",
    "org/eclipse/platform/org.eclipse.core.jobs/3.15.600/org.eclipse.core.jobs-3.15.600.jar",
    "accfc3bd0749e9a603a16366bf8430ae1ed442cf8c172f7abbb4d3355c29f662",
  ],
  [
    "osgi",
    "org/eclipse/platform/org.eclipse.osgi/3.23.100/org.eclipse.osgi-3.23.100.jar",
    "9164f40fd0b424caf21ca6518186d2af82691f2a8de452f8a7d290b955280a21",
  ],
  [
    "prefs",
    "org/osgi/org.osgi.service.prefs/1.1.2/org.osgi.service.prefs-1.1.2.jar",
    "43c7c870710e363405d422da653cce0d798a4537f76e4930f79bceadd3a55345",
  ],
  [
    "contenttype",
    "org/eclipse/platform/org.eclipse.core.contenttype/3.9.600/org.eclipse.core.contenttype-3.9.600.jar",
    "d8a2974f5ec3d7cfb8e3e177aa7303babed0a1565dbe5416084a751044255002",
  ],
  [
    "equinox-prefs",
    "org/eclipse/platform/org.eclipse.equinox.preferences/3.11.300/org.eclipse.equinox.preferences-3.11.300.jar",
    "7f8b452ee5f9d836db8534c6bd1a29a2662352d868ff94856b6b54bc8032a999",
  ],
];
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
function download(url) {
  return new Promise((resolveDownload, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(
          new Error(`Reference download HTTP ${response.statusCode}: ${url}`),
        );
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 15 * 1024 * 1024) {
          request.destroy(new Error("Reference artifact exceeds 15 MiB."));
        } else chunks.push(chunk);
      });
      response.on("end", () => resolveDownload(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.setTimeout(30000, () =>
      request.destroy(new Error("Reference download timed out.")),
    );
    request.on("error", reject);
  });
}

async function main() {
  const cache = resolve("tmp/eclipse-reference");
  mkdirSync(cache, { recursive: true });
  const jars = [];
  for (const [name, path, sha] of artifacts) {
    const file = join(cache, `${name}.jar`);
    if (!existsSync(file) || digest(readFileSync(file)) !== sha) {
      const data = await download(
        `https://repo.maven.apache.org/maven2/${path}`,
      );
      assert.equal(
        digest(data),
        sha,
        `Pinned reference checksum mismatch: ${name}`,
      );
      writeFileSync(file, data);
    }
    jars.push(file);
  }
  const jdk = await detectJavaToolchain();
  const root = mkdtempSync(join(tmpdir(), "jetforge-eclipse-reference-"));
  try {
    const helper = join(root, "Reference.java");
    // Name checks call ResourcesPlugin without a running Eclipse workspace. Only this
    // optional validator is disabled; the pinned JET parser/emitter is unchanged, and
    // both generated Java classes are subsequently validated by javac in our runner.
    writeFileSync(
      helper,
      `import java.nio.file.*; import java.io.*; import org.eclipse.emf.codegen.jet.JETCompiler;
public class Reference { public static void main(String[] args) throws Exception {
  var helper=Class.forName("org.eclipse.emf.codegen.util.CodeGenUtil$JDTHelper");
  var available=helper.getDeclaredField("IS_AVAILABLE"); available.setAccessible(true); available.setBoolean(null,false);
  var compiler=new JETCompiler(Path.of(args[0]).toUri().toString()); compiler.parse();
  try(var output=Files.newOutputStream(Path.of(args[1]))) { compiler.generate(output); }
} }`,
    );
    const referenceClasspath = [...jars, root].join(delimiter);
    execFileSync(jdk.javac, ["-cp", referenceClasspath, "-d", root, helper], {
      timeout: 30000,
    });
    const header = '<%@ jet package="reference" class="Sample" %>';
    const cases = [
      {
        name: "literal escaping",
        template: header + 'quote=" slash=\\ Unicode=β\n',
        expected: 'quote=" slash=\\ Unicode=β\n',
      },
      {
        name: "expressions and precise JSON",
        template:
          header +
          '<% java.util.Map<?,?> m=(java.util.Map<?,?>)argument; %><%= m.get("n") %>|<%= m.get("name") %>|<%= m.get("missing") %>',
        expected: "9007199254740993123456789|Ada|null",
      },
      {
        name: "scriptlet loop",
        template:
          '<%@ jet package="reference" class="Sample" imports="java.util.List" %><% for (String value : List.of("a","b")) { %><item><%= value.toUpperCase(java.util.Locale.ROOT) %></item><% } %>',
        expected: "<item>A</item><item>B</item>",
      },
      {
        name: "nested includes",
        template: header + '<%@ include file="first.jetinc" %>',
        expected: "first:second",
      },
      {
        name: "JET comment",
        template: header + "<%-- ignored --%>visible",
        expected: "visible",
      },
      {
        name: "directive whitespace",
        template: header + "\nhello\n",
        expected: "\nhello\n",
        reference: "hello\n",
      },
      {
        name: "CRLF literals",
        template: header + "\r\nhello\r\n",
        expected: "\r\nhello\r\n",
        reference: "hello\n",
      },
      {
        name: "class declarations",
        template:
          header +
          '<%! private String upper(String s) { return s.toUpperCase(java.util.Locale.ROOT); } %><%= upper("a") %>',
        expected: "A",
        referenceFailure: true,
      },
    ];
    const fixture = join(root, "model.json");
    writeFileSync(fixture, '{"n":9007199254740993123456789,"name":"Ada"}');
    writeFileSync(
      join(root, "first.jetinc"),
      'first:<%@ include file="second.jetinc" %>',
    );
    writeFileSync(join(root, "second.jetinc"), "second");
    const runtime = resolve("runtime/jetforge-runtime.jar");
    const gson = resolve("runtime/lib/gson-2.14.0.jar");
    for (const item of cases) {
      const template = join(root, "main.txtjet");
      writeFileSync(template, item.template);
      const builtin = await runBuiltinCompiler({
        root,
        template,
        fixture,
        mode: "evaluate",
      });
      assert.equal(
        builtin.ok,
        true,
        `${item.name}: ${JSON.stringify(builtin)}`,
      );
      assert.equal(builtin.output, item.expected);
      const source = join(root, "Sample.java");
      execFileSync(
        jdk.java,
        ["-cp", referenceClasspath, "Reference", template, source],
        { timeout: 30000 },
      );
      const classes = join(root, "classes");
      mkdirSync(classes, { recursive: true });
      const request = join(root, "request.json");
      const resultFile = join(root, "result.json");
      writeFileSync(
        request,
        JSON.stringify({
          version: 1,
          mode: "evaluate",
          source,
          sources: [],
          classes,
          qualifiedName: "reference.Sample",
          classpath: [runtime],
          release: 21,
          fixture,
          fixturePath: fixture,
          projectRoot: root,
        }),
      );
      execFileSync(
        jdk.java,
        [
          "-Xmx256m",
          "-Dfile.encoding=UTF-8",
          "-Dline.separator=\n",
          "-cp",
          [runtime, gson].join(delimiter),
          "dev.jetforge.runtime.Runner",
          request,
          resultFile,
        ],
        { timeout: 30000 },
      );
      const result = JSON.parse(readFileSync(resultFile, "utf8"));
      if (item.referenceFailure) {
        assert.equal(result.ok, false, item.name);
        assert.ok(
          result.diagnostics.some((problem) => problem.code === "JAVA_COMPILE"),
        );
      } else {
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.output, item.reference ?? item.expected, item.name);
      }
      console.log(
        `[PASS] ${item.name}${item.reference !== undefined || item.referenceFailure ? " (documented dialect difference)" : " (matching Eclipse output)"}`,
      );
      rmSync(classes, { recursive: true, force: true });
    }
    console.log(
      "Pinned Eclipse JET reference gate passed (standalone name validator disabled; javac validates emitted classes).",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
