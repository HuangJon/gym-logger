/**
 * Session records — the shape of everything saved in the log.
 *
 *   { id, session: 1|2|3, date: "YYYY-MM-DD", ts, program?: 'old', note?,
 *     entries: { [exerciseId]: Entry } }
 *
 *   Entry = { status, note,
 *             weight?, unit?,                 // what you lifted
 *             sets?: number[],                // reps for each set (0 = set not done)
 *             reps?,                          // lowest set — kept for charts and older logs
 *             target?: { weight?, reps, sets } }  // what you were aiming for
 *
 * status is one of STATUS. Unknown fields are kept as-is, so data written by a future version
 * isn't thrown away if it's ever read by this one.
 */
import { hasValue } from './numbers.js';
import { sessionExercises, unitOf, exercisesForSession } from './exercises.js';

export const STATUS = Object.freeze({ COMPLETE: 'complete', PARTIAL: 'partial', SKIP: 'skip', UNRECORDED: 'unrecorded' });
export const DID_IT = new Set([STATUS.COMPLETE, STATUS.PARTIAL]);

const KNOWN = new Set(['status', 'note', 'weight', 'unit', 'reps', 'sets', 'target', 'skipped', 'unrecorded']);
const num = v => (hasValue(v) && Number.isFinite(Number(v)) ? Number(v) : null);

/** Lowest set that was actually done (0 = not done), or null. */
export const lowestSet = sets => { const done = (sets || []).filter(r => r > 0); return done.length ? Math.min(...done) : null; };

/** One entry in canonical form. Also upgrades shapes saved by early versions ({skipped:true}, {unrecorded:true}). */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return { status: STATUS.UNRECORDED, note: '' };
  let status = raw.status;
  if (raw.skipped) status = STATUS.SKIP;
  else if (raw.unrecorded) status = STATUS.UNRECORDED;
  else if (!Object.values(STATUS).includes(status)) status = STATUS.COMPLETE;

  const extras = Object.fromEntries(Object.entries(raw).filter(([k]) => !KNOWN.has(k)));
  const entry = { ...extras, status, note: typeof raw.note === 'string' ? raw.note : '' };
  if (status !== STATUS.SKIP) {
    const weight = num(raw.weight);
    if (weight !== null) { entry.weight = weight; entry.unit = raw.unit === 'kg' ? 'kg' : 'lbs'; }
    if (Array.isArray(raw.sets) && raw.sets.length) {
      entry.sets = raw.sets.map(r => Math.max(0, Math.round(num(r) ?? 0)));
      const low = lowestSet(entry.sets);
      if (low !== null) entry.reps = low;
    } else {
      const reps = num(raw.reps);
      if (reps !== null) entry.reps = reps;
    }
  }
  if (raw.target && typeof raw.target === 'object') {
    const t = { reps: num(raw.target.reps), sets: num(raw.target.sets) };
    if (num(raw.target.weight) !== null) t.weight = num(raw.target.weight);
    if (t.reps !== null && t.sets !== null) entry.target = t;
  }
  return entry;
}

/** Reps for each set of a logged entry; older logs with a single reps value count it for every set. */
export function setsOfEntry(entry, setCount) {
  if (entry?.sets?.length) return entry.sets;
  return hasValue(entry?.reps) ? Array(setCount).fill(entry.reps) : [];
}

/** Did this attempt meet the target? (weight at least the target, every target set at least the target reps) */
export function meetsTarget({ weight, sets }, target) {
  if (!target) return true;
  if (hasValue(target.weight) && !(hasValue(weight) && weight >= target.weight)) return false;
  if ((sets || []).length < target.sets) return false;
  return sets.slice(0, target.sets).every(r => r >= target.reps);
}

/**
 * Turn an in-progress workout into a record to save.
 *   scratch:  { [exerciseId]: { status?: 'complete'|'skip', note?, weight?, sets? } } — what you entered
 *   targetOf: ex => { weight, reps, sets } — today's target for each exercise
 * Done → saved as complete if it met the target, otherwise partial. Unmarked → "unrecorded"
 * (keeping anything you typed). Skip drops weight and sets.
 */
export function buildSessionRecord({ sessionNum, date, scratch, targetOf, now = Date.now() }) {
  const entries = {};
  for (const ex of sessionExercises(sessionNum)) {
    const sc = scratch[ex.id] || {}, target = targetOf(ex);
    const marked = sc.status === STATUS.COMPLETE || sc.status === STATUS.SKIP;
    const entry = { status: marked ? sc.status : STATUS.UNRECORDED, note: (sc.note || '').trim() };
    if (entry.status !== STATUS.SKIP) {
      const weight = ex.bw ? undefined
        : sc.weight !== undefined ? sc.weight
        : entry.status === STATUS.COMPLETE ? target?.weight : undefined;
      if (hasValue(weight)) { entry.weight = weight; entry.unit = unitOf(ex); }
      const sets = sc.sets || (entry.status === STATUS.COMPLETE && target ? Array(target.sets).fill(target.reps) : null);
      if (sets) { entry.sets = [...sets]; const low = lowestSet(sets); if (low !== null) entry.reps = low; }
      if (entry.status === STATUS.COMPLETE && !meetsTarget({ weight: entry.weight, sets: entry.sets }, target)) entry.status = STATUS.PARTIAL;
    }
    if (target && entry.status !== STATUS.UNRECORDED) {
      entry.target = { reps: target.reps, sets: target.sets, ...(hasValue(target.weight) ? { weight: target.weight } : {}) };
    }
    entries[ex.id] = entry;
  }
  return { id: String(now), session: Number(sessionNum), date, ts: now, entries };
}

/** { complete, partial, skip, unrecorded } counts for a record, over the exercises it shows. */
export function statusCounts(record) {
  const counts = { complete: 0, partial: 0, skip: 0, unrecorded: 0 };
  for (const ex of exercisesForSession(record)) counts[normalizeEntry(record.entries?.[ex.id]).status]++;
  return counts;
}

/** Newest first: by date, then by save time. */
export const byNewest = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0);
export const byOldest = (a, b) => -byNewest(a, b);
