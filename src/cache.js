// Small bounded TTL cache with in-flight request de-duplication.
//
// Why: every comparison costs several FACEIT API calls. Caching keeps repeated
// lookups (the same popular players) from burning the API key's quota, and the
// size bound keeps an attacker from filling memory with random nicknames.

export class TtlCache {
  /**
   * @param {{ maxEntries: number, ttlMs: number, now?: () => number }} options
   */
  constructor({ maxEntries, ttlMs, now = Date.now }) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<unknown>>} */
    this.inFlight = new Map();
  }

  /** @param {string} key */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency: Map keeps insertion order, so re-insert at the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** @param {string} key @param {unknown} value */
  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Return the cached value, or run `load` once even if many callers ask for
   * the same key at the same time. Failures are not cached.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} load
   * @returns {Promise<T>}
   */
  async getOrLoad(key, load) {
    const cached = this.get(key);
    if (cached !== undefined) return /** @type {T} */ (cached);

    const pending = this.inFlight.get(key);
    if (pending) return /** @type {Promise<T>} */ (pending);

    const promise = (async () => {
      try {
        const value = await load();
        this.set(key, value);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  get size() {
    return this.entries.size;
  }
}
