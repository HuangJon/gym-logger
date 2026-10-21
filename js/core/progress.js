/** Double-progression logic: "last time", the weight to pre-fill, and what to do next. */
import { hasValue } from './numbers.js';
import { normalizeEntry, DID_IT, byNewest } from './records.js';
import { exercisesForSession, incrementOf, unitOf } from './exercises.js';

/**
 * Most recent time this lift was actually done (complete or partial, with a weight or reps),
 * on or before `beforeDate`. Matched by name, so the same lift in different sessions shares
 * a history. Skipped and unrecorded sessions are passed over.
 * @returns {{status, weight?, unit?, reps?, note, date, session} | null}
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

/** Weight to show on the card: what you typed this session → last logged weight → program default. */
export function plannedWeight(sessions, ex, { typed, beforeDate } = {}) {
  if (!ex || ex.bw) return null;
  if (typed !== undefined) return typed;
  const last = lastPerformance(sessions, ex, beforeDate);
  if (last && hasValue(last.weight)) return last.weight;
  return ex.defaultWeight ?? null;
}

/**
 * Reps to aim for today, by double progression:
 *   nothing logged yet → bottom of the range
 *   heavier than last time → bottom of the range
 *   lighter than last time → at least what you did last time
 *   same weight → one more than last time, capped at the top of the range
 * @returns {number|null} null when the exercise has no rep range
 */
export function suggestedReps(ex, last, weight) {
  if (!ex?.reps) return null;
  const [lo, hi] = ex.reps;
  if (!last || !hasValue(last.reps)) return lo;
  const comparable = !ex.bw && hasValue(last.weight) && hasValue(weight);
  if (comparable && weight > last.weight) return lo;
  if (comparable && weight < last.weight) return Math.min(hi, Math.max(lo, last.reps));
  return Math.min(hi, last.reps + 1);
}

/** Weight after a − / + tap: moves by the exercise's increment, never below one increment. */
export function stepWeight(ex, weight, direction) {
  const inc = incrementOf(ex);
  const next = Math.round((Number(weight) + direction * inc) * 100) / 100;
  return Math.max(inc, next);
}

/** Reps after a − / + tap: whole numbers, never below 0. */
export const stepReps = (reps, direction) => Math.max(0, Number(reps) + direction);

/** Where a rep count sits in the target range: 'top' | 'mid' | 'low' | 'none'. */
export function repZone(reps, range) {
  if (!hasValue(reps) || !range) return 'none';
  if (reps >= range[1]) return 'top';
  if (reps >= range[0]) return 'mid';
  return 'low';
}

/** Badge next to the reps box while you log. `suggested` is shown as the aim until reps are entered. */
export function repsBadge(reps, range, suggested = null) {
  switch (repZone(reps, range)) {
    case 'top': return { cls: 'prog-bump', label: '↑ bump weight next session' };
    case 'mid': return { cls: 'prog-grind', label: '✓ keep grinding' };
    case 'low': return { cls: 'prog-low', label: '↓ too heavy — drop weight' };
    default:    return { cls: 'prog-empty', label: suggested != null ? `aim for ${suggested}` : 'log reps' };
  }
}

/** Advice under "Last time", based on what you did last time. Empty string when there's nothing to say. */
export function nextStepHint(ex, last) {
  if (!ex || !last) return '';
  if (!ex.bw && !hasValue(last.weight)) return 'was bodyweight last time';
  if (!ex.reps || !hasValue(last.reps)) return '';
  const zone = repZone(last.reps, ex.reps);
  if (ex.bw) return { top: '↑ top of range: add a harder variation or a set', mid: 'chase one more rep', low: 'build back up' }[zone];
  return { top: `↑ add ${incrementOf(ex)} ${last.unit || unitOf(ex)} today`, mid: 'same weight, chase more reps', low: '↓ consider dropping weight' }[zone];
}
