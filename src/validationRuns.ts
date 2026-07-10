export interface ValidationRunToken {
  generation: number;
  documentVersion: number;
  signal: AbortSignal;
}

/** Keeps only the newest external validation run authoritative for each source. */
export class ValidationRunCoordinator {
  private readonly generations = new Map<string, number>();
  private readonly controllers = new Map<string, AbortController>();

  begin(source: string, documentVersion: number): ValidationRunToken {
    this.controllers.get(source)?.abort();
    const generation = (this.generations.get(source) ?? 0) + 1;
    const controller = new AbortController();
    this.generations.set(source, generation);
    this.controllers.set(source, controller);
    return { generation, documentVersion, signal: controller.signal };
  }

  invalidate(source: string): void {
    this.controllers.get(source)?.abort();
    this.controllers.delete(source);
    this.generations.set(source, (this.generations.get(source) ?? 0) + 1);
  }

  isCurrent(source: string, token: ValidationRunToken, documentVersion: number, documentClosed = false): boolean {
    return !documentClosed
      && !token.signal.aborted
      && token.documentVersion === documentVersion
      && this.generations.get(source) === token.generation;
  }

  finish(source: string, token: ValidationRunToken): void {
    if (this.generations.get(source) === token.generation) {
      this.controllers.delete(source);
    }
  }

  dispose(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
