/**
 * Session records — the shape of everything saved in the log.
 *
 *   { id, session: 1|2|3, date: "YYYY-MM-DD", ts, program?: 'old', deload?: true, maintain?: true, note?,
 *     entries: { [exerciseId]: Entry } }
 *
 *   Entry = { status, note,
 *             sets?: [{ weight?, reps }],         // each logged set, in order
 *             weight?, unit?, reps?,               // summary: heaviest weight, fewest reps — for charts and older logs
 *             target?: { weight?, reps, sets },    // what you were aiming for
 *             mode?: 'normal'|'maintain'|'deload' } // only when this lift differed from the session
 *                                                  // (older logs: deload?: boolean, same meaning)
 *
 * status is one of STATUS. Unknown fields are kept as-is, so data written by a future version
 * isn't thrown away if it's ever read by this one.
 */
import { hasValue } from './numbers.js';
import { sessionExercises, unitOf, exercisesForSession } from './exercises.js';

/** How a session (or one lift) was trained: pushing for progress, holding steady, or recovering. */
export const MODE = Object.freeze({ NORMAL: 'normal', MAINTAIN: 'maintain', DELOAD: 'deload' });
const MODES = new Set(Object.values(MODE));
export const isMode = m => MODES.has(m);

export const STATUS = Object.freeze({ COMPLETE: 'complete', PARTIAL: 'partial', SKIP: 'skip', UNRECORDED: 'unrecorded' });
export const DID_IT = new Set([STATUS.COMPLETE, STATUS.PARTIAL]);

const KNOWN = new Set(['status', 'note', 'weight', 'unit', 'reps', 'sets', 'target', 'skipped', 'unrecorded']);
const num = v => (hasValue(v) && Number.isFinite(Number(v)) ? Number(v) : null);

/** A set in canonical form; accepts { weight, reps } or a bare reps number (with the entry's weight). */
function normalizeSet(raw, fallbackWeight) {
  const reps = num(typeof raw === 'object' && raw ? raw.reps : raw);
  if (reps === null || reps <= 0) return null;
  const weight = num(typeof raw === 'object' && raw ? raw.weight : null) ?? fallbackWeight;
  return weight !== null && weight !== undefined ? { weight, reps: Math.round(reps) } : { reps: Math.round(reps) };
}

/** Summary of a list of sets: heaviest weight and fewest reps. */
export function summarizeSets(sets) {
  if (!sets?.length) return {};
  const weights = sets.map(s => s.weight).filter(hasValue);
  return { ...(weights.length ? { weight: Math.max(...weights) } : {}), reps: Math.min(...sets.map(s => s.reps)) };
}

/** One entry in canonical form. Also upgrades shapes saved by earlier versions. */
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
    const unit = raw.unit === 'kg' ? 'kg' : 'lbs';
    const sets = Array.isArray(raw.sets) ? raw.sets.map(s => normalizeSet(s, weight)).filter(Boolean) : [];
    if (sets.length) {
      const sum = summarizeSets(sets);
      entry.sets = sets;
      if (hasValue(sum.weight)) { entry.weight = sum.weight; entry.unit = unit; }
      entry.reps = sum.reps;
    } else {
      if (weight !== null) { entry.weight = weight; entry.unit = unit; }
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

/** Sets of a logged entry; older logs with one weight × reps count it for `setCount` sets. */
export function setsOfEntry(entry, setCount) {
  if (entry?.sets?.length) return entry.sets;
  if (!hasValue(entry?.reps)) return [];
  const set = hasValue(entry.weight) ? { weight: entry.weight, reps: entry.reps } : { reps: entry.reps };
  return Array.from({ length: setCount }, () => ({ ...set }));
}

/** "50×6, 50×6" — or "50 × 6, 6" when every set used the same weight; "8, 8 reps" for bodyweight. */
export function formatSets(sets, unit = '') {
  if (!sets?.length) return '';
  const weights = new Set(sets.map(s => s.weight ?? null));
  if (weights.size === 1) {
    const [w] = weights;
    const reps = sets.map(s => s.reps).join(', ');
    return w === null ? `${reps} reps` : `${w}${unit ? ` ${unit}` : ''} × ${reps}`;
  }
  return sets.map(s => (hasValue(s.weight) ? `${s.weight}×${s.reps}` : `${s.reps}`)).join(', ');
}

/** Did these sets meet the target? (enough sets, each at least the target weight and reps) */
export function meetsTarget(sets, target) {
  if (!target) return true;
  if ((sets || []).length < target.sets) return false;
  return sets.slice(0, target.sets).every(s => s.reps >= target.reps && (!hasValue(target.weight) || (hasValue(s.weight) && s.weight >= target.weight)));
}

/**
 * Turn an in-progress workout into a record to save.
 *   scratch:  { [exerciseId]: { skipped?, note?, done?: [{ weight?, reps }] } } — what you logged
 *   targetOf: ex => { weight, reps, sets } — the target for each exercise (yours if you changed it)
 * Logged sets → complete if they met the target, otherwise partial. No logged sets → "unrecorded".
 * Skip drops any sets. `mode` is the session's mode (MODE); a lift can differ with scratch[id].mode
 * (deload or maintain just that lift, or keep one lift normal). Deloaded lifts don't move progression.
 */
export function buildSessionRecord({ sessionNum, date, scratch, targetOf, mode, deload = false, now = Date.now() }) {
  const sessionMode = isMode(mode) ? mode : (deload ? MODE.DELOAD : MODE.NORMAL);
  const entries = {};
  for (const ex of sessionExercises(sessionNum)) {
    const sc = scratch[ex.id] || {}, target = targetOf(ex);
    const sets = (sc.done || []).map(s => (ex.bw || !hasValue(s.weight) ? { reps: s.reps } : { weight: s.weight, reps: s.reps }));
    const entry = { status: STATUS.UNRECORDED, note: (sc.note || '').trim() };
    if (sc.skipped) entry.status = STATUS.SKIP;
    else if (sets.length) {
      const sum = summarizeSets(sets);
      entry.status = meetsTarget(sets, target) ? STATUS.COMPLETE : STATUS.PARTIAL;
      entry.sets = sets;
      if (hasValue(sum.weight)) { entry.weight = sum.weight; entry.unit = unitOf(ex); }
      entry.reps = sum.reps;
    }
    const liftMode = isMode(sc.mode) ? sc.mode : (typeof sc.deload === 'boolean' ? (sc.deload ? MODE.DELOAD : MODE.NORMAL) : sessionMode);
    if (liftMode !== sessionMode && DID_IT.has(entry.status)) entry.mode = liftMode;
    if (target && entry.status !== STATUS.UNRECORDED) {
      entry.target = { reps: target.reps, sets: target.sets, ...(hasValue(target.weight) ? { weight: target.weight } : {}) };
    }
    entries[ex.id] = entry;
  }
  return { id: String(now), session: Number(sessionNum), date, ts: now, ...sessionModeFields(sessionMode), entries };
}

/** The session-level fields for a mode. */
export const sessionModeFields = mode => (mode === MODE.DELOAD ? { deload: true } : mode === MODE.MAINTAIN ? { maintain: true } : {});
/** A saved session's mode. */
export const sessionMode = record => (record?.deload ? MODE.DELOAD : record?.maintain ? MODE.MAINTAIN : MODE.NORMAL);
/** How one lift was trained in a session: its own mode if it differed, else the session's. */
export function entryMode(record, entry) {
  if (isMode(entry?.mode)) return entry.mode;
  if (typeof entry?.deload === 'boolean') return entry.deload ? MODE.DELOAD : (record?.maintain ? MODE.MAINTAIN : MODE.NORMAL);   // older logs
  return sessionMode(record);
}
/**
 * What a session amounted to, by share of the lifts you actually did: a maintain (or deload) day
 * when more than DELOAD.easyShare of them were on Maintain (or Deload) — whether you set it for
 * the session or lift by lift. With nothing done, the session's own mode.
 */
export function effectiveSessionMode(record, share = 0.5) {
  const modes = exercisesForSession(record)
    .map(ex => [normalizeEntry(record.entries?.[ex.id]), ex])
    .filter(([e]) => DID_IT.has(e.status))
    .map(([e]) => entryMode(record, e));
  if (!modes.length) return sessionMode(record);
  const n = m => modes.filter(x => x === m).length;
  if (n(MODE.DELOAD) > modes.length * share) return MODE.DELOAD;
  if (n(MODE.MAINTAIN) > modes.length * share) return MODE.MAINTAIN;
  return MODE.NORMAL;
}

/** Was this lift deloaded in this session? */
export const isDeloadEntry = (record, entry) => entryMode(record, entry) === MODE.DELOAD;

/** { complete, partial, skip, unrecorded } counts for a record, over the exercises it shows. */
export function statusCounts(record) {
  const counts = { complete: 0, partial: 0, skip: 0, unrecorded: 0 };
  for (const ex of exercisesForSession(record)) counts[normalizeEntry(record.entries?.[ex.id]).status]++;
  return counts;
}

/** Newest first: by date, then by save time. */
export const byNewest = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0);
export const byOldest = (a, b) => -byNewest(a, b);
