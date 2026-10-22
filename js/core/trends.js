/** Data for the Trends tab: per-lift series, grouping for long ranges, change over time, weekly counts. */
import { dayNum, daysBetween, weekStart, fromDayNum, formatShort } from './dates.js';
import { hasValue, estimateOneRepMax } from './numbers.js';
import { normalizeEntry, DID_IT, STATUS, MODE, byOldest, entryMode } from './records.js';
import { allExercises, exercisesForSession, unitOf } from './exercises.js';
import { inUnit } from './progress.js';

export const RANGES = { '1m': 30, '3m': 91, '1y': 365, all: Infinity };

/**
 * One series per lift name (same lift across sessions is merged). Points are oldest-first and only
 * include sessions where the lift was done. Retired lifts appear only if they have data.
 */
export function liftSeries(sessions) {
  const byName = new Map();
  for (const ex of allExercises()) {
    if (!byName.has(ex.name)) byName.set(ex.name, { name: ex.name, bw: !!ex.bw, reps: ex.reps, unit: unitOf(ex), retired: !!ex.retired, sessions: new Set(), points: [] });
    if (!ex.retired) byName.get(ex.name).sessions.add(ex.session);
  }
  for (const record of [...sessions].sort(byOldest)) {
    for (const ex of exercisesForSession(record)) {
      const e = inUnit(normalizeEntry(record.entries?.[ex.id]), ex);   // charted in the unit you use now
      if (!DID_IT.has(e.status) || (!hasValue(e.weight) && !hasValue(e.reps))) continue;
      const point = { date: record.date, ts: record.ts || 0, weight: e.weight, reps: e.reps, sets: e.sets, unit: e.unit, status: e.status, session: record.session, ...(entryMode(record, e) === MODE.DELOAD ? { deload: true } : entryMode(record, e) === MODE.MAINTAIN ? { maintain: true } : {}) };
      if (hasValue(e.weight) && hasValue(e.reps)) point.e1rm = estimateOneRepMax(e.weight, e.reps);
      byName.get(ex.name).points.push(point);
    }
  }
  return [...byName.values()].filter(s => !s.retired || s.points.length);
}

/** True if the series has weights to chart (otherwise it's a reps-only lift). */
export const isWeighted = series => !series.bw && series.points.some(p => hasValue(p.weight));

/** Filter for points inside the selected range. */
export function inRange(range, today, custom) {
  if (range === 'custom') return p => p.date >= custom.from && p.date <= custom.to;
  const days = RANGES[range];
  return p => days === Infinity || daysBetween(p.date, today) < days;
}

/** A custom range groups like the preset closest to its length. */
export function groupingFor(range, custom) {
  if (range !== 'custom') return range;
  const span = daysBetween(custom.from, custom.to);
  return span <= 45 ? '1m' : span <= 120 ? '3m' : span <= 400 ? '1y' : 'all';
}

/**
 * Keep charts readable: one dot per day (same-day sessions merged) unless the range is crowded
 * (more than 16 days), then best set per week (3M), per month (1Y, All), or per quarter (All, 2+ years).
 * "Best" prefers full sets, then the highest value for the chart (weight then reps, or est. 1RM, or reps).
 * @returns {{ points: object[], by: null | 'week' | 'month' | 'quarter' }}
 */
export function groupPoints(points, mode, grouping) {
  if (points.length <= 1) return { points, by: null };
  const score = p => mode === 'reps' ? [Number(p.reps) || 0, 0]
                   : mode === 'e1rm' ? [p.e1rm ?? -1, 0]
                   : [hasValue(p.weight) ? Number(p.weight) : -1, Number(p.reps) || 0];
  const better = (a, b) => {
    if (a.status !== b.status) return a.status === STATUS.COMPLETE;
    const [a1, a2] = score(a), [b1, b2] = score(b);
    return a1 !== b1 ? a1 > b1 : a2 > b2;
  };
  const bucket = (keyOf, labelOf) => {
    const groups = new Map();
    for (const p of points) {
      const k = keyOf(p), g = groups.get(k) || { best: p, n: 0 };
      g.n++; if (better(p, g.best)) g.best = p; groups.set(k, g);
    }
    return [...groups.entries()].map(([k, g]) => ({ ...g.best, n: g.n, bucketLabel: labelOf(k) }));
  };
  const utc = (ms, opts) => new Date(ms).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  const days = bucket(p => p.date, formatShort);
  if (grouping === '1m' || days.length <= 16) return { points: days, by: null };
  const weeks = () => bucket(p => weekStart(p.date), k => 'week of ' + utc(k * 86_400_000, { month: 'short', day: 'numeric' }));
  const months = () => bucket(p => p.date.slice(0, 7), k => { const [y, m] = k.split('-').map(Number); return utc(Date.UTC(y, m - 1, 1), { month: 'long', year: 'numeric' }); });
  const quarters = () => bucket(p => `${p.date.slice(0, 4)} Q${Math.ceil(Number(p.date.slice(5, 7)) / 3)}`, k => k);
  if (grouping === '3m') return { points: weeks(), by: 'week' };
  if (grouping === '1y') return { points: months(), by: 'month' };
  const m = months();
  return m.length <= 24 ? { points: m, by: 'month' } : { points: quarters(), by: 'quarter' };
}

export const CHANGE_WINDOWS = [['1 mo', 30], ['3 mo', 91], ['1 yr', 365]];

/**
 * Change over 1 month / 3 months / 1 year: latest completed log vs. the last completed log on or
 * before the start of each window. With less history than a window, compares with the first log
 * and marks it `short`. Weighted lifts compare weight; bodyweight lifts compare reps.
 * @returns {null | { metric: 'weight'|'reps', firstDate, anyShort, cells: (null|{delta, vsDate, short})[] }}
 */
export function changeOverWindows(points, weighted, today) {
  const key = weighted ? 'weight' : 'reps';
  const usable = points.filter(p => hasValue(p[key]));
  const done = usable.filter(p => p.status === STATUS.COMPLETE);
  const src = done.length >= 2 ? done : usable;
  if (src.length < 2) return null;
  const latest = src[src.length - 1], now = dayNum(today);
  let anyShort = false;
  const cells = CHANGE_WINDOWS.map(([, days]) => {
    const start = now - days;
    let before = null;
    for (const p of src) if (dayNum(p.date) <= start) before = p;
    const base = before || src.find(p => dayNum(p.date) > start);
    if (!base || base === latest) return null;
    if (!before) anyShort = true;
    return { delta: Number(latest[key]) - Number(base[key]), vsDate: base.date, short: !before };
  });
  return { metric: key, firstDate: src[0].date, anyShort, cells };
}

/**
 * Sessions per week (Monday start) for the last `weeks` weeks. If nothing was logged in that
 * time, shows the weeks leading up to the last session instead (`anchored: true`).
 */
export function weeklyCounts(sessions, today, weeks = 8, climbs = []) {
  let end = dayNum(today);
  const last = sessions.reduce((m, s) => Math.max(m, dayNum(s.date)), -Infinity);
  const anchored = Number.isFinite(last) && end - last > weeks * 7;
  if (anchored) end = last;
  const thisWeek = weekStart(fromDayNum(end));
  const result = Array.from({ length: weeks }, (_, i) => ({ start: fromDayNum(thisWeek - (weeks - 1 - i) * 7), count: 0, climbs: 0, hardClimbs: 0 }));
  const weekOf = date => result.find(r => date >= r.start && dayNum(date) < dayNum(r.start) + 7);
  for (const s of sessions) { const w = weekOf(s.date); if (w) w.count++; }
  for (const c of climbs) { const w = weekOf(c.date); if (w) { w.climbs++; if (c.intensity === 'hard') w.hardClimbs++; } }
  return { weeks: result, anchored };
}

/** Headline numbers for the top of Trends. */
export function summaryStats(sessions, today) {
  const recent = sessions.filter(s => { const d = daysBetween(s.date, today); return d >= 0 && d < 28; }).length;
  const lastDate = sessions.reduce((m, s) => (s.date > m ? s.date : m), '');
  return { total: sessions.length, perWeek: recent / 4, lastDate: lastDate || null };
}
