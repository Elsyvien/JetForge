export class ResourceLimitError extends Error {
  constructor(
    readonly resource: string,
    readonly limit: number
  ) {
    super(`JetForge stopped because ${resource} exceeded its limit of ${limit}.`);
    this.name = "ResourceLimitError";
  }
}

/** Reserves cumulative work before allocation so callers fail closed at one shared boundary. */
export class ResourceBudget<Resource extends string> {
  private readonly used = new Map<Resource, number>();

  constructor(private readonly limits: Record<Resource, number>) {}

  consume(resource: Resource, amount = 1): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new RangeError(`Invalid ${resource} budget amount.`);
    }
    const next = (this.used.get(resource) ?? 0) + amount;
    const limit = this.limits[resource];
    if (next > limit) {
      throw new ResourceLimitError(resource, limit);
    }
    this.used.set(resource, next);
  }

  usage(resource: Resource): number {
    return this.used.get(resource) ?? 0;
  }
}
