type Entry<T> = {
  value: T;
  expiresAt: number;
};

export function createTtlCache<K, V>(options: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}) {
  const entries = new Map<K, Entry<V>>();
  const pending = new Map<K, Promise<V>>();
  const now = options.now ?? Date.now;
  const maxEntries = Math.max(1, options.maxEntries ?? 256);

  const read = (key: K): { found: boolean; value?: V } => {
    const entry = entries.get(key);
    if (!entry) return { found: false };
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return { found: false };
    }
    return { found: true, value: entry.value };
  };

  const write = (key: K, value: V) => {
    if (!entries.has(key) && entries.size >= maxEntries) {
      const oldest = entries.keys().next().value as K | undefined;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key, { value, expiresAt: now() + options.ttlMs });
  };

  return {
    get(key: K): V | undefined {
      const result = read(key);
      return result.found ? result.value : undefined;
    },
    has(key: K): boolean {
      return read(key).found;
    },
    set(key: K, value: V): void {
      write(key, value);
    },
    async getOrLoad(
      key: K,
      load: () => Promise<V>,
      force = false,
    ): Promise<V> {
      if (!force) {
        const cached = read(key);
        if (cached.found) return cached.value as V;
      }

      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const next = Promise.resolve()
        .then(load)
        .then((value) => {
          write(key, value);
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, next);
      return next;
    },
    delete(key: K): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
  };
}
