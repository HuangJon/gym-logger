/**
 * Reads any saved or exported log format and returns it in the current schema.
 * Bump SCHEMA_VERSION and add a step here whenever the saved shape changes.
 *
 * History of the saved shape (each has a fixture in tests/fixtures/ that must keep loading):
 *   v1  { entries: [...] } / { app, format: 1, entries: [...] }  — first versions and their exports
 *   v2  { schemaVersion: 2, sessions: [...] }                     — modular rewrite
 *   v3  same, entries may add `sets: number[]` and `target`        — per-set logging + targets
 *       (sessions may also carry `deload: true` — an optional extra, older versions just ignore it)
 *   v4  adds `climbs: [{ id, date, intensity: 'easy'|'hard', ts, note? }]` next to sessions — climbing days
 *   v5  same shape. Cable lifts (lateral raises, crunches, Pallof, pulldown) logged as "kg" before v5
 *       were really the machine's lbs labels (the stack tops out at 70 lb), so they're relabeled lbs
 *       — numbers unchanged.
 * Unknown fields are kept, so nothing written by a newer version is dropped.
 */
import { isISODate } from './dates.js';
import { normalizeEntry } from './records.js';
import { allExercises } from './exercises.js';

export const SCHEMA_VERSION = 5;

const CABLE_IDS = () => new Set(allExercises().filter(ex => ex.stack === 'cable').map(ex => ex.id));

/** v4 → v5: cable entries saved in kg were lbs labels — relabel them (numbers stay). */
function relabelCableKg(session, cable) {
  let changed = false;
  const entries = Object.fromEntries(Object.entries(session.entries).map(([id, e]) => {
    if (!cable.has(id) || e.unit !== 'kg') return [id, e];
    changed = true;
    return [id, { ...e, unit: 'lbs' }];
  }));
  return changed ? { ...session, entries } : session;
}

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

export const CLIMB_INTENSITIES = ['easy', 'hard'];

/** A climbing day in canonical form, or null if unusable. Unknown fields are kept. */
export function normalizeClimb(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || !isISODate(raw.date)) return null;
  const intensity = CLIMB_INTENSITIES.includes(raw.intensity) ? raw.intensity : 'easy';
  const out = { ...raw, id: String(raw.id ?? `climb-${raw.date}-${index}`), date: raw.date, intensity, ts: Number(raw.ts) || 0 };
  if (typeof raw.note !== 'string' || !raw.note) delete out.note;
  return out;
}

/** @returns {{ schemaVersion: number, sessions: object[], climbs: object[], skipped: number }} */
export function migrateLog(raw) {
  if (raw == null) return { schemaVersion: SCHEMA_VERSION, sessions: [], climbs: [], skipped: 0 };
  const list = Array.isArray(raw) ? raw : (raw.sessions || raw.entries || (Array.isArray(raw.climbs) ? [] : null));
  if (!Array.isArray(list)) throw new Error('Not a lifting-log file');
  const version = Array.isArray(raw) ? 0 : Number(raw.schemaVersion) || 0;
  const cable = CABLE_IDS();
  const sessions = list.map(normalizeSession).map(x => (x && version < 5 ? relabelCableKg(x, cable) : x));
  const climbs = (!Array.isArray(raw) && Array.isArray(raw.climbs) ? raw.climbs : []).map(normalizeClimb).filter(Boolean);
  return { schemaVersion: SCHEMA_VERSION, sessions: sessions.filter(Boolean), climbs, skipped: sessions.filter(s => !s).length };
}
