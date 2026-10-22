/** Double-progression logic: "last time", today's target, and the − / + steps. */
import { STALE_AFTER_DAYS, EASE_BACK_FACTOR, DELOAD } from '../config/program.js';
import { hasValue, round2, convertWeight } from './numbers.js';
import { daysBetween } from './dates.js';
import { normalizeEntry, DID_IT, STATUS, byNewest, setsOfEntry, meetsTarget, isDeloadEntry } from './records.js';
import { exercisesForSession, incrementOf, setsOf, unitOf, defaultWeightOf } from './exercises.js';

/**
 * Times this lift was actually done (complete or partial, with a weight or reps), newest first,
 * on or before `beforeDate`. Matched by name, so the same lift in different sessions shares
 * a history. Skipped and unrecorded entries are passed over, and so are deload sessions
 * unless `includeDeload` — a deload never moves your progression.
 * @returns {object[]} entries plus { date, session, deload? }
 */
export function performances(sessions, ex, beforeDate, { includeDeload = false, limit = Infinity } = {}) {
  const found = [];
  if (!ex) return found;
  for (const record of [...sessions].sort(byNewest)) {
    if (found.length >= limit) break;
    if (beforeDate && record.date > beforeDate) continue;
    for (const other of exercisesForSession(record)) {
      if (other.name !== ex.name) continue;
      const e = normalizeEntry(record.entries?.[other.id]);
      const deload = isDeloadEntry(record, e);
      if (deload && !includeDeload) continue;
      if (DID_IT.has(e.status) && (hasValue(e.weight) || hasValue(e.reps))) {
        found.push({ ...inUnit(e, ex), date: record.date, session: record.session, deload });
        break;
      }
    }
  }
  return found;
}

/**
 * An entry with its weights in the unit you use for `ex` now (rounded to the lift's step),
 * so a lift logged in lbs and later switched to kg still gets sensible targets.
 */
export function inUnit(entry, ex) {
  const to = unitOf(ex), from = entry.unit || to;
  if (ex.bw || from === to) return entry;
  const conv = w => convertWeight(w, from, to, incrementOf(ex));
  const out = { ...entry, unit: to };
  if (hasValue(entry.weight)) out.weight = conv(entry.weight);
  if (entry.sets) out.sets = entry.sets.map(s => (hasValue(s.weight) ? { ...s, weight: conv(s.weight) } : s));
  if (entry.target && hasValue(entry.target.weight)) out.target = { ...entry.target, weight: conv(entry.target.weight) };
  return out;
}

/**
 * The note from the last time this lift appeared in a session (done, partial or skipped), if it
 * had one — so "grip slipped" shows up next time. Older notes don't resurface.
 * @returns {{ note: string, date: string } | null}
 */
export function lastNote(sessions, ex, beforeDate) {
  for (const record of [...sessions].sort(byNewest)) {
    if (beforeDate && record.date >= beforeDate) continue;
    for (const other of exercisesForSession(record)) {
      if (other.name !== ex.name) continue;
      const e = normalizeEntry(record.entries?.[other.id]);
      if (e.status === STATUS.UNRECORDED && !e.note) continue;
      return e.note ? { note: e.note, date: record.date } : null;
    }
  }
  return null;
}

/** The most recent performance (see `performances`), or null. */
export const lastPerformance = (sessions, ex, beforeDate, opts = {}) => performances(sessions, ex, beforeDate, { ...opts, limit: 1 })[0] ?? null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * About `factor` of `weight`, rounded down to the lift's step — or to the nearest step when rounding
 * down would cut more than 20% (light cable weights), so a 5 lb lateral stays at 5.
 */
export function lighterWeight(ex, weight, factor) {
  if (!hasValue(weight)) return weight ?? null;
  const inc = incrementOf(ex), scaled = weight * factor / inc;
  const down = round2(Math.floor(scaled + 1e-9) * inc);
  if (down > 0 && (weight - down) / weight <= 0.2 + 1e-9) return down;
  const near = round2(Math.round(scaled) * inc);
  return near > 0 ? Math.min(near, weight) : weight;   // never heavier than where you started
}

export const DELOAD_STYLES = Object.freeze({ SETS: 'sets', LIGHTER: 'lighter' });

/**
 * A deload target from your normal weight and set count. Always the bottom of the rep range.
 *   'sets'    → same weight, half the sets (rounded up)
 *   'lighter' → ~10% lighter, same sets — or, if the weight is too light to drop a step (or it's a
 *               bodyweight lift), half the sets instead (`fallback: true`)
 */
export function deloadTarget(ex, weight, sets, style = DELOAD_STYLES.SETS) {
  const [lo] = ex.reps, half = Math.max(1, Math.ceil(sets * DELOAD.setsFactor));
  const w = ex.bw ? null : (weight ?? null);
  if (style === DELOAD_STYLES.LIGHTER) {
    const lighter = lighterWeight(ex, w, DELOAD.weightFactor);
    if (hasValue(w) && lighter < w) return { weight: lighter, reps: lo, sets, reason: 'deload', style, lighter: true };
    return { weight: w, reps: lo, sets: half, reason: 'deload', style: DELOAD_STYLES.SETS, fallback: true };
  }
  return { weight: w, reps: lo, sets: half, reason: 'deload', style: DELOAD_STYLES.SETS };
}

/**
 * Today's target. Normally double progression (`progressionTarget`), adjusted for:
 *   deload        → see deloadTarget (opts.deloadStyle: 'sets' | 'lighter'; reason 'deload')
 *   long break    → last time was over STALE_AFTER_DAYS ago: ~10% lighter, bottom of the range (reason 'ease')
 * opts.date: the workout's date; opts.lastActive: date you last did the lift at all (deloads included).
 */
export function computeTarget(ex, last, { date, lastActive, deload = false, deloadStyle = DELOAD_STYLES.SETS } = {}) {
  const base = progressionTarget(ex, last);
  if (!base) return null;
  const [lo] = ex.reps;
  const lastWeight = ex.bw ? null : (hasValue(last?.weight) ? last.weight : base.weight);
  const since = [lastActive, last?.date].filter(Boolean).sort().pop();
  const daysOff = since && date ? daysBetween(since, date) : 0;
  const easing = !!last && daysOff > STALE_AFTER_DAYS;
  const easedWeight = ex.bw ? null : lighterWeight(ex, lastWeight, EASE_BACK_FACTOR);
  // a deload after a long break starts from the eased weight, so it's never heavier than a normal session
  if (deload) {
    const t = deloadTarget(ex, easing ? easedWeight : lastWeight, base.sets, deloadStyle);
    return easing && hasValue(easedWeight) && easedWeight < lastWeight ? { ...t, afterBreak: true } : t;
  }
  if (easing) {
    return { weight: easedWeight, reps: lo, sets: base.sets, reason: 'ease', daysOff, ...(hasValue(easedWeight) && easedWeight < lastWeight ? { lighter: true } : {}) };
  }
  return base;
}

/**
 * Double progression. The target is always inside the rep range.
 *   first time               → default weight × bottom of range
 *   hit target, all sets at the top of the range → add the increment, back to the bottom
 *   hit target                → same weight, one more rep (capped at the top)
 *   below the range last time → same weight, aim for the bottom of the range
 *   weighted lift done at bodyweight last time → program weight, bottom of the range
 *   missed target (partial)   → the same target again — no increase until you hit it
 *   went lighter than the target weight on every set → progress from the weight you actually used
 * @returns {{ weight: number|null, reps: number, sets: number, reason: 'first'|'bump'|'more'|'low'|'repeat'|'top'|'bodyweight' } | null}
 */
export function progressionTarget(ex, last) {
  if (!ex?.reps) return null;
  const [lo, hi] = ex.reps, sets = setsOf(ex);
  const defaultWeight = defaultWeightOf(ex);
  if (!last) return { weight: defaultWeight, reps: lo, sets, reason: 'first' };

  // a weighted lift done at bodyweight last time → start at the program weight, bottom of the range
  if (!ex.bw && !hasValue(last.weight) && !hasValue(last.target?.weight)) return { weight: defaultWeight, reps: lo, sets, reason: 'bodyweight' };
  const lastWeight = ex.bw ? null : (hasValue(last.weight) ? last.weight : defaultWeight);
  const lastSets = setsOfEntry(last, sets);
  const lowest = lastSets.length ? Math.min(...lastSets.map(x => x.reps)) : null;
  // Went lighter than the target on purpose (e.g. finding your weight) → build on what you did, don't repeat the target.
  const wentLighter = !ex.bw && hasValue(last.target?.weight) && lastSets.length > 0
    && lastSets.every(x => hasValue(x.weight) && x.weight < last.target.weight);
  if (last.status === STATUS.PARTIAL && !wentLighter) {
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

/**
 * How many sessions in a row this lift missed the same target weight (partial, at least one set at
 * the target weight). Used to suggest going ~10% lighter after MISSES_BEFORE_HINT misses.
 */
export const MISSES_BEFORE_HINT = 3;
export function missedStreak(sessions, ex, beforeDate) {
  const recent = performances(sessions, ex, beforeDate, { limit: 6 });
  const weight = recent[0]?.target?.weight;
  let n = 0;
  for (const p of recent) {
    const triedTarget = !hasValue(weight) || (p.sets || []).some(s => hasValue(s.weight) && s.weight >= weight);
    if (p.status !== STATUS.PARTIAL || p.target?.weight !== weight || !triedTarget) break;
    n++;
  }
  return n;
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
    case 'ease':   return `${target.daysOff} days since last time — ${target.lighter ? '~10% lighter, bottom of the range' : 'bottom of the range'} to ease back in`;
    case 'deload': return target.lighter
      ? 'deload — ~10% lighter, bottom of the range, stop 2–3 reps short of failure'
      : `deload — ${ex.bw ? '' : target.afterBreak ? 'eased weight after the break, ' : 'same weight, '}half the sets, bottom of the range, stop 2–3 reps short of failure${target.fallback ? ' (too light to drop a step)' : ''}`;
    default:       return last ? '' : 'first time — find a weight you can do with good form';
  }
}

/** Weight after a − / + tap: moves by the exercise's increment, never below one increment. */
export function stepWeight(ex, weight, direction) {
  const inc = incrementOf(ex);
  return Math.max(inc, round2(Number(weight) + direction * inc));
}

/** − / + can go this many reps past either end of the range (a set a rep or two short, or a weight that was too light). */
export const REP_STEP_MARGIN = 2;
const repStepLimits = ([lo, hi]) => [Math.max(1, lo - REP_STEP_MARGIN), hi + REP_STEP_MARGIN];

/**
 * Reps after a − / + tap: within the rep range ± REP_STEP_MARGIN (type a number for anything further).
 * A typed number outside those limits is never pulled back in by a tap the other way.
 */
export function stepReps(reps, direction, range) {
  const [min, max] = repStepLimits(range), r = Number(reps) || range[0];
  return direction < 0 ? Math.max(Math.min(min, r), r - 1) : Math.max(Math.min(max, r + 1), r);
}
export const canStepRepsDown = (reps, range) => Number(reps) > repStepLimits(range)[0];
export const canStepRepsUp = (reps, range) => Number(reps) < repStepLimits(range)[1];

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
