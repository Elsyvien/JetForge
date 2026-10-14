package dev.jetforge.runtime;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.Strictness;
import com.google.gson.ToNumberPolicy;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.StringReader;
import java.lang.reflect.InvocationTargetException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** One process, one immutable request. Result JSON never travels over template stdout. */
public final class Runner {
  private static final Gson JSON = new GsonBuilder().setStrictness(Strictness.STRICT)
      .setObjectToNumberStrategy(ToNumberPolicy.BIG_DECIMAL).disableHtmlEscaping().create();
  private static final int LOG_LIMIT = 256 * 1024;
  private static final int OUTPUT_LIMIT = 8 * 1024 * 1024;

  private record Request(int version, String mode, String source, List<String> sources,
      String classes, String qualifiedName, List<String> classpath, int release,
      String fixture, String fixturePath, String modelProvider, String projectRoot) {}
  private record Problem(String code, String message, String severity, String fileName,
      long javaLine, long column, long javaOffset) {}
  private static final class Result {
    int version = 1;
    boolean ok;
    List<Problem> diagnostics = new ArrayList<>();
    String output;
    String stdout = "";
    String stderr = "";
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("Expected request and result paths.");
    Result result = new Result();
    try {
      Request request = JSON.fromJson(Files.readString(Path.of(args[0]), StandardCharsets.UTF_8), Request.class);
      if (request.version != 1) throw new IllegalArgumentException("Unsupported runner protocol.");
      compileAndRun(request, result);
    } catch (Throwable error) {
      result.ok = false;
      result.diagnostics.add(problem("RUNNER_ERROR", error.toString()));
    } finally {
      ProcessHandle.current().descendants().forEach(process -> { if (process.isAlive()) process.destroyForcibly(); });
    }
    Files.writeString(Path.of(args[1]), JSON.toJson(result), StandardCharsets.UTF_8);
  }

  private static void compileAndRun(Request request, Result result) throws Exception {
    var compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null || Runtime.version().feature() < 21) {
      result.diagnostics.add(problem("JDK_UNAVAILABLE", "Select a JDK 21 or newer with the Java compiler."));
      return;
    }
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    try (var manager = compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
      List<String> options = new ArrayList<>(List.of("--release", Integer.toString(request.release),
          "-encoding", "UTF-8", "-proc:none", "-d", request.classes));
      if (!request.classpath.isEmpty()) options.addAll(List.of("-classpath", String.join(java.io.File.pathSeparator, request.classpath)));
      List<String> sources = new ArrayList<>(request.sources);
      sources.add(request.source);
      boolean success = Boolean.TRUE.equals(compiler.getTask(null, manager, diagnostics,
          options, null, manager.getJavaFileObjectsFromStrings(sources)).call());
      for (var diagnostic : diagnostics.getDiagnostics().stream().limit(200).toList()) {
        result.diagnostics.add(new Problem("JAVA_COMPILE", diagnostic.getMessage(Locale.ROOT),
            diagnostic.getKind() == javax.tools.Diagnostic.Kind.ERROR ? "error" : "warning",
            diagnostic.getSource() == null ? null : Path.of(diagnostic.getSource().toUri()).toString(),
            diagnostic.getLineNumber(), diagnostic.getColumnNumber(), diagnostic.getPosition()));
      }
      if (!success) return;
    }
    if ("compile".equals(request.mode)) { result.ok = true; return; }
    Object fixture;
    try {
      fixture = request.fixture == null ? null : parseFixture(Files.readString(Path.of(request.fixture), StandardCharsets.UTF_8));
    } catch (Exception error) {
      result.diagnostics.add(problem("MODEL_LOAD", "Invalid JSON fixture: " + error.getMessage())); return;
    }
    List<URL> urls = new ArrayList<>();
    urls.add(Path.of(request.classes).toUri().toURL());
    for (String entry : request.classpath) urls.add(Path.of(entry).toUri().toURL());
    try (var loader = new URLClassLoader(urls.toArray(URL[]::new), Runner.class.getClassLoader())) {
      var stdout = new LimitedLog();
      var stderr = new LimitedLog();
      var oldOut = System.out;
      var oldErr = System.err;
      try (var out = new PrintStream(stdout, true, StandardCharsets.UTF_8);
           var err = new PrintStream(stderr, true, StandardCharsets.UTF_8)) {
        System.setOut(out); System.setErr(err);
        Object model = fixture;
        try {
          if (request.modelProvider != null) {
            ModelProvider provider = (ModelProvider) loader.loadClass(request.modelProvider).getDeclaredConstructor().newInstance();
            model = provider.load(new ModelContext(Path.of(request.projectRoot),
                request.fixturePath == null ? null : Path.of(request.fixturePath), fixture));
          }
        } catch (Throwable error) {
          result.diagnostics.add(problem("MODEL_LOAD", unwrap(error).toString())); return;
        }
        try {
          var type = loader.loadClass(request.qualifiedName);
          Object value = type.getMethod("generate", Object.class).invoke(type.getDeclaredConstructor().newInstance(), model);
          if (!(value instanceof String text)) throw new IllegalStateException("generate(Object) must return a String.");
          if (text.getBytes(StandardCharsets.UTF_8).length > OUTPUT_LIMIT) {
            result.diagnostics.add(problem("RESOURCE_LIMIT", "Generated output exceeds 8 MiB.")); return;
          }
          result.output = text;
          result.ok = true;
        } catch (Throwable error) {
          Throwable cause = unwrap(error);
          var origin = java.util.Arrays.stream(cause.getStackTrace())
              .filter(frame -> frame.getClassName().equals(request.qualifiedName)).findFirst();
          result.diagnostics.add(new Problem("TEMPLATE_RUNTIME", cause.toString(), "error",
              origin.isPresent() ? request.source : null, origin.map(StackTraceElement::getLineNumber).orElse(-1), 1, -1));
        }
      } finally {
        System.setOut(oldOut); System.setErr(oldErr);
        result.stdout = stdout.text(); result.stderr = stderr.text();
      }
    }
  }

  private static Object parseFixture(String source) throws Exception {
    try (var reader = new JsonReader(new StringReader(source))) {
      reader.setStrictness(Strictness.STRICT);
      int depth = 0;
      int nodes = 0;
      var names = new java.util.ArrayDeque<java.util.Set<String>>();
      while (reader.peek() != JsonToken.END_DOCUMENT) {
        if (++nodes > 100000) throw new IllegalArgumentException("Fixture exceeds 100000 JSON tokens.");
        switch (reader.peek()) {
          case BEGIN_OBJECT -> { reader.beginObject(); names.push(new java.util.HashSet<>()); if (++depth > 128) throw new IllegalArgumentException("Fixture exceeds depth 128."); }
          case BEGIN_ARRAY -> { reader.beginArray(); names.push(new java.util.HashSet<>()); if (++depth > 128) throw new IllegalArgumentException("Fixture exceeds depth 128."); }
          case END_OBJECT -> { reader.endObject(); names.pop(); depth--; }
          case END_ARRAY -> { reader.endArray(); names.pop(); depth--; }
          case NAME -> { String name = reader.nextName(); if (!names.peek().add(name)) throw new IllegalArgumentException("Duplicate JSON key: " + name); }
          case NULL -> reader.nextNull();
          case BOOLEAN -> reader.nextBoolean();
          default -> reader.nextString();
        }
      }
    }
    return JSON.fromJson(source, Object.class);
  }

  private static Throwable unwrap(Throwable error) {
    return error instanceof InvocationTargetException invocation && invocation.getCause() != null ? invocation.getCause() : error;
  }
  private static Problem problem(String code, String message) { return new Problem(code, message, "error", null, -1, -1, -1); }
  private static final class LimitedLog extends OutputStream {
    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    private boolean truncated;
    @Override public void write(int value) { if (bytes.size() < LOG_LIMIT) bytes.write(value); else truncated = true; }
    @Override public void write(byte[] data, int offset, int length) {
      int amount = Math.min(length, LOG_LIMIT - bytes.size());
      bytes.write(data, offset, amount); if (amount < length) truncated = true;
    }
    String text() { return bytes.toString(StandardCharsets.UTF_8) + (truncated ? "\n[JetForge: log truncated at 256 KiB]" : ""); }
  }
}
