/**
 * The workout in progress, saved on every change so closing the app (or the phone killing it)
 * mid-workout loses nothing. Cleared when the session is completed or discarded.
 *
 *   { v: 1, savedAt, active: { sessionNum, date, deload? }, scratch: { [exerciseId]: {...} }, rest? }
 *
 * It's a scratch copy, not part of the log: if it ever can't be read it's simply ignored.
 */
import { isISODate } from '../core/dates.js';
import { sessionNumbers } from '../core/exercises.js';

const KEY = 'draft';
const VERSION = 1;

export function saveDraft(storage, { active, scratch, rest = null }, now = Date.now()) {
  try {
    storage.write(KEY, { v: VERSION, savedAt: now, active, scratch: cleanScratch(scratch), ...(rest ? { rest } : {}) });
    return true;
  } catch {
    return false;   // storage full or blocked — the workout is still on screen
  }
}

/** The saved workout in progress, or null if there isn't a usable one. */
export function loadDraft(storage) {
  const raw = storage.read(KEY);
  if (!raw || raw.v !== VERSION || !raw.active || typeof raw.scratch !== 'object' || !raw.scratch) return null;
  const sessionNum = Number(raw.active.sessionNum);
  if (!sessionNumbers().includes(sessionNum) || !isISODate(raw.active.date)) return null;
  const rest = raw.rest && Number.isFinite(raw.rest.endsAt) ? { endsAt: raw.rest.endsAt, exId: String(raw.rest.exId || ''), total: Number(raw.rest.total) || 0 } : null;
  return { savedAt: Number(raw.savedAt) || 0, active: { sessionNum, date: raw.active.date, deload: !!raw.active.deload }, scratch: cleanScratch(raw.scratch), rest };
}

export const clearDraft = storage => storage.remove?.(KEY);

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cleanSet = s => {
  const reps = num(s?.reps);
  if (reps === null || reps <= 0) return null;
  const weight = num(s.weight);
  return weight === null ? { reps } : { weight, reps };
};

/** Keep only the fields the workout screen uses, in a safe shape (drops UI-only state like an open pop-out). */
function cleanScratch(scratch) {
  const out = {};
  for (const [id, st] of Object.entries(scratch || {})) {
    if (!st || typeof st !== 'object') continue;
    const s = { done: (Array.isArray(st.done) ? st.done : []).map(cleanSet).filter(Boolean) };
    if (st.skipped) s.skipped = true;
    if (typeof st.note === 'string' && st.note) s.note = st.note;
    const t = st.target;
    if (t && num(t.reps) !== null && num(t.sets) !== null) s.target = { weight: num(t.weight), reps: t.reps, sets: t.sets };
    out[id] = s;
  }
  return out;
}
