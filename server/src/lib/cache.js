/**
 * Tiny TTL cache that also de-duplicates concurrent loads, so when thousands of
 * students start a quiz at the same moment only one query hits the database.
 */
export function createCache(ttlMs) {
  const entries = new Map();
  return {
    get(key, loader) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && hit.expires > now) return hit.promise;
      const promise = loader().catch((err) => {
        entries.delete(key);
        throw err;
      });
      entries.set(key, { promise, expires: now + ttlMs });
      return promise;
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
