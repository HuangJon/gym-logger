/**
 * Trends insights beyond the per-lift charts: a training calendar, how often targets get hit (and
 * whether hard climbing affects it), and progress / PRs per lift. Pure functions over the log.
 */
import { DELOAD } from '../config/program.js';
import { dayNum, fromDayNum, weekStart, daysBetween, addDays } from './dates.js';
import { hasValue } from './numbers.js';
import { normalizeEntry, DID_IT, STATUS, MODE, entryMode, effectiveSessionMode } from './records.js';
import { exercisesForSession } from './exercises.js';
import { liftSeries } from './trends.js';
import { CLIMB } from './climbs.js';

/** End date for a "last N weeks" view: today, or your last activity if nothing is that recent. */
function anchorDate(dates, today, days) {
  const last = dates.filter(d => d <= today).sort().pop();
  return last && daysBetween(last, today) >= days ? { end: last, anchored: true } : { end: today, anchored: false };
}

// ── training calendar ─────────────────────────────────────

/**
 * Weeks (Monday first) of days for the calendar: what you lifted (session + mode) and climbed.
 * @returns {{ weeks: { start, days: { date, future, lifts: { session, mode }[], climb: 'easy'|'hard'|null }[] }[], anchored }}
 */
export function calendarWeeks(sessions, climbs, today, weeks = 12) {
  const { end, anchored } = anchorDate([...sessions.map(s => s.date), ...climbs.map(c => c.date)], today, weeks * 7);
  const first = weekStart(fromDayNum(dayNum(end) - (weeks - 1) * 7));
  const liftsOn = new Map(), climbOn = new Map();
  for (const s of sessions) {
    if (!liftsOn.has(s.date)) liftsOn.set(s.date, []);
    liftsOn.get(s.date).push({ session: s.session, mode: effectiveSessionMode(s, DELOAD.easyShare) });
  }
  for (const c of climbs) if (climbOn.get(c.date) !== CLIMB.HARD) climbOn.set(c.date, c.intensity);
  const result = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(fromDayNum(first), w * 7);
    result.push({ start, days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      return { date, future: date > today, lifts: liftsOn.get(date) || [], climb: climbOn.get(date) ?? null };
    }) });
  }
  return { weeks: result, anchored };
}

// ── target hit rate ───────────────────────────────────────

/** Lifts done in normal mode that had a target: [{ date, hit }]. Maintain / deload lifts are left out (easy targets). */
function targetedLifts(sessions) {
  const out = [];
  for (const record of sessions) {
    for (const ex of exercisesForSession(record)) {
      const e = normalizeEntry(record.entries?.[ex.id]);
      if (!DID_IT.has(e.status) || !e.target || entryMode(record, e) !== MODE.NORMAL) continue;
      out.push({ date: record.date, hit: e.status === STATUS.COMPLETE });
    }
  }
  return out;
}

const rate = list => ({ hit: list.filter(x => x.hit).length, total: list.length });
export const MIN_COMPARE = 5;   // lifts needed on each side before comparing climbing vs not

/**
 * How often you hit your targets: per week (last `weeks`), the last 4 weeks overall, and the day
 * after a hard climb vs other days.
 */
export function targetHitRate(sessions, climbs, today, weeks = 8) {
  const lifts = targetedLifts(sessions);
  const { end, anchored } = anchorDate(lifts.map(l => l.date), today, weeks * 7);
  const thisWeek = weekStart(end);
  const byWeek = Array.from({ length: weeks }, (_, i) => {
    const start = fromDayNum(thisWeek - (weeks - 1 - i) * 7);
    return { start, ...rate(lifts.filter(l => l.date >= start && dayNum(l.date) < dayNum(start) + 7)) };
  });
  const recent = rate(lifts.filter(l => l.date <= end && daysBetween(l.date, end) < 28));
  const hardDays = new Set(climbs.filter(c => c.intensity === CLIMB.HARD).map(c => addDays(c.date, 1)));
  const afterHard = rate(lifts.filter(l => hardDays.has(l.date)));
  const otherDays = rate(lifts.filter(l => !hardDays.has(l.date)));
  return { weeks: byWeek, recent, afterHard, otherDays, anchored, total: lifts.length };
}

export const pct = r => (r.total ? Math.round((r.hit / r.total) * 100) : null);

// ── progress per lift ─────────────────────────────────────

/** "185 × 6" / "12 reps" */
const setText = (weight, reps, unit) => (hasValue(weight) ? `${weight} ${unit} × ${reps}` : `${reps} reps`);

/**
 * Per lift: best set, PRs, and when it last moved forward. Deload sessions are left out; maintain
 * sessions don't count as "no progress" (holding steady was the plan).
 *   status: 'new' (fewer than 2 sessions) | 'progressing' | 'holding' | 'stalled' | 'idle' (not done in 3+ weeks)
 *           | 'top' (a bodyweight lift at the top of its rep range — time for a harder variation)
 * @returns {{ lifts: object[], prs: { name, date, text, kind }[] }}
 */
export function liftProgress(sessions, today, { stallSessions = 4, idleDays = 21 } = {}) {
  const lifts = [], prs = [];
  for (const series of liftSeries(sessions)) {
    if (series.retired) continue;
    const points = series.points.filter(p => !p.deload);
    if (!points.length) continue;
    const weighted = !series.bw && points.some(p => hasValue(p.weight));
    let best = null, maxWeight = -Infinity, maxReps = -Infinity, lastProgress = null, sinceProgress = 0;
    const repsAtOrAbove = [];   // [{ weight, reps }] — every set done, to find rep PRs
    points.forEach((p, i) => {
      const sets = p.sets?.length ? p.sets : [{ weight: p.weight, reps: p.reps }];
      // PRs (the first session is the baseline, not a PR)
      for (const set of sets) {
        if (!hasValue(set.reps)) continue;
        if (weighted && hasValue(set.weight)) {
          const prevBestReps = Math.max(-Infinity, ...repsAtOrAbove.filter(x => x.weight >= set.weight).map(x => x.reps));
          if (i > 0 && set.weight > maxWeight) prs.push({ name: series.name, date: p.date, text: `heaviest: ${setText(set.weight, set.reps, series.unit)}`, kind: 'weight' });
          else if (i > 0 && set.reps > prevBestReps && Number.isFinite(prevBestReps)) prs.push({ name: series.name, date: p.date, text: `rep PR: ${setText(set.weight, set.reps, series.unit)}`, kind: 'reps' });
          repsAtOrAbove.push({ weight: set.weight, reps: set.reps });
          if (set.weight > maxWeight || (set.weight === maxWeight && set.reps > (best?.reps ?? 0))) best = { weight: set.weight, reps: set.reps, date: p.date };
          maxWeight = Math.max(maxWeight, set.weight);
        } else if (!weighted) {
          if (i > 0 && set.reps > maxReps) prs.push({ name: series.name, date: p.date, text: `rep PR: ${set.reps} reps`, kind: 'reps' });
          if (set.reps > maxReps) best = { weight: null, reps: set.reps, date: p.date };
          maxReps = Math.max(maxReps, set.reps);
        }
      }
      // did this session move forward from the last one?
      const prev = points[i - 1];
      if (prev) {
        const up = weighted
          ? (p.weight > prev.weight || (p.weight === prev.weight && p.reps > prev.reps))
          : p.reps > prev.reps;
        if (up) { lastProgress = p.date; sinceProgress = 0; } else if (!p.maintain) sinceProgress++;
      }
    });
    const last = points[points.length - 1];
    const idle = daysBetween(last.date, today) >= idleDays;
    const atTop = !weighted && series.reps && hasValue(last.reps) && last.reps >= series.reps[1];
    const status = points.length < 2 ? 'new' : idle ? 'idle' : atTop ? 'top' : sinceProgress >= stallSessions ? 'stalled' : sinceProgress === 0 ? 'progressing' : 'holding';
    lifts.push({ name: series.name, unit: series.unit, weighted, best, lastProgress, sinceProgress, lastDate: last.date, status, sessions: points.length });
  }
  const seen = new Set();
  const dedupedPrs = prs.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'weight' ? -1 : 1))
    .filter(pr => { const k = `${pr.name}|${pr.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { lifts, prs: dedupedPrs };
}

