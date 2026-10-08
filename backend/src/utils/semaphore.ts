/** Minimal counting semaphore that bounds concurrent async work. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get inUse() {
    return this.active;
  }

  get queued() {
    return this.waiters.length;
  }

  /** Try to acquire without waiting; returns false when saturated. */
  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }

  async acquire(): Promise<void> {
    if (this.tryAcquire()) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
