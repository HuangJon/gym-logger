/**
 * Reads any saved or exported log format and returns it in the current schema.
 * Bump SCHEMA_VERSION and add a step here whenever the saved shape changes.
 *
 * History of the saved shape (each has a fixture in tests/fixtures/ that must keep loading):
 *   v1  { entries: [...] } / { app, format: 1, entries: [...] }  — first versions and their exports
 *   v2  { schemaVersion: 2, sessions: [...] }                     — modular rewrite
 *   v3  same, entries may add `sets: number[]` and `target`        — per-set logging + targets
 * Unknown fields are kept, so nothing written by a newer version is dropped.
 */
import { isISODate } from './dates.js';
import { normalizeEntry } from './records.js';

export const SCHEMA_VERSION = 3;

const SESSION_FIELDS = new Set(['id', 'session', 'date', 'ts', 'program', 'note', 'entries']);

function normalizeSession(raw, index) {
  if (!raw || typeof raw !== 'object' || !isISODate(raw.date)) return null;
  const session = Number(raw.session);
  if (![1, 2, 3].includes(session) || !raw.entries || typeof raw.entries !== 'object') return null;
  const entries = Object.fromEntries(Object.entries(raw.entries).map(([id, e]) => [id, normalizeEntry(e)]));
  const extras = Object.fromEntries(Object.entries(raw).filter(([k]) => !SESSION_FIELDS.has(k)));
  const out = { ...extras, id: String(raw.id ?? `imported-${raw.date}-${session}-${index}`), session, date: raw.date, ts: Number(raw.ts) || 0, entries };
  if (raw.program === 'old') out.program = 'old';
  if (typeof raw.note === 'string' && raw.note) out.note = raw.note;
  return out;
}

/** @returns {{ schemaVersion: number, sessions: object[], skipped: number }} */
export function migrateLog(raw) {
  if (raw == null) return { schemaVersion: SCHEMA_VERSION, sessions: [], skipped: 0 };
  const list = Array.isArray(raw) ? raw : (raw.sessions || raw.entries);
  if (!Array.isArray(list)) throw new Error('Not a lifting-log file');
  const sessions = list.map(normalizeSession);
  return { schemaVersion: SCHEMA_VERSION, sessions: sessions.filter(Boolean), skipped: sessions.filter(s => !s).length };
}
