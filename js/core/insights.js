/**
 * Trends insights beyond the per-lift charts: a training calendar, how often targets get hit (and
 * whether hard climbing affects it), and progress / PRs per lift. Pure functions over the log.
 */
import { DELOAD } from '../config/program.js';
import { dayNum, fromDayNum, weekStart, daysBetween, addDays } from './dates.js';
import { hasValue, estimateOneRepMax } from './numbers.js';
import { normalizeEntry, DID_IT, STATUS, MODE, entryMode, effectiveSessionMode } from './records.js';
import { exercisesForSession, allExercises } from './exercises.js';
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

export const PROGRESS = {
  trendDays: 56,        // "+6% in 8 wks": change in estimated strength over this window
  prRecentDays: 28,     // PRs older than this aren't "recent"
  repPrStep: 2,         // a rep PR needs this many more reps than your best at that weight (or the top of the range)
  sparkPoints: 12,      // sessions in each row's sparkline
};
const ATTENTION = { stalled: 0, top: 1, holding: 2, progressing: 3, new: 4, idle: 5 };

/** "185 × 6" / "12 reps" */
const setText = (weight, reps, unit) => (hasValue(weight) ? `${weight} ${unit} × ${reps}` : `${reps} reps`);
const setsOf = p => (p.sets?.length ? p.sets : [{ weight: p.weight, reps: p.reps }]).filter(x => hasValue(x.reps));

/** One number per session for "how strong": best estimated 1-rep max (weighted lifts) or most reps (bodyweight). */
function strengthOf(p, weighted) {
  const sets = setsOf(p);
  if (!sets.length) return null;
  if (!weighted) return Math.max(...sets.map(x => Number(x.reps)));
  const est = sets.filter(x => hasValue(x.weight)).map(x => estimateOneRepMax(Number(x.weight), Number(x.reps)));
  return est.length ? Math.max(...est) : null;
}
/** Heaviest weight (weighted) or most reps (bodyweight) in a session — for "start → now". */
function topOf(p, weighted) {
  const all = p.sets?.length ? p.sets : [{ weight: p.weight, reps: p.reps }];
  const vals = all.map(x => (weighted ? x.weight : x.reps)).filter(hasValue).map(Number);
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Change in strength over the PROGRESS.trendDays up to your latest session: latest vs the last one on or before
 * the window start (or your first, if you're newer than that — `short`).
 * Weighted lifts: % change in estimated 1RM. Bodyweight: change in reps.
 */
function strengthTrend(points, weighted, today, days = PROGRESS.trendDays) {
  const usable = points.map(p => ({ date: p.date, v: strengthOf(p, weighted) })).filter(x => x.v !== null);
  if (usable.length < 2) return null;
  const last = usable[usable.length - 1];
  const start = Number.isFinite(days) ? addDays(last.date < today ? last.date : today, -days) : '';   // a lift you haven't done lately: up to its last session; All → since your first
  let base = null;
  for (const x of usable) if (x.date <= start) base = x;
  const short = !base;
  base = base || usable[0];
  if (base === last) return null;
  const weeks = Math.max(1, Math.round(daysBetween(base.date, last.date) / 7));
  return weighted
    ? { metric: 'e1rm', pct: Math.round(((last.v - base.v) / base.v) * 100), from: base.v, to: last.v, weeks, since: base.date, short }
    : { metric: 'reps', delta: last.v - base.v, from: base.v, to: last.v, weeks, since: base.date, short };
}

/**
 * Per lift: where it stands now and how it's moving. Deload sessions are left out; maintain
 * sessions don't count as "no progress" (holding steady was the plan).
 *   status: 'new' (fewer than 2 sessions) | 'progressing' | 'holding' | 'stalled' | 'idle' (not done in 3+ weeks)
 *           | 'top' (a bodyweight lift at the top of its rep range — time for a harder variation)
 *   strength: latest est. 1RM (weighted) or reps (bodyweight); trend: change over `trendDays` (Infinity = since the first);
 *   startNow: first → latest top weight / reps; spark: recent strength values; workouts: session numbers.
 * Lifts come sorted "needs attention first" (stalled, top of range, holding, progressing, new, idle).
 * PRs: weight PRs, and rep PRs of +PROGRESS.repPrStep or reaching the top of the range; `recentPrs`
 * keeps only the last PROGRESS.prRecentDays.
 * @returns {{ lifts: object[], prs: object[], recentPrs: object[] }}
 */
export function liftProgress(sessions, today, { stallSessions = 4, idleDays = 21, trendDays = PROGRESS.trendDays } = {}) {
  const lifts = [], prs = [];
  for (const series of liftSeries(sessions)) {
    if (series.retired) continue;
    const points = series.points.filter(p => !p.deload);
    if (!points.length) continue;
    const weighted = !series.bw && points.some(p => hasValue(p.weight));
    const top = series.reps?.[1];
    const isRepPr = (reps, prev) => Number.isFinite(prev) && reps > prev && (reps >= prev + PROGRESS.repPrStep || (top && reps >= top));
    let best = null, maxWeight = -Infinity, maxReps = -Infinity, lastProgress = null, sinceProgress = 0;
    const repsAtOrAbove = [];   // [{ weight, reps }] — every set done, to find rep PRs
    points.forEach((p, i) => {
      // PRs (the first session is the baseline, not a PR)
      const prevMaxWeight = maxWeight, prevMaxReps = maxReps, before = [...repsAtOrAbove];
      let weightPr = null, repPr = null;
      for (const set of setsOf(p)) {
        if (weighted && hasValue(set.weight)) {
          const prevBestReps = Math.max(-Infinity, ...before.filter(x => x.weight >= set.weight).map(x => x.reps));
          if (i > 0 && set.weight > prevMaxWeight && (!weightPr || set.weight > weightPr.weight || (set.weight === weightPr.weight && set.reps > weightPr.reps))) weightPr = set;
          else if (i > 0 && set.weight <= prevMaxWeight && isRepPr(set.reps, prevBestReps) && (!repPr || set.weight > repPr.weight)) repPr = set;
          repsAtOrAbove.push({ weight: set.weight, reps: set.reps });
          if (set.weight > maxWeight || (set.weight === maxWeight && set.reps > (best?.reps ?? 0))) best = { weight: set.weight, reps: set.reps, date: p.date };
          maxWeight = Math.max(maxWeight, set.weight);
        } else if (!weighted) {
          if (i > 0 && isRepPr(set.reps, prevMaxReps) && (!repPr || set.reps > repPr.reps)) repPr = set;
          if (set.reps > maxReps) best = { weight: null, reps: set.reps, date: p.date };
          maxReps = Math.max(maxReps, set.reps);
        }
      }
      if (weightPr) prs.push({ name: series.name, date: p.date, text: `heaviest: ${setText(weightPr.weight, weightPr.reps, series.unit)}`, kind: 'weight' });
      else if (repPr) prs.push({ name: series.name, date: p.date, text: `rep PR: ${weighted ? setText(repPr.weight, repPr.reps, series.unit) : `${repPr.reps} reps`}`, kind: 'reps' });
      // did this session move forward from the last one?
      const prev = points[i - 1];
      if (prev) {
        const up = weighted
          ? (p.weight > prev.weight || (p.weight === prev.weight && p.reps > prev.reps))
          : p.reps > prev.reps;
        if (up) { lastProgress = p.date; sinceProgress = 0; } else if (!p.maintain) sinceProgress++;
      }
    });
    const last = points[points.length - 1], first = points[0];
    const idle = daysBetween(last.date, today) >= idleDays;
    const atTop = !weighted && series.reps && hasValue(last.reps) && last.reps >= series.reps[1];
    const status = points.length < 2 ? 'new' : idle ? 'idle' : atTop ? 'top' : sinceProgress >= stallSessions ? 'stalled' : sinceProgress === 0 ? 'progressing' : 'holding';
    const firstTop = topOf(first, weighted), lastTop = topOf(last, weighted);
    lifts.push({
      name: series.name, unit: series.unit, weighted, best, lastProgress, sinceProgress, lastDate: last.date, status, sessions: points.length,
      workouts: [...series.sessions].sort(),
      strength: [...points].reverse().map(p => strengthOf(p, weighted)).find(v => v !== null) ?? null,   // latest session with reps recorded
      trend: strengthTrend(points, weighted, today, trendDays),
      startNow: points.length > 1 && firstTop !== null && lastTop !== null ? { from: firstTop, to: lastTop, since: first.date } : null,
      spark: points.slice(-PROGRESS.sparkPoints).map(p => strengthOf(p, weighted)).filter(v => v !== null),
    });
  }
  lifts.sort((a, b) => ATTENTION[a.status] - ATTENTION[b.status]);
  const seen = new Set();
  const dedupedPrs = prs.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'weight' ? -1 : 1))
    .filter(pr => { const k = `${pr.name}|${pr.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { lifts, prs: dedupedPrs, recentPrs: dedupedPrs.filter(pr => pr.date <= today && daysBetween(pr.date, today) < PROGRESS.prRecentDays) };
}

// ── pick-one groups (e.g. crunches or ab wheel) ───────────

/**
 * How often you pick each option of a pick-one group, over its last `limit` sessions where you did
 * at least one: { names: [a, b], counts: { [name]: only-that }, both, total }.
 */
export function pickOneUsage(sessions, group, limit = 10) {
  const options = allExercises().filter(ex => ex.pickOne === group && !ex.retired);
  if (options.length < 2) return null;
  const sessionNum = options[0].session;
  const did = (record, ex) => DID_IT.has(normalizeEntry(record.entries?.[ex.id]).status);
  const recent = sessions.filter(s => Number(s.session) === sessionNum && options.some(ex => did(s, ex)))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  if (!recent.length) return null;
  const counts = Object.fromEntries(options.map(ex => [ex.name, 0]));
  let both = 0;
  for (const s of recent) {
    const done = options.filter(ex => did(s, ex));
    if (done.length > 1) both++; else counts[done[0].name]++;
  }
  return { names: options.map(ex => ex.name), counts, both, total: recent.length, session: sessionNum };
}
