/**
 * Session records — the shape of everything saved in the log.
 *
 *   { id, session: 1|2|3, date: "YYYY-MM-DD", ts, program?: 'old', note?,
 *     entries: { [exerciseId]: { status, note, weight?, unit?, reps? } } }
 *
 * status is one of STATUS. Weight/reps are only present when logged.
 */
import { hasValue } from './numbers.js';
import { sessionExercises, unitOf, exercisesForSession } from './exercises.js';

export const STATUS = Object.freeze({ COMPLETE: 'complete', PARTIAL: 'partial', SKIP: 'skip', UNRECORDED: 'unrecorded' });
export const DID_IT = new Set([STATUS.COMPLETE, STATUS.PARTIAL]);

/** One entry in canonical form. Also upgrades shapes saved by early versions ({skipped:true}, {unrecorded:true}). */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return { status: STATUS.UNRECORDED, note: '' };
  let status = raw.status;
  if (raw.skipped) status = STATUS.SKIP;
  else if (raw.unrecorded) status = STATUS.UNRECORDED;
  else if (!Object.values(STATUS).includes(status)) status = STATUS.COMPLETE;

  const entry = { status, note: typeof raw.note === 'string' ? raw.note : '' };
  if (status !== STATUS.SKIP) {
    const weight = Number(raw.weight), reps = Number(raw.reps);
    if (hasValue(raw.weight) && Number.isFinite(weight)) { entry.weight = weight; entry.unit = raw.unit === 'kg' ? 'kg' : 'lbs'; }
    if (hasValue(raw.reps) && Number.isFinite(reps)) entry.reps = reps;
  }
  return entry;
}

/**
 * Turn an in-progress workout into a record to save.
 * scratch: { [exerciseId]: { status?, note?, weight?, reps? } } — what you entered this session
 * plannedWeight(ex): the weight shown on the card when you didn't change it
 * Unmarked exercises are saved as "unrecorded" (keeping anything you typed); skipped ones drop weight/reps.
 */
export function buildSessionRecord({ sessionNum, date, scratch, plannedWeight, now = Date.now() }) {
  const entries = {};
  for (const ex of sessionExercises(sessionNum)) {
    const sc = scratch[ex.id] || {};
    const status = sc.status || STATUS.UNRECORDED;
    const entry = { status, note: (sc.note || '').trim() };
    if (status !== STATUS.SKIP) {
      if (!ex.bw) {
        const weight = sc.weight !== undefined ? sc.weight : (status === STATUS.UNRECORDED ? undefined : plannedWeight(ex));
        if (hasValue(weight)) { entry.weight = weight; entry.unit = unitOf(ex); }
      }
      if (hasValue(sc.reps)) entry.reps = sc.reps;
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
