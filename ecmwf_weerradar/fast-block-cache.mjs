import { BrowserBlockCache } from '@openmeteo/file-reader';

/**
 * file-reader 0.0.19 calls evictIfNeeded after every persistent block write.
 * Its implementation scans every stored response. Batch that maintenance;
 * leave fetching, deduplication, persistence and cancellation to the reader.
 */
export class FastBrowserBlockCache extends BrowserBlockCache {
  #interval;
  #writeBudget;
  #pendingBytes = 0;
  #timer = null;
  #scan = null;
  #clearing = false;

  constructor({ evictionIntervalMs = 30000, evictionWriteBudgetBytes, ...options } = {}) {
    super(options);
    this.#interval = Math.max(1, evictionIntervalMs);
    const capacity = options.maxBytes ?? 1024 * 1024 * 1024;
    this.#writeBudget = Math.max(this.blockSize(), evictionWriteBudgetBytes ?? Math.min(8 * 1024 * 1024, capacity / 10));
  }

  evictIfNeeded() {
    if (this.#clearing) return Promise.resolve();
    // Each caller follows a successful cache.put. A block can be shorter than
    // blockSize, so this is a conservative bound on newly persisted bytes.
    this.#pendingBytes += this.blockSize();
    if (this.#scan) return this.#scan;
    if (this.#pendingBytes >= this.#writeBudget) return this.#maintain();
    this.#schedule();
    return Promise.resolve();
  }

  #schedule() {
    if (this.#timer !== null || this.#clearing || !this.#pendingBytes) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#maintain().catch(error => console.warn('ECMWF-cacheonderhoud mislukt:', error));
    }, this.#interval);
    this.#timer.unref?.();
  }

  #maintain() {
    if (this.#scan) return this.#scan;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pendingBytes = 0;
    this.#scan = super.evictIfNeeded().finally(() => {
      this.#scan = null;
      if (this.#clearing || !this.#pendingBytes) return;
      // Writes during a scan are accounted for separately. Never lose the
      // last maintenance pass, even when loading stops immediately afterward.
      if (this.#pendingBytes >= this.#writeBudget) {
        this.#timer = setTimeout(() => {
          this.#timer = null;
          void this.#maintain().catch(error => console.warn('ECMWF-cacheonderhoud mislukt:', error));
        }, 0);
        this.#timer.unref?.();
      } else this.#schedule();
    });
    return this.#scan;
  }

  async clear() {
    this.#clearing = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pendingBytes = 0;
    try {
      await this.#scan?.catch(() => {});
      await super.clear();
    } finally { this.#clearing = false; }
  }
}
