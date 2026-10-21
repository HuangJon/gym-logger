/**
 * On-device storage (localStorage) with JSON values. Writes throw if storage is full or blocked,
 * so callers can show "save failed" instead of silently losing data.
 */
export function createLocalStorage(prefix = 'liftlog:', backend = globalThis.localStorage) {
  return {
    read(key) {
      try {
        const raw = backend.getItem(prefix + key);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    write(key, value) {
      backend.setItem(prefix + key, JSON.stringify(value));
    },
  };
}

/** In-memory storage with the same API — used by tests. */
export function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    read: key => (data.has(key) ? JSON.parse(data.get(key)) : null),
    write: (key, value) => { data.set(key, JSON.stringify(value)); },
    dump: () => Object.fromEntries([...data].map(([k, v]) => [k, JSON.parse(v)])),
  };
}

/** Ask the browser not to clear our storage under pressure (best effort). */
export function requestPersistentStorage() {
  try { navigator.storage?.persist?.(); } catch { /* not supported */ }
}
