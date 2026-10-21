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

/** Where a rep count sits in the target range: 'top' | 'mid' | 'low' | 'none'. */
export function repZone(reps, range) {
  if (!hasValue(reps) || !range) return 'none';
  if (reps >= range[1]) return 'top';
  if (reps >= range[0]) return 'mid';
  return 'low';
}

/** Badge next to the reps box while you log. */
export function repsBadge(reps, range) {
  switch (repZone(reps, range)) {
    case 'top': return { cls: 'prog-bump', label: '↑ bump weight next session' };
    case 'mid': return { cls: 'prog-grind', label: '✓ keep grinding' };
    case 'low': return { cls: 'prog-low', label: '↓ too heavy — drop weight' };
    default:    return { cls: 'prog-empty', label: 'log reps' };
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
