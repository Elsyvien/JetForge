package dev.jetforge.runtime;

import java.nio.file.Path;

/** fixture is the parsed snapshot; fixturePath identifies its original project location. */
public record ModelContext(Path projectRoot, Path fixturePath, Object fixture) {}
