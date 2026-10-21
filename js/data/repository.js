/**
 * The saved workout log. The one place that reads and writes it.
 * Every change goes through `commit(next)`: it saves first, and only updates the in-memory copy
 * (and notifies the screens) if the save worked.
 */
import { migrateLog, SCHEMA_VERSION } from '../core/migrate.js';

const LOG_KEY = 'log';

export function createRepository(storage) {
  let sessions = [];
  const listeners = new Set();

  return {
    /** Load (and upgrade, if needed) whatever is saved. */
    load() {
      const raw = storage.read(LOG_KEY);
      try { sessions = migrateLog(raw).sessions; }
      catch { sessions = []; }
      if (raw && raw.schemaVersion !== SCHEMA_VERSION) this.save(sessions);
      return sessions;
    },

    get sessions() { return sessions; },

    /** Save without notifying (used for migrations). */
    save(next) { storage.write(LOG_KEY, { schemaVersion: SCHEMA_VERSION, sessions: next }); },

    /** Save `next` as the whole log. Throws (and changes nothing) if the save fails. */
    async commit(next) {
      this.save(next);
      sessions = next;
      listeners.forEach(fn => fn(sessions));
    },

    /** Run `fn(sessions)` after every successful change. Returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
