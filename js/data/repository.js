/**
 * The saved workout log. The one place that reads and writes it.
 *
 * Safety rules:
 *  - Every change goes through `commit(next)`: it saves first, and only updates the in-memory copy
 *    (and notifies the screens) if the save worked.
 *  - Before each save, the previous log is kept as a local snapshot (newest 3, within a size
 *    budget) so a bad edit or a bug can be undone from History → Restore an earlier copy.
 *  - Before upgrading an older saved format, the original is copied to `pre-upgrade-v{n}`.
 *  - If the saved log comes from a newer version of the app, this version refuses to write
 *    (read-only) so it can't drop fields it doesn't understand.
 */
import { migrateLog, SCHEMA_VERSION } from '../core/migrate.js';

const LOG_KEY = 'log';
const SNAPSHOTS_KEY = 'snapshots';
export const MAX_SNAPSHOTS = 3;
export const SNAPSHOT_BUDGET_BYTES = 600_000;   // ~0.5 KB per session, so years of logs; browser storage is ~5 MB

export class ReadOnlyError extends Error {
  constructor() { super('This log was saved by a newer version of the app — close it completely and reopen to update.'); }
}

/** Keep the newest snapshots that fit in `budget` bytes. */
export function trimSnapshots(snapshots, max = MAX_SNAPSHOTS, budget = SNAPSHOT_BUDGET_BYTES) {
  const kept = [];
  let bytes = 0;
  for (const snap of snapshots.slice(0, max)) {
    bytes += JSON.stringify(snap).length;
    if (bytes > budget && kept.length) break;
    kept.push(snap);
  }
  return kept;
}

export function createRepository(storage, { now = () => new Date().toISOString() } = {}) {
  let sessions = [];
  let readOnly = false;
  const listeners = new Set();

  function writeLog(next) { storage.write(LOG_KEY, { schemaVersion: SCHEMA_VERSION, sessions: next }); }

  function keepSnapshot(previous) {
    if (!previous.length) return;
    const snaps = trimSnapshots([{ savedAt: now(), sessions: previous }, ...(storage.read(SNAPSHOTS_KEY) || [])]);
    try { storage.write(SNAPSHOTS_KEY, snaps); }
    catch { try { storage.write(SNAPSHOTS_KEY, snaps.slice(0, 1)); } catch { /* never block the real save */ } }
  }

  return {
    /** Load (and upgrade, if needed) whatever is saved. */
    load() {
      const raw = storage.read(LOG_KEY);
      readOnly = !!raw && Number(raw.schemaVersion) > SCHEMA_VERSION;
      try {
        sessions = migrateLog(raw).sessions;
      } catch {
        if (raw) storage.write(`unreadable-${Date.now()}`, raw);   // keep it rather than overwrite it later
        sessions = [];
      }
      if (raw && !readOnly && raw.schemaVersion !== SCHEMA_VERSION) {
        const key = `pre-upgrade-v${raw.schemaVersion ?? 1}`;
        if (storage.read(key) == null) storage.write(key, raw);
        writeLog(sessions);
      }
      return sessions;
    },

    get sessions() { return sessions; },
    get readOnly() { return readOnly; },

    /** Save `next` as the whole log. Throws (and changes nothing) if the save fails. */
    async commit(next) {
      if (readOnly) throw new ReadOnlyError();
      keepSnapshot(sessions);
      writeLog(next);
      sessions = next;
      listeners.forEach(fn => fn(sessions));
    },

    /** Local snapshots, newest first: [{ savedAt, count }] */
    snapshots() {
      return (storage.read(SNAPSHOTS_KEY) || []).map(s => ({ savedAt: s.savedAt, count: s.sessions?.length ?? 0 }));
    },

    /** Restore snapshot `index` (the current log is snapshotted first, so this can be undone too). */
    async restoreSnapshot(index) {
      const snap = (storage.read(SNAPSHOTS_KEY) || [])[index];
      if (!snap) throw new Error('That copy is no longer available.');
      await this.commit(migrateLog({ sessions: snap.sessions }).sessions);
    },

    /** Run `fn(sessions)` after every successful change. Returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
