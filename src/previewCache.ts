/** Small bounded cache for preview/source mappings rebuilt on editor selection events. */
export class VersionedPreviewCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly maxEntries = 32) {}

  getOrCreate(source: string, version: number, variant: string, create: () => T): T {
    const key = `${source}\0${version}\0${variant}`;
    const cached = this.values.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = create();
    if (this.values.size >= Math.max(1, this.maxEntries)) {
      this.values.clear();
    }
    this.values.set(key, value);
    return value;
  }

  invalidate(): void {
    this.values.clear();
  }
}
