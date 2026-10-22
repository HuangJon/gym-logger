/** Double-progression logic: "last time", today's target, and the − / + steps. */
import { hasValue, round2 } from './numbers.js';
import { normalizeEntry, DID_IT, STATUS, byNewest, setsOfEntry, meetsTarget } from './records.js';
import { exercisesForSession, incrementOf, setsOf } from './exercises.js';

/**
 * Most recent time this lift was actually done (complete or partial, with a weight or reps),
 * on or before `beforeDate`. Matched by name, so the same lift in different sessions shares
 * a history. Skipped and unrecorded sessions are passed over.
 * @returns {object|null} the entry plus { date, session }
 */
export function lastPerformance(sessions, ex, beforeDate) {
  if (!ex) return null;
  for (const record of [...sessions].sort(byNewest)) {
    if (beforeDate && record.date > beforeDate) continue;
    for (const other of exercisesForSession(record)) {
      if (other.name !== ex.name) continue;
      const e = normalizeEntry(record.entries?.[other.id]);
      if (DID_IT.has(e.status) && (hasValue(e.weight) || hasValue(e.reps))) return { ...e, date: record.date, session: record.session };
    }
  }
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Today's target by double progression. The target is always inside the rep range.
 *   first time               → default weight × bottom of range
 *   hit target, all sets at the top of the range → add the increment, back to the bottom
 *   hit target                → same weight, one more rep (capped at the top)
 *   below the range last time → same weight, aim for the bottom of the range
 *   weighted lift done at bodyweight last time → program weight, bottom of the range
 *   missed target (partial)   → the same target again — no increase until you hit it
 * @returns {{ weight: number|null, reps: number, sets: number, reason: 'first'|'bump'|'more'|'low'|'repeat'|'top'|'bodyweight' } | null}
 */
export function computeTarget(ex, last) {
  if (!ex?.reps) return null;
  const [lo, hi] = ex.reps, sets = setsOf(ex);
  const defaultWeight = ex.bw ? null : (ex.defaultWeight ?? null);
  if (!last) return { weight: defaultWeight, reps: lo, sets, reason: 'first' };

  // a weighted lift done at bodyweight last time → start at the program weight, bottom of the range
  if (!ex.bw && !hasValue(last.weight) && !hasValue(last.target?.weight)) return { weight: defaultWeight, reps: lo, sets, reason: 'bodyweight' };
  const lastWeight = ex.bw ? null : (hasValue(last.weight) ? last.weight : defaultWeight);
  const lastSets = setsOfEntry(last, sets);
  const lowest = lastSets.length ? Math.min(...lastSets.map(x => x.reps)) : null;
  if (last.status === STATUS.PARTIAL) {
    if (last.target) return { weight: ex.bw ? null : (last.target.weight ?? lastWeight), reps: clamp(last.target.reps, lo, hi), sets, reason: 'repeat' };
    return { weight: lastWeight, reps: clamp(lowest ?? lo, lo, hi), sets, reason: 'repeat' };   // older logs without a target
  }
  if (lowest === null) return { weight: lastWeight, reps: lo, sets, reason: 'first' };
  if (lowest >= hi) {
    if (ex.bw || !hasValue(lastWeight)) return { weight: lastWeight, reps: hi, sets, reason: 'top' };
    return { weight: round2(lastWeight + incrementOf(ex)), reps: lo, sets, reason: 'bump' };
  }
  if (lowest < lo) return { weight: lastWeight, reps: lo, sets, reason: 'low' };
  return { weight: lastWeight, reps: Math.min(hi, lowest + 1), sets, reason: 'more' };
}

/** One-line explanation of where today's target came from. */
export function targetReason(ex, target, last, unit) {
  if (!target) return '';
  switch (target.reason) {
    case 'bump':   return `↑ +${incrementOf(ex)} ${unit} — you hit ${ex.reps[1]} last time`;
    case 'more':   return 'same weight, one more rep';
    case 'bodyweight': return 'last time was bodyweight — starting at the program weight';
    case 'low':    return 'below range last time — aim for the bottom of the range (or go lighter)';
    case 'repeat': return 'same target — not hit last time';
    case 'top':    return ex.bw ? 'top of range — add a harder variation or a set' : 'top of range';
    default:       return last ? '' : 'first time — find a weight you can do with good form';
  }
}

/** Weight after a − / + tap: moves by the exercise's increment, never below one increment. */
export function stepWeight(ex, weight, direction) {
  const inc = incrementOf(ex);
  return Math.max(inc, round2(Number(weight) + direction * inc));
}

/** Reps after a − / + tap: from 1 up to the top of the rep range (type a number for anything else). */
export const stepReps = (reps, direction, range) => clamp(Number(reps) + direction, 1, range[1]);

/** Limits for editing a target in the pop-out. */
export const TARGET_SETS_RANGE = [1, 6];
export function stepTarget(ex, target, field, direction) {
  if (field === 'weight') return { ...target, weight: stepWeight(ex, target.weight ?? 0, direction) };
  if (field === 'reps') return { ...target, reps: clamp(target.reps + direction, ex.reps[0], ex.reps[1]) };
  return { ...target, sets: clamp(target.sets + direction, ...TARGET_SETS_RANGE) };
}

/** Where a rep count sits in the target range: 'top' | 'mid' | 'low' | 'none'. */
export function repZone(reps, range) {
  if (!hasValue(reps) || !range) return 'none';
  if (reps >= range[1]) return 'top';
  if (reps >= range[0]) return 'mid';
  return 'low';
}

/** Live check on the set you're about to log. */
export function setBadge(set, target) {
  if (!target || !hasValue(set?.reps)) return { cls: 'prog-empty', label: '' };
  if (hasValue(target.weight) && hasValue(set.weight) && set.weight < target.weight) return { cls: 'prog-low', label: 'lighter than target' };
  if (set.reps < target.reps) return { cls: 'prog-low', label: 'below target' };
  return { cls: 'prog-bump', label: '✓ on target' };
}

/** Where the exercise stands so far: how it would be saved right now. */
export function exerciseVerdict(done, target) {
  if (!done?.length) return { status: null, label: '' };
  if (meetsTarget(done, target)) return { status: STATUS.COMPLETE, label: `✓ target hit` };
  const needed = target?.sets ?? done.length;
  if (done.length < needed) return { status: STATUS.PARTIAL, label: `${done.length}/${needed} sets — partial so far` };
  return { status: STATUS.PARTIAL, label: 'partial — below target' };
}
