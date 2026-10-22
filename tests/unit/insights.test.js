/** Trends insights: training calendar, target hit rate, progress / PRs per lift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWeeks, targetHitRate, liftProgress, pickOneUsage, pct } from '../../js/core/insights.js';
import { session, done, partial } from '../helpers.js';

const withTarget = (entry, target) => ({ ...entry, target });
const T = { weight: 185, reps: 7, sets: 2 };

test('calendar: 12 Monday-first weeks with lifts (mode by share) and climbs', () => {
  const sessions = [
    session('2026-10-19', 1, { 's1-deadlift': done(185, 7) }),
    { ...session('2026-10-21', 2, { 's2-rows': done(35, 8) }), deload: true },
  ];
  const climbs = [{ date: '2026-10-20', intensity: 'easy' }, { date: '2026-10-21', intensity: 'hard' }, { date: '2026-10-21', intensity: 'easy' }];
  const { weeks, anchored } = calendarWeeks(sessions, climbs, '2026-10-22');
  assert.equal(weeks.length, 12);
  assert.equal(anchored, false);
  const last = weeks[11];
  assert.equal(last.start, '2026-10-19');   // a Monday
  assert.deepEqual(last.days[0].lifts, [{ session: 1, mode: 'normal' }]);
  assert.equal(last.days[1].climb, 'easy');
  assert.deepEqual(last.days[2].lifts, [{ session: 2, mode: 'deload' }]);
  assert.equal(last.days[2].climb, 'hard', 'hard wins on a day with two entries');
  assert.equal(last.days[4].future, true);
  // nothing recent → anchored on the last activity
  assert.equal(calendarWeeks(sessions, [], '2027-06-01').anchored, true);
});

test('target hit rate: weekly, last 4 weeks, day after a hard climb vs other days', () => {
  const sessions = [];
  // 10 normal lifts on days after a hard climb (4 hit), 10 on other days (9 hit)
  for (let i = 0; i < 10; i++) {
    const d = String(1 + i * 2).padStart(2, '0'), o = String(2 + i * 2).padStart(2, '0');
    sessions.push(session(`2026-10-${d}`, 1, { 's1-deadlift': withTarget(i < 4 ? done(185, 7) : partial(185, 6), T) }));
    sessions.push(session(`2026-10-${o}`, 1, { 's1-deadlift': withTarget(i < 9 ? done(185, 7) : partial(185, 6), T) }));
  }
  const climbs = Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-30`.replace('09-30', i === 0 ? '09-30' : `10-${String(i * 2).padStart(2, '0')}`), intensity: 'hard' }));
  // maintain / deload lifts and lifts without a target don't count
  sessions.push({ ...session('2026-10-21', 1, { 's1-deadlift': withTarget(partial(185, 5), T) }), maintain: true });
  sessions.push(session('2026-10-21', 2, { 's2-rows': done(35, 8) }));
  const r = targetHitRate(sessions, climbs, '2026-10-22');
  assert.equal(r.total, 20);
  assert.deepEqual(r.afterHard, { hit: 4, total: 10 });
  assert.deepEqual(r.otherDays, { hit: 9, total: 10 });
  assert.equal(pct(r.afterHard), 40);
  assert.equal(r.weeks.length, 8);
  assert.equal(r.weeks.reduce((n, w) => n + w.total, 0), 20);
  assert.equal(pct({ hit: 0, total: 0 }), null);
});

test('progress: best set, PRs, last progressed, status', () => {
  const s = (date, entry) => session(date, 1, { 's1-deadlift': entry });
  const sets = (w, ...reps) => ({ ...done(w, Math.min(...reps)), sets: reps.map(r => ({ weight: w, reps: r })) });
  const log = [
    s('2026-09-01', sets(185, 6, 6)),
    s('2026-09-05', sets(185, 7, 6)),          // +1 rep: progress, but not a PR (needs +2 or the top of the range)
    s('2026-09-09', sets(190, 5, 5)),          // heaviest
    s('2026-09-13', sets(190, 5, 5)),
    { ...s('2026-09-17', sets(170, 5)), deload: true },   // ignored
    s('2026-09-21', sets(190, 5, 5)),
    s('2026-09-25', sets(190, 5, 5)),
    s('2026-09-29', sets(190, 5, 5)),
  ];
  const { lifts, prs } = liftProgress(log, '2026-10-01');
  const dl = lifts.find(l => l.name === 'Deadlift');
  assert.deepEqual(dl.best, { weight: 190, reps: 5, date: '2026-09-09' });
  assert.equal(dl.lastProgress, '2026-09-09');
  assert.equal(dl.sinceProgress, 4);
  assert.equal(dl.status, 'stalled');
  assert.deepEqual(prs.filter(p => p.name === 'Deadlift').map(p => [p.date, p.kind]), [['2026-09-09', 'weight']]);
  // maintain sessions don't count against you
  const maintained = log.map((x, i) => (i >= 5 ? { ...x, maintain: true } : x));
  assert.equal(liftProgress(maintained, '2026-10-01').lifts.find(l => l.name === 'Deadlift').status, 'holding');
  // not done in 3+ weeks → idle; one session → new
  assert.equal(liftProgress(log, '2026-11-01').lifts.find(l => l.name === 'Deadlift').status, 'idle');
  assert.equal(liftProgress([log[0]], '2026-09-02').lifts.find(l => l.name === 'Deadlift').status, 'new');
  // bodyweight lift: reps PRs
  const bw = [session('2026-09-01', 2, { 's2-legraiser': done(null, 8) }), session('2026-09-05', 2, { 's2-legraiser': done(null, 10) })];
  const r = liftProgress(bw, '2026-09-06');
  assert.equal(r.lifts.find(l => l.name === 'Hanging Leg Raises').status, 'progressing');
  assert.deepEqual(r.prs.map(p => p.text), ['rep PR: 10 reps']);
  const top = [...bw, session('2026-09-09', 2, { 's2-legraiser': done(null, 12) })];
  assert.equal(liftProgress(top, '2026-09-10').lifts.find(l => l.name === 'Hanging Leg Raises').status, 'top');
});

test('progress: est. strength trend, start → now, sparkline, recent PRs, attention order', () => {
  const s = (date, n, id, entry) => session(date, n, { [id]: entry });
  const log = [
    s('2026-07-01', 1, 's1-deadlift', done(175, 5)),
    s('2026-08-20', 1, 's1-deadlift', done(185, 5)),   // baseline: last one on or before Aug 27 (8 weeks before Oct 22)
    s('2026-09-10', 1, 's1-deadlift', done(185, 8)),   // top of range → rep PR
    s('2026-10-15', 1, 's1-deadlift', done(195, 6)),   // heaviest
    s('2026-07-01', 2, 's2-legraiser', done(null, 8)),
    s('2026-10-20', 2, 's2-legraiser', done(null, 9)),
    ...[1, 5, 9, 13, 17].map(d => s(`2026-10-${String(d).padStart(2, '0')}`, 2, 's2-rows', done(40, 8))),
  ];
  const { lifts, prs, recentPrs } = liftProgress(log, '2026-10-22');
  const dl = lifts.find(l => l.name === 'Deadlift');
  assert.equal(dl.strength, 234);                                   // 195 × (1 + 6/30)
  assert.deepEqual([dl.trend.metric, dl.trend.pct, dl.trend.since, dl.trend.weeks], ['e1rm', 8, '2026-08-20', 8]);   // 216 → 234
  assert.deepEqual(dl.startNow, { from: 175, to: 195, since: '2026-07-01' });
  assert.deepEqual(dl.spark, [204, 216, 234.5, 234]);
  assert.deepEqual(dl.workouts, [1]);
  assert.deepEqual(prs.filter(p => p.name === 'Deadlift').map(p => p.kind), ['weight', 'reps', 'weight']);
  assert.deepEqual(recentPrs.map(p => [p.name, p.date]), [['Deadlift', '2026-10-15']]);   // older ones aren't "recent"
  const lr = lifts.find(l => l.name === 'Hanging Leg Raises');
  assert.deepEqual([lr.trend.metric, lr.trend.delta, lr.trend.short], ['reps', 1, false]);
  assert.ok(!prs.some(p => p.name === 'Hanging Leg Raises'));       // +1 rep isn't a PR
  // stalled lifts come first
  assert.equal(lifts[0].name, 'Bent Over Rows');
  assert.equal(lifts[0].status, 'stalled');
});

test('pick one: how often crunches vs ab wheel vs both', () => {
  const log = [
    session('2026-10-01', 3, { 's3-crunches': done(45, 12) }),
    session('2026-10-05', 3, { 's3-abwheel': done(null, 8) }),
    session('2026-10-08', 3, { 's3-crunches': done(45, 12), 's3-abwheel': done(null, 8) }),
    session('2026-10-12', 3, { 's3-incline': done(50, 8) }),          // no abs: left out
    session('2026-10-13', 1, { 's1-crunches': done(45, 12) }),        // Workout A: left out
  ];
  assert.deepEqual(pickOneUsage(log, 'core'), { names: ['Cable Crunches', 'Ab Wheel'], counts: { 'Cable Crunches': 1, 'Ab Wheel': 1 }, both: 1, total: 3, session: 3 });
  assert.equal(pickOneUsage([], 'core'), null);
});
