/**
 * One serial writer queue per chain, so concurrent hires never collide on nonces (PRD LED-4).
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Collects items and flushes them in batches (max `maxSize`, or after `delayMs`).
 * Each `add` resolves with that item's own result.
 */
export class Batcher<I, R> {
  private pending: { item: I; resolve: (r: R) => void; reject: (e: unknown) => void }[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly flushFn: (items: I[]) => Promise<R[]>,
    private readonly maxSize = 25,
    private readonly delayMs = 1500,
  ) {}

  add(item: I): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.pending.push({ item, resolve, reject });
      if (this.pending.length >= this.maxSize) {
        void this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => void this.flush(), this.delayMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending.splice(0, this.maxSize);
    if (batch.length === 0) return;
    try {
      const results = await this.flushFn(batch.map((b) => b.item));
      batch.forEach((b, i) => b.resolve(results[i]));
    } catch (err) {
      batch.forEach((b) => b.reject(err));
    }
    if (this.pending.length > 0) void this.flush();
  }
}
