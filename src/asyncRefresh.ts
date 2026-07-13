export type AsyncRefreshWork = (invalidate: boolean) => Promise<boolean>;

/**
 * Coalesces bursts of refresh requests while preserving requests that arrive
 * during an active refresh. This keeps filesystem watcher/save event pairs from
 * rebuilding the same model twice and gives callers one completion promise.
 */
export class CoalescingAsyncRefresh {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private queued = false;
  private invalidateQueued = false;
  private disposed = false;
  private waiters: Array<(value: boolean) => void> = [];

  constructor(
    private readonly work: AsyncRefreshWork,
    private readonly debounceMs = 75
  ) {}

  request(invalidate = false, immediate = false): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    this.queued = true;
    this.invalidateQueued ||= invalidate;
    const result = new Promise<boolean>((resolve) => this.waiters.push(resolve));
    if (!this.running) {
      this.schedule(immediate ? 0 : this.debounceMs);
    }
    return result;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.resolveWaiters(false);
  }

  private schedule(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.running || !this.queued) {
      return;
    }
    this.running = true;
    this.queued = false;
    const invalidate = this.invalidateQueued;
    this.invalidateQueued = false;
    const currentWaiters = this.waiters;
    this.waiters = [];
    let succeeded = false;
    try {
      succeeded = await this.work(invalidate);
    } catch {
      succeeded = false;
    } finally {
      for (const resolve of currentWaiters) {
        resolve(succeeded);
      }
      this.running = false;
      if (this.queued && !this.disposed) {
        this.schedule(0);
      }
    }
  }

  private resolveWaiters(value: boolean): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve(value);
    }
  }
}
