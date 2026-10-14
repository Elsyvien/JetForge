package dev.jetforge.runtime;

/** Project-owned adapter for constructing typed Java or EMF models. */
public interface ModelProvider {
  Object load(ModelContext context) throws Exception;
}
