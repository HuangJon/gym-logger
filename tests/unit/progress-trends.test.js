import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExercise } from '../../js/core/exercises.js';
import { lastPerformance, plannedWeight, repZone, repsBadge, nextStepHint } from '../../js/core/progress.js';
import { liftSeries, isWeighted, inRange, groupingFor, groupPoints, changeOverWindows, weeklyCounts, summaryStats } from '../../js/core/trends.js';
import { session, done, partial, skipped, unrecorded } from '../helpers.js';

const incline1 = findExercise('s1-incline'), incline3 = findExercise('s3-incline');
const deadlift = findExercise('s1-deadlift'), pulldown = findExercise('s1-pulldown');
const abwheel = findExercise('s3-abwheel'), bss = findExercise('s3-bss');

// ── last time / planned weight ──
test('lastPerformance: matches the same lift across sessions by name', () => {
  const log = [session('2026-10-10', 1, { 's1-incline': done(50, 10) }), session('2026-10-14', 3, { 's3-incline': unrecorded() })];
  const last = lastPerformance(log, incline3, '2026-10-21');
  assert.equal(last.weight, 50);
  assert.equal(last.reps, 10);
  assert.equal(last.session, 1);
});

test('lastPerformance: walks back past skipped/unrecorded, respects the date cutoff', () => {
  const log = [
    session('2026-10-01', 1, { 's1-deadlift': done(180, 6) }),
    session('2026-10-08', 1, { 's1-deadlift': skipped() }),
    session('2026-10-15', 1, { 's1-deadlift': partial(185, 4) }),
  ];
  assert.equal(lastPerformance(log, deadlift, '2026-10-21').weight, 185);
  assert.equal(lastPerformance(log, deadlift, '2026-10-14').weight, 180);
  assert.equal(lastPerformance(log, deadlift, '2026-09-30'), null);
  assert.equal(lastPerformance([], deadlift), null);
});

test('plannedWeight: typed → last logged → default → none; bodyweight → null', () => {
  const log = [session('2026-10-01', 1, { 's1-incline': done(52.5, 8) })];
  assert.equal(plannedWeight(log, incline1, { typed: 55 }), 55);
  assert.equal(plannedWeight(log, incline1), 52.5);
  assert.equal(plannedWeight([], incline1), 50);
  assert.equal(plannedWeight([], pulldown), null);
  assert.equal(plannedWeight(log, abwheel), null);
});

// ── progression ──
test('repZone / repsBadge', () => {
  assert.equal(repZone(12, [6, 12]), 'top');
  assert.equal(repZone(8, [6, 12]), 'mid');
  assert.equal(repZone(4, [6, 12]), 'low');
  assert.equal(repZone('', [6, 12]), 'none');
  assert.match(repsBadge(12, [6, 12]).label, /bump/);
  assert.match(repsBadge(9, [6, 12]).label, /keep grinding/);
  assert.match(repsBadge(4, [6, 12]).label, /too heavy/);
  assert.equal(repsBadge('', [6, 12]).cls, 'prog-empty');
});

test('nextStepHint covers every case', () => {
  assert.equal(nextStepHint(incline1, { weight: 50, unit: 'lbs', reps: 12 }), '↑ add 2.5 lbs today');
  assert.equal(nextStepHint(deadlift, { weight: 185, unit: 'lbs', reps: 8 }), '↑ add 5 lbs today');
  assert.equal(nextStepHint(incline1, { weight: 50, reps: 8 }), 'same weight, chase more reps');
  assert.equal(nextStepHint(incline1, { weight: 50, reps: 4 }), '↓ consider dropping weight');
  assert.equal(nextStepHint(bss, { reps: 10 }), 'was bodyweight last time');
  assert.equal(nextStepHint(abwheel, { reps: 10 }), '↑ top of range: add a harder variation or a set');
  assert.equal(nextStepHint(abwheel, { reps: 9 }), 'chase one more rep');
  assert.equal(nextStepHint(abwheel, { reps: 3 }), 'build back up');
  assert.equal(nextStepHint(incline1, { weight: 50 }), '');
  assert.equal(nextStepHint(incline1, null), '');
  assert.equal(nextStepHint(findExercise('s1-crunches'), { weight: 55, unit: 'kg', reps: 15 }), '↑ add 2.5 kg today');
});

// ── trends ──
test('liftSeries merges a lift across sessions, includes retired lifts only with data, adds est. 1RM', () => {
  const log = [
    session('2026-10-01', 1, { 's1-incline': done(50, 8) }),
    session('2026-10-03', 3, { 's3-incline': partial(50, 6) }),
    session('2026-10-02', 2, { 's2-dips': done(null, 8) }, { program: 'old' }),
  ];
  const series = liftSeries(log);
  const incline = series.find(s => s.name === 'Incline DB Press');
  assert.deepEqual(incline.points.map(p => p.date), ['2026-10-01', '2026-10-03']);
  assert.deepEqual([...incline.sessions].sort(), [1, 3]);
  assert.equal(incline.points[0].e1rm, 63.5);
  assert.ok(series.find(s => s.name === 'Dips' && s.retired));
  assert.ok(!series.find(s => s.name === 'Rows (elbow to hip)'));
  assert.ok(isWeighted(incline));
  assert.ok(!isWeighted(series.find(s => s.name === 'Dips')));
});

test('inRange / groupingFor', () => {
  const p = d => ({ date: d });
  assert.ok(inRange('1m', '2026-10-21')(p('2026-09-22')));
  assert.ok(!inRange('1m', '2026-10-21')(p('2026-09-21')));
  assert.ok(inRange('all', '2026-10-21')(p('2000-01-01')));
  const custom = { from: '2026-08-01', to: '2026-08-31' };
  assert.ok(inRange('custom', '2026-10-21', custom)(p('2026-08-15')));
  assert.ok(!inRange('custom', '2026-10-21', custom)(p('2026-09-01')));
  assert.equal(groupingFor('custom', custom), '1m');
  assert.equal(groupingFor('custom', { from: '2026-06-01', to: '2026-09-01' }), '3m');
  assert.equal(groupingFor('custom', { from: '2025-06-01', to: '2026-05-01' }), '1y');
  assert.equal(groupingFor('custom', { from: '2024-01-01', to: '2026-05-01' }), 'all');
  assert.equal(groupingFor('3m'), '3m');
});

const pts = (n, startDay = 0, every = 2) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1 + startDay + i * every)).toISOString().slice(0, 10);
  return { date: d, weight: 50 + Math.floor(i / 4) * 2.5, reps: 6 + (i % 4), status: 'complete' };
});

test('groupPoints: few points stay one per day; same-day sessions merge to the best', () => {
  const same = [{ date: '2026-10-21', weight: 50, reps: 6, status: 'complete' }, { date: '2026-10-21', weight: 50, reps: 8, status: 'complete' }];
  const r = groupPoints(same, 'weight', '3m');
  assert.equal(r.points.length, 1);
  assert.equal(r.points[0].reps, 8);
  assert.equal(r.by, null);
  assert.equal(groupPoints(pts(16), 'weight', '1y').by, null);
});

test('groupPoints: crowded ranges group by week / month / quarter', () => {
  assert.equal(groupPoints(pts(40), 'weight', '1m').by, null);   // 1M always per day
  const w = groupPoints(pts(40, 0, 2), 'weight', '3m');
  assert.equal(w.by, 'week');
  assert.ok(w.points.length < 40 && w.points.every(p => p.n >= 1 && p.bucketLabel.startsWith('week of')));
  assert.equal(groupPoints(pts(100, 0, 3), 'weight', '1y').by, 'month');
  assert.equal(groupPoints(pts(200, 0, 5), 'weight', 'all').by, 'quarter');   // ~2.7 years
});

test('groupPoints prefers a full set over a heavier partial', () => {
  const week = [
    { date: '2026-01-05', weight: 55, reps: 3, status: 'partial' },
    { date: '2026-01-06', weight: 50, reps: 10, status: 'complete' },
  ];
  const many = [...week, ...pts(20, 30)];
  const g = groupPoints(many, 'weight', '3m').points.find(p => p.bucketLabel === 'week of Jan 5');
  assert.equal(g.weight, 50);
  assert.equal(g.n, 2);
});

test('changeOverWindows: compares with what it was at each window start, marks short history', () => {
  const points = [
    { date: '2026-04-19', weight: 55, status: 'complete' },
    { date: '2026-09-15', weight: 50, status: 'complete' },
    { date: '2026-10-15', weight: 52.5, status: 'complete' },
  ];
  const c = changeOverWindows(points, true, '2026-10-21');
  assert.equal(c.metric, 'weight');
  assert.equal(c.cells[0].delta, 2.5);           // vs Sep 15 (on/before Sep 21)
  assert.equal(c.cells[0].short, false);
  assert.equal(c.cells[1].delta, -2.5);          // vs Apr 19
  assert.equal(c.cells[2].short, true);          // less than a year of data
  assert.ok(c.anyShort);
  assert.equal(changeOverWindows(points.slice(0, 1), true, '2026-10-21'), null);
});

test('changeOverWindows: bodyweight lifts compare reps', () => {
  const c = changeOverWindows([{ date: '2026-10-01', reps: 8, status: 'complete' }, { date: '2026-10-20', reps: 10, status: 'complete' }], false, '2026-10-21');
  assert.equal(c.metric, 'reps');
  assert.equal(c.cells[0].delta, 2);
});

test('weeklyCounts: last 8 weeks, or anchored on the last session when nothing is recent', () => {
  const log = [session('2026-10-19', 1, {}), session('2026-10-21', 2, {}), session('2026-10-12', 3, {})];
  const recent = weeklyCounts(log, '2026-10-21');
  assert.equal(recent.anchored, false);
  assert.equal(recent.weeks.length, 8);
  assert.deepEqual(recent.weeks.slice(-2).map(w => [w.start, w.count]), [['2026-10-12', 1], ['2026-10-19', 2]]);
  const old = weeklyCounts([session('2026-05-28', 3, {})], '2026-10-21');
  assert.equal(old.anchored, true);
  assert.equal(old.weeks.at(-1).count, 1);
});

test('summaryStats', () => {
  const log = [session('2026-10-20', 1, {}), session('2026-10-01', 2, {}), session('2026-09-01', 3, {})];
  assert.deepEqual(summaryStats(log, '2026-10-21'), { total: 3, perWeek: 0.5, lastDate: '2026-10-20' });
  assert.deepEqual(summaryStats([], '2026-10-21'), { total: 0, perWeek: 0, lastDate: null });
});
