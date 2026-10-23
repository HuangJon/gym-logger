/** Deloads, ease-back targets, the saved workout in progress, settings and the rest timer clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findExercise } from '../../js/core/exercises.js';
import { computeTarget, lighterWeight, lastPerformance, performances, targetReason, deloadTarget } from '../../js/core/progress.js';
import { blockStart, stalledLifts, deloadAdvice, deloadFrequency, deloadWeekActive, startDeloadWeek, endDeloadWeek, snoozeDeload } from '../../js/core/deload.js';
import { buildSessionRecord } from '../../js/core/records.js';
import { setSessionDeload } from '../../js/core/log.js';
import { migrateLog } from '../../js/core/migrate.js';
import { addDays } from '../../js/core/dates.js';
import { createMemoryStorage } from '../../js/data/storage.js';
import { saveDraft, loadDraft, clearDraft } from '../../js/data/draft.js';
import { createSettings, DEFAULT_SETTINGS } from '../../js/data/settings.js';
import { formatClock } from '../../js/ui/rest-timer.js';
import { session, done, partial } from '../helpers.js';

const deadlift = findExercise('s1-deadlift');     // 5–8, +5
const incline = findExercise('s1-incline');       // 6–12, +5
const lateral = findExercise('s1-lateral');       // 8–15, +2.5
const legRaise = findExercise('s2-legraiser');    // bodyweight 8–12

test('lighterWeight: ~10% down to the lift step, never a huge cut on light weights', () => {
  assert.equal(lighterWeight(deadlift, 185, 0.9), 165);
  assert.equal(lighterWeight(incline, 50, 0.9), 45);
  // cable stack (plates 3, 7, 10, 13, 17 … 70 lb): plate by plate
  assert.equal(lighterWeight(lateral, 33, 0.9), 27);        // one plate down is within 20%
  assert.equal(lighterWeight(lateral, 7, 0.9), 7);          // 3 would be a 57% cut
  assert.equal(lighterWeight(lateral, 17, 0.9), 17);        // 13 is a 24% cut — 17 is nearer ~10% lighter
  assert.equal(lighterWeight(lateral, 15, 0.9), 13, 'off-plate weight: the plate under it');
  assert.equal(lighterWeight(deadlift, null, 0.9), null);
});

test('computeTarget: deload styles — fewer sets (default) or lighter', () => {
  const last = { ...done(185, 7), sets: [{ weight: 185, reps: 7 }, { weight: 185, reps: 7 }], date: '2026-10-01' };
  const opts = { date: '2026-10-03', deload: true };
  // default: same weight, half the sets, bottom of the range
  assert.deepEqual(computeTarget(deadlift, last, opts), { weight: 185, reps: 5, sets: 1, reason: 'deload', style: 'sets' });
  assert.match(targetReason(deadlift, computeTarget(deadlift, last, opts), last, 'lbs'), /deload — same weight, half the sets, bottom of the range/);
  // lighter: ~10% lighter, same sets
  const lighter = computeTarget(deadlift, last, { ...opts, deloadStyle: 'lighter' });
  assert.deepEqual(lighter, { weight: 165, reps: 5, sets: 2, reason: 'deload', style: 'lighter', lighter: true });
  assert.match(targetReason(deadlift, lighter, last, 'lbs'), /deload — ~10% lighter, bottom of the range/);
  // lighter, but too light to drop a step → fewer sets instead
  const bss = findExercise('s3-bss');
  const bssLast = { ...done(15, 8), date: '2026-10-01' };
  const fb = computeTarget(bss, bssLast, { ...opts, deloadStyle: 'lighter' });
  assert.deepEqual(fb, { weight: 15, reps: 5, sets: 2, reason: 'deload', style: 'sets', fallback: true }, '3 sets → 2');
  assert.match(targetReason(bss, fb, bssLast, 'lbs'), /half the sets.*too light to drop a step/);
  // bodyweight: half the sets either way
  for (const style of ['sets', 'lighter']) {
    const t = computeTarget(legRaise, { ...done(null, 10), date: '2026-10-01' }, { ...opts, deloadStyle: style });
    assert.equal(t.sets, 1); assert.equal(t.weight, null); assert.equal(t.reps, 8);
    assert.doesNotMatch(targetReason(legRaise, t, {}, 'lbs'), /same weight/);
  }
  // deload after a long break: from the eased weight, never heavier than a normal session would be
  const oldLast = { ...done(185, 7), date: '2026-05-01' };
  assert.equal(computeTarget(deadlift, oldLast, { date: '2026-10-03' }).weight, 165);
  const afterBreak = computeTarget(deadlift, oldLast, { date: '2026-10-03', deload: true });
  assert.deepEqual(afterBreak, { weight: 165, reps: 5, sets: 1, reason: 'deload', style: 'sets', afterBreak: true });
  assert.match(targetReason(deadlift, afterBreak, oldLast, 'lbs'), /eased weight after the break, half the sets/);
  assert.equal(computeTarget(deadlift, oldLast, { date: '2026-10-03', deload: true, deloadStyle: 'lighter' }).weight, 145);
  // 3 sets → 2 with fewer sets
  assert.equal(deloadTarget(deadlift, 185, 3).sets, 2);
});

test('computeTarget: ease back after more than 14 days off', () => {
  const last = { ...done(185, 8), date: '2026-09-01' };
  const eased = computeTarget(deadlift, last, { date: '2026-09-20' });
  assert.deepEqual(eased, { weight: 165, reps: 5, sets: 2, reason: 'ease', daysOff: 19, lighter: true });
  const bss = findExercise('s3-bss');   // 15 lbs, 5 lb steps: 10% lighter rounds back to 15
  const same = computeTarget(bss, { ...done(15, 8), date: '2026-09-01' }, { date: '2026-09-20' });
  assert.equal(same.weight, 15);
  assert.doesNotMatch(targetReason(bss, same, {}, 'lbs'), /lighter/);
  assert.match(targetReason(bss, same, {}, 'lbs'), /bottom of the range to ease back in/);
  assert.match(targetReason(deadlift, eased, last, 'lbs'), /19 days since last time — ~10% lighter/);
  // exactly 14 days → normal progression
  assert.equal(computeTarget(deadlift, last, { date: '2026-09-15' }).reason, 'bump');
  // a recent deload counts as doing the lift, so no ease-back right after a deload week
  assert.equal(computeTarget(deadlift, last, { date: '2026-09-20', lastActive: '2026-09-12' }).reason, 'bump');
  // first time ever is unaffected
  assert.equal(computeTarget(deadlift, null, { date: '2026-09-20' }).reason, 'first');
  // no date given → plain progression (older callers)
  assert.equal(computeTarget(deadlift, last).reason, 'bump');
});

test('deload sessions never move progression', () => {
  const sessions = [
    session('2026-10-01', 1, { 's1-deadlift': done(185, 7) }),
    session('2026-10-08', 1, { 's1-deadlift': done(165, 5) }, {}),
  ];
  sessions[1].deload = true;
  assert.equal(lastPerformance(sessions, deadlift, '2026-10-10').weight, 185);
  assert.equal(lastPerformance(sessions, deadlift, '2026-10-10', { includeDeload: true }).weight, 165);
  assert.equal(lastPerformance(sessions, deadlift, '2026-10-10', { includeDeload: true }).deload, true);
  assert.equal(performances(sessions, deadlift, '2026-10-10', { includeDeload: true }).length, 2);
  // the normal session after the deload picks up from 185 × 7 → 185 × 8
  const next = computeTarget(deadlift, lastPerformance(sessions, deadlift, '2026-10-10'), { date: '2026-10-10' });
  assert.deepEqual(next, { weight: 185, reps: 8, sets: 2, reason: 'more' });
});

/** Three sessions a week from `start` for `weeks` weeks, with optional entries. */
function block(start, weeks, entries = () => ({})) {
  const out = [];
  for (let w = 0; w < weeks; w++) for (const [d, n] of [[0, 1], [2, 2], [4, 3]]) {
    const date = addDays(start, w * 7 + d);
    out.push(session(date, n, entries(n, w)));
  }
  return out;
}

test('blockStart: resets after a break of 7+ days or a deload', () => {
  const early = block('2026-06-01', 3);                         // ends 2026-06-19
  const later = block('2026-07-06', 4);                         // 2+ week gap before it
  assert.equal(blockStart([...early, ...later], '2026-08-01'), '2026-07-06');
  assert.equal(blockStart(early, '2026-07-01'), null);          // on a break right now
  const withDeload = [...later];
  withDeload[5] = { ...withDeload[5], deload: true };            // deload on 2026-07-17
  assert.equal(blockStart(withDeload, '2026-08-01'), '2026-07-20');
  assert.equal(blockStart([], '2026-08-01'), null);
});

test('stalledLifts: missed target the last 2 times (deloads ignored)', () => {
  const sessions = [
    session('2026-09-01', 1, { 's1-deadlift': partial(185, 5), 's1-incline': done(50, 8) }),
    session('2026-09-03', 1, { 's1-deadlift': partial(185, 5), 's1-incline': partial(50, 8) }),
  ];
  assert.deepEqual(stalledLifts(sessions, '2026-09-05'), ['Deadlift']);
});

test('deloadAdvice: 6 weeks always, 4 weeks when 2+ lifts stall, quiet otherwise', () => {
  const today = '2026-08-01';
  const eightWeeks = block(addDays(today, -44), 7).filter(s => s.date <= today);   // 6 weeks
  const a = deloadAdvice(eightWeeks, today);
  assert.equal(a.suggest, true);
  assert.equal(a.weeks, 6);
  assert.match(a.why, /6 weeks of training/);

  const stall = (n, w) => (n === 1 && w >= 3 ? { 's1-deadlift': partial(185, 5), 's1-incline': partial(50, 6) } : {});
  const fourWeeks = block(addDays(today, -30), 5, stall).filter(s => s.date <= today);
  const b = deloadAdvice(fourWeeks, today);
  assert.equal(b.weeks, 4);
  assert.deepEqual(b.stalled.sort(), ['Deadlift', 'Incline DB Press']);
  assert.equal(b.suggest, true);
  assert.match(b.why, /Deadlift and Incline DB Press missed target their last 2 times|Incline DB Press and Deadlift missed/);

  const fourNoStall = block(addDays(today, -30), 5).filter(s => s.date <= today);
  assert.equal(deloadAdvice(fourNoStall, today).suggest, false);
  assert.equal(deloadAdvice(fourWeeks.slice(0, -4), addDays(today, -8)).suggest, false, 'stalling but only 3 weeks in');

  // snoozed, or a deload week running → no suggestion
  assert.equal(deloadAdvice(eightWeeks, today, snoozeDeload(today)).suggest, false);
  assert.equal(deloadAdvice(block(addDays(today, -44), 8), addDays(today, 7), snoozeDeload(today)).suggest, true);   // snooze over
  assert.equal(deloadAdvice(eightWeeks, today, startDeloadWeek(today)).suggest, false);
});

test('deload week: 7 days inclusive, can be ended', () => {
  const s = startDeloadWeek('2026-10-21');
  assert.equal(s.deloadUntil, '2026-10-27');
  assert.equal(deloadWeekActive(s, '2026-10-21'), true);
  assert.equal(deloadWeekActive(s, '2026-10-27'), true);
  assert.equal(deloadWeekActive(s, '2026-10-28'), false);
  assert.equal(deloadWeekActive({ ...s, ...endDeloadWeek() }, '2026-10-22'), false);
  assert.equal(deloadWeekActive({}, '2026-10-22'), false);
});

test('deload flag: saved on the record, toggled in history, kept through migration', () => {
  const rec = buildSessionRecord({ sessionNum: 1, date: '2026-10-21', scratch: {}, targetOf: () => null, deload: true, now: 5 });
  assert.equal(rec.deload, true);
  assert.equal('deload' in buildSessionRecord({ sessionNum: 1, date: '2026-10-21', scratch: {}, targetOf: () => null, now: 6 }), false);
  const off = setSessionDeload([rec], rec.id, false);
  assert.equal('deload' in off[0], false);
  assert.equal(rec.deload, true, 'input not mutated');
  assert.equal(setSessionDeload(off, rec.id, true)[0].deload, true);
  assert.equal(migrateLog({ schemaVersion: 3, sessions: [rec] }).sessions[0].deload, true);
});

test('draft: saves, reloads, cleans, and ignores anything unusable', () => {
  const storage = createMemoryStorage();
  const scratch = {
    's1-deadlift': { done: [{ weight: 185, reps: 6 }, { reps: -1 }, { weight: 'x', reps: 5 }], note: 'grip', targetOpen: true, current: 0, draft: { reps: 3 } },
    's1-lateral': { skipped: true, done: [] },
    's1-incline': { done: [], target: { weight: 55, reps: 6, sets: 3 } },
  };
  assert.equal(saveDraft(storage, { active: { sessionNum: 1, date: '2026-10-21', deload: true }, scratch, rest: { endsAt: 1000, exId: 's1-deadlift', total: 150 } }, 42), true);
  const back = loadDraft(storage);
  assert.equal(back.savedAt, 42);
  assert.deepEqual(back.active, { sessionNum: 1, date: '2026-10-21', mode: 'deload' }, 'older drafts with a deload flag still load');
  assert.deepEqual(back.scratch['s1-deadlift'], { done: [{ weight: 185, reps: 6 }, { reps: 5 }], note: 'grip' });
  assert.deepEqual(back.scratch['s1-lateral'], { done: [], skipped: true });
  assert.deepEqual(back.scratch['s1-incline'].target, { weight: 55, reps: 6, sets: 3 });
  assert.deepEqual(back.rest, { endsAt: 1000, exId: 's1-deadlift', total: 150 });

  clearDraft(storage);
  assert.equal(loadDraft(storage), null);
  for (const bad of [{ v: 2, active: { sessionNum: 1, date: '2026-10-21' }, scratch: {} },
    { v: 1, active: { sessionNum: 9, date: '2026-10-21' }, scratch: {} },
    { v: 1, active: { sessionNum: 1, date: 'yesterday' }, scratch: {} },
    'garbage', null]) {
    storage.write('draft', bad);
    assert.equal(loadDraft(storage), null, JSON.stringify(bad));
  }
  const full = { read: () => null, write: () => { throw new Error('full'); } };
  assert.equal(saveDraft(full, { active: { sessionNum: 1, date: '2026-10-21' }, scratch: {} }), false);
});

test('settings: defaults, merge, persist, survive bad data and failed saves', () => {
  const storage = createMemoryStorage({ settings: 'junk' });
  const s = createSettings(storage);
  assert.deepEqual(s.get(), DEFAULT_SETTINGS);
  s.update({ restTimer: true });
  assert.equal(createSettings(storage).get().restTimer, true);
  assert.equal(createSettings(storage).get().deloadUntil, null);
  const failing = createSettings({ read: () => null, write: () => { throw new Error('full'); } });
  assert.equal(failing.update({ restTimer: true }).restTimer, true);
});

test('formatClock', () => {
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(149.2), '2:30');
  assert.equal(formatClock(5), '0:05');
  assert.equal(formatClock(-3), '0:00');
});

test('deloadFrequency: warns on the 2nd separate deload stretch within 6 weeks', () => {
  const dl = (date, n = 1) => ({ ...session(date, n, {}), deload: true });
  const week = [dl('2026-09-01', 1), dl('2026-09-03', 2), dl('2026-09-05', 3)];
  assert.deepEqual(deloadFrequency(week, '2026-09-20', '2026-09-20'), { tooMany: true, stretches: 2, weeks: 6 });
  assert.equal(deloadFrequency(week, '2026-09-06', '2026-09-06').tooMany, false, 'same deload week');
  assert.equal(deloadFrequency(week, '2026-10-20', '2026-10-20').tooMany, false, 'first deload has left the window');
  assert.equal(deloadFrequency(week, '2026-09-20').stretches, 1, 'nothing planned');
});

test('units: switching a lift to kg converts targets and history to kg', async () => {
  const { setUnitChoices, unitOf, incrementOf, defaultWeightOf } = await import('../../js/core/exercises.js');
  const { convertWeight } = await import('../../js/core/numbers.js');
  const { liftSeries } = await import('../../js/core/trends.js');
  assert.equal(convertWeight(100, 'lbs', 'kg'), 45.36);
  assert.equal(convertWeight(100, 'lbs', 'kg', 2.5), 45);
  assert.equal(convertWeight(20, 'kg', 'lbs', 2.5), 45);
  assert.equal(convertWeight(1, 'kg', 'lbs', 5), 5, 'never below one step');
  assert.equal(convertWeight(null, 'kg', 'lbs'), null);
  assert.equal(convertWeight(10, 'kg', 'kg'), 10);

  const sessions = [session('2026-10-01', 1, { 's1-deadlift': done(185, 6) })];
  try {
    setUnitChoices({ Deadlift: 'kg', 'Incline DB Press': 'stone' });
    assert.equal(unitOf(deadlift), 'kg');
    assert.equal(unitOf(incline), 'lbs', 'unknown units ignored');
    assert.equal(incrementOf(deadlift), 2.5, 'program increment (5 lbs) not reused in kg');
    assert.equal(defaultWeightOf(deadlift), 85);
    const last = lastPerformance(sessions, deadlift, '2026-10-03');
    assert.equal(last.unit, 'kg');
    assert.equal(last.weight, 85);
    assert.deepEqual(computeTarget(deadlift, last), { weight: 85, reps: 7, sets: 2, reason: 'more' });
    const pt = liftSeries(sessions).find(s => s.name === 'Deadlift');
    assert.equal(pt.unit, 'kg');
    assert.equal(pt.points[0].weight, 85);
  } finally {
    setUnitChoices({});
  }
  assert.equal(unitOf(deadlift), 'lbs');
  assert.equal(lastPerformance(sessions, deadlift, '2026-10-03').weight, 185);
});

test('old rows count as Bent Over Rows', () => {
  const sessions = [session('2026-05-15', 2, { 's2-oldrows': done(35, 8) }, { program: 'old' })];
  const last = lastPerformance(sessions, findExercise('s2-rows'), '2026-05-20');
  assert.equal(last.weight, 35);
  assert.deepEqual(computeTarget(findExercise('s2-rows'), last), { weight: 35, reps: 9, sets: 2, reason: 'more' });
});

test('missedStreak: same target missed in a row (going lighter or hitting it ends the streak)', async () => {
  const { missedStreak } = await import('../../js/core/progress.js');
  const t = { weight: 185, reps: 7, sets: 2 };
  const miss = date => session(date, 1, { 's1-deadlift': { status: 'partial', weight: 185, unit: 'lbs', sets: [{ weight: 185, reps: 7 }, { weight: 185, reps: 5 }], target: t } });
  const sessions = [miss('2026-09-01'), miss('2026-09-08'), miss('2026-09-15')];
  assert.equal(missedStreak(sessions, deadlift, '2026-09-20'), 3);
  const hit = session('2026-09-05', 1, { 's1-deadlift': { ...done(185, 7), sets: [{ weight: 185, reps: 7 }, { weight: 185, reps: 7 }], target: t } });
  assert.equal(missedStreak([...sessions.slice(1), hit], deadlift, '2026-09-20'), 2);
  const lighter = session('2026-09-18', 1, { 's1-deadlift': { status: 'partial', weight: 165, unit: 'lbs', sets: [{ weight: 165, reps: 8 }], target: t } });
  assert.equal(missedStreak([...sessions, lighter], deadlift, '2026-09-20'), 0);
});

test('per-lift deload: saved on the entry, skipped by progression; opting out of a deload session counts', () => {
  const targetOf = ex => ({ weight: 100, reps: 5, sets: 1 });
  const scratch = {
    's1-deadlift': { done: [{ weight: 165, reps: 5 }], deload: true },
    's1-incline': { done: [{ weight: 50, reps: 8 }] },
  };
  const rec = buildSessionRecord({ sessionNum: 1, date: '2026-10-10', scratch, targetOf, now: 1 });
  assert.equal(rec.deload, undefined);
  assert.equal(rec.entries['s1-deadlift'].mode, 'deload');
  assert.equal('mode' in rec.entries['s1-incline'], false);
  const earlier = session('2026-10-01', 1, { 's1-deadlift': done(185, 7), 's1-incline': done(45, 8) });
  const migrated = migrateLog({ schemaVersion: 3, sessions: [earlier, rec] }).sessions;
  assert.equal(lastPerformance(migrated, deadlift, '2026-10-12').weight, 185, 'deloaded lift skipped');
  assert.equal(lastPerformance(migrated, incline, '2026-10-12').weight, 50, 'normal lift in the same session counts');

  // deload session, but deadlift kept normal
  const rec2 = buildSessionRecord({ sessionNum: 1, date: '2026-10-12', scratch: { 's1-deadlift': { done: [{ weight: 190, reps: 5 }], deload: false }, 's1-incline': { done: [{ weight: 45, reps: 6 }] } }, targetOf, deload: true, now: 2 });
  assert.equal(rec2.deload, true);
  assert.equal(rec2.entries['s1-deadlift'].mode, 'normal');
  const all = migrateLog({ schemaVersion: 3, sessions: [earlier, rec, rec2] }).sessions;
  assert.equal(lastPerformance(all, deadlift, '2026-10-14').weight, 190);
  assert.equal(lastPerformance(all, incline, '2026-10-14').weight, 50);
});

test('climbs: add, remove, recent hard days, the day-before nudge', async () => {
  const { addClimb, removeClimb, climbsOn, hardClimbsRecent, recentHardClimb, setClimbDay } = await import('../../js/core/climbs.js');
  let climbs = addClimb([], { date: '2026-10-20', intensity: 'hard', now: 1 });
  climbs = addClimb(climbs, { date: '2026-10-21', intensity: 'whatever', now: 2 });
  assert.deepEqual(climbs.map(c => [c.date, c.intensity]), [['2026-10-20', 'hard'], ['2026-10-21', 'easy']]);
  assert.equal(climbsOn(climbs, '2026-10-21').length, 1);
  assert.equal(recentHardClimb(climbs, '2026-10-21').date, '2026-10-20');
  assert.equal(recentHardClimb(climbs, '2026-10-20'), null, 'same-day climbing comes after lifting');
  assert.equal(recentHardClimb(climbs, '2026-10-22').date, '2026-10-20', '2 days ago still counts (~48 h recovery)');
  assert.equal(recentHardClimb(climbs, '2026-10-23'), null);
  // one climbing day per date: switch easy ↔ hard, clear
  let day = setClimbDay([], '2026-10-22', 'easy', 5);
  const id = day[0].id;
  day = setClimbDay(day, '2026-10-22', 'hard', 6);
  assert.deepEqual(day.map(c => [c.id, c.intensity]), [[id, 'hard']], 'same entry, switched');
  assert.deepEqual(setClimbDay(day, '2026-10-22', null), []);
  assert.equal(setClimbDay([...climbs, ...day], '2026-10-22', null).length, 2, 'other days untouched');
  const many = ['2026-10-01', '2026-10-05', '2026-10-09', '2026-10-09', '2026-10-12'].map((date, i) => ({ id: `c${i}`, date, intensity: 'hard' }));
  assert.equal(hardClimbsRecent(many, '2026-10-14'), 4, 'one per day; 14-day window');
  assert.equal(removeClimb(climbs, climbs[0].id).length, 1);
});

test('deloadAdvice: lots of hard climbing brings the suggestion a week earlier', () => {
  const today = '2026-08-01';
  const fiveWeeks = block(addDays(today, -37), 6).filter(s => s.date <= today);
  assert.equal(deloadAdvice(fiveWeeks, today).suggest, false);
  const hard = ['2026-07-20', '2026-07-23', '2026-07-27', '2026-07-30'].map((date, i) => ({ id: `c${i}`, date, intensity: 'hard' }));
  const a = deloadAdvice(fiveWeeks, today, {}, hard);
  assert.equal(a.suggest, true);
  assert.match(a.why, /4 hard climbing days in the last 2 weeks/);
});

test('repository: climbing days are saved, snapshotted and restored with the log', async () => {
  const { createRepository } = await import('../../js/data/repository.js');
  const storage = createMemoryStorage();
  const repo = createRepository(storage);
  repo.load();
  const s = session('2026-10-21', 1, { 's1-incline': done(50, 8) }, { id: 'a' });
  await repo.commit([s]);
  await repo.commitClimbs([{ id: 'c1', date: '2026-10-20', intensity: 'hard', ts: 1 }]);
  assert.equal(repo.sessions.length, 1, 'sessions untouched');
  assert.equal(storage.dump().log.climbs.length, 1);
  await repo.commitClimbs([]);
  assert.equal(repo.snapshots()[0].climbs, 1);
  await repo.restoreSnapshot(0);
  assert.equal(repo.climbs.length, 1);
  const reloaded = createRepository(storage); reloaded.load();
  assert.equal(reloaded.climbs[0].id, 'c1');
  // a v3 log upgrades to v4 with no climbs, original kept aside
  const old = createMemoryStorage({ log: { schemaVersion: 3, sessions: [s] } });
  const r3 = createRepository(old); r3.load();
  assert.deepEqual(r3.climbs, []);
  assert.equal(old.dump()['pre-upgrade-v3'].schemaVersion, 3);
  assert.equal(old.dump().log.schemaVersion, 5);
});

test('last note, shorter rest for circuits', async () => {
  const { lastNote } = await import('../../js/core/progress.js');
  const { restOf } = await import('../../js/core/exercises.js');
  const sessions = [
    session('2026-10-01', 1, { 's1-deadlift': { ...done(185, 6), note: 'old note' } }),
    session('2026-10-08', 1, { 's1-deadlift': { status: 'skip', note: 'back tight' } }),
  ];
  assert.deepEqual(lastNote(sessions, deadlift, '2026-10-10'), { note: 'back tight', date: '2026-10-08' });
  sessions.push(session('2026-10-09', 1, { 's1-deadlift': done(185, 7) }));
  assert.equal(lastNote(sessions, deadlift, '2026-10-10'), null, 'older notes do not resurface');
  assert.equal(lastNote(sessions, deadlift, '2026-10-09').note, 'back tight', "today's own session isn't 'last time'");
  assert.equal(restOf(lateral), 45);
  assert.equal(restOf(deadlift), 90);
  assert.equal(restOf(incline), 90);
  assert.equal(restOf(findExercise('s3-abwheel')), 45);
});

test('modes: maintain targets last time, counts as done, and the next session asks for more', async () => {
  const { MODE, entryMode, sessionMode } = await import('../../js/core/records.js');
  const { setSessionMode } = await import('../../js/core/log.js');
  const last = { ...done(185, 6), sets: [{ weight: 185, reps: 7 }, { weight: 185, reps: 6 }], date: '2026-10-01', target: { weight: 185, reps: 7, sets: 2 } };
  const m = computeTarget(deadlift, last, { date: '2026-10-03', maintain: true });
  assert.deepEqual(m, { weight: 185, reps: 6, sets: 2, reason: 'maintain' });
  assert.match(targetReason(deadlift, m, last, 'lbs'), /maintain — same as last time/);
  assert.equal(computeTarget(deadlift, null, { date: '2026-10-03', maintain: true }).reason, 'first');
  assert.equal(computeTarget(deadlift, { ...last, date: '2026-08-01' }, { date: '2026-10-03', maintain: true }).reason, 'ease', 'after a long break, easing wins');
  // hitting the maintain target is complete, not a miss
  const rec = buildSessionRecord({ sessionNum: 1, date: '2026-10-03', scratch: { 's1-deadlift': { done: [{ weight: 185, reps: 6 }, { weight: 185, reps: 6 }] } }, targetOf: () => m, mode: MODE.MAINTAIN, now: 7 });
  assert.equal(rec.maintain, true);
  assert.equal(rec.entries['s1-deadlift'].status, 'complete');
  assert.equal(sessionMode(rec), MODE.MAINTAIN);
  // maintain counts for progression: next normal session → one more rep
  const next = computeTarget(deadlift, lastPerformance([rec], deadlift, '2026-10-05'), { date: '2026-10-05' });
  assert.deepEqual(next, { weight: 185, reps: 7, sets: 2, reason: 'more' });
  // per-lift maintain in a normal session; legacy entry.deload booleans still read
  const one = buildSessionRecord({ sessionNum: 1, date: '2026-10-03', scratch: { 's1-deadlift': { done: [{ weight: 185, reps: 6 }], mode: 'maintain' } }, targetOf: () => m, now: 8 });
  assert.equal(one.entries['s1-deadlift'].mode, 'maintain');
  assert.equal(entryMode(one, one.entries['s1-deadlift']), 'maintain');
  assert.equal(entryMode({ deload: true }, { deload: false }), 'normal');
  assert.equal(entryMode({}, { deload: true }), 'deload');
  // History: switch a session's mode
  const switched = setSessionMode([rec], rec.id, MODE.DELOAD)[0];
  assert.equal(switched.deload, true); assert.equal('maintain' in switched, false);
  assert.equal(Object.keys(setSessionMode([switched], rec.id, MODE.NORMAL)[0]).filter(k => k === 'deload' || k === 'maintain').length, 0);
});

test('deload: only 1 set to begin with → ~10% lighter instead', () => {
  assert.deepEqual(deloadTarget(deadlift, 185, 1), { weight: 165, reps: 5, sets: 1, reason: 'deload', style: 'lighter', lighter: true, fallback: true });
  assert.match(targetReason(deadlift, deloadTarget(deadlift, 185, 1), {}, 'lbs'), /only 1 set to begin with/);
  assert.deepEqual(deloadTarget(legRaise, null, 1), { weight: null, reps: 8, sets: 1, reason: 'deload', style: 'sets' }, 'bodyweight, 1 set: bottom of the range is all that is left');
});

test('maintain often: a fatigue signal that suggests a deload', async () => {
  const { maintainCount, maintainOften } = await import('../../js/core/deload.js');
  const m = (date) => ({ ...session(date, 1, { 's1-deadlift': done(185, 6) }), maintain: true });
  const today = '2026-10-28';
  const sessions = [session('2026-10-01', 1, {}), m('2026-10-05'), m('2026-10-12'), m('2026-10-19')];
  assert.equal(maintainCount(sessions, today), 3);
  assert.equal(maintainOften(sessions, today), false);
  assert.equal(maintainOften(sessions, today, today), true, 'picking a 4th → warn');
  const four = [...sessions, m('2026-10-26')];
  const adv = deloadAdvice(four, today);
  assert.equal(adv.suggest, true);
  assert.match(adv.why, /4 maintain sessions in the last 4 weeks/);
  // a deload resets the count
  const afterDeload = [...four, { ...session('2026-10-27', 2, {}), deload: true }];
  assert.equal(maintainCount(afterDeload, today), 0);
  // older than 4 weeks doesn't count
  assert.equal(maintainCount(four, '2026-11-20'), 1);
});

test('a session counts as a maintain / deload day by share of the lifts you did', async () => {
  const { effectiveSessionMode } = await import('../../js/core/records.js');
  const { maintainCount, deloadFrequency } = await import('../../js/core/deload.js');
  const lifts = (modes, extra = {}) => ({ ...session('2026-10-20', 1, Object.fromEntries(
    ['s1-incline', 's1-deadlift', 's1-lateral', 's1-crunches', 's1-pulldown'].map((id, i) => [id, { ...done(50, 8), ...(modes[i] ? { mode: modes[i] } : {}) }]))), ...extra });
  assert.equal(effectiveSessionMode(lifts([])), 'normal');
  assert.equal(effectiveSessionMode(lifts(['maintain', 'maintain', 'maintain'])), 'maintain', '3 of 5 lifts on Maintain, session left on Normal');
  assert.equal(effectiveSessionMode(lifts(['maintain', 'maintain'])), 'normal', '2 of 5 is not more than half');
  assert.equal(effectiveSessionMode(lifts([null, null, null, 'normal', 'normal'], { maintain: true })), 'maintain', 'session Maintain, 2 lifts kept normal');
  assert.equal(effectiveSessionMode(lifts(['normal', 'normal', 'normal'], { maintain: true })), 'normal', 'session Maintain but most lifts were normal');
  assert.equal(effectiveSessionMode(lifts(['deload', 'deload', 'deload'])), 'deload');
  assert.equal(effectiveSessionMode({ ...session('2026-10-20', 1, {}), deload: true }), 'deload', 'nothing done → the session mode');
  // lift-by-lift maintain days count toward the fatigue signal; so do lift-by-lift deload days
  const day = (date, modes) => ({ ...lifts(modes), id: date, date });
  const sessions = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map(d => day(d, ['maintain', 'maintain', 'maintain']));
  assert.equal(maintainCount(sessions, '2026-10-28'), 4);
  const deloads = [day('2026-10-01', ['deload', 'deload', 'deload']), day('2026-10-20', ['deload', 'deload', 'deload'])];
  assert.equal(deloadFrequency(deloads, '2026-10-28').stretches, 2);
});

test('one lift eased off 3 sessions in a row → a note (whole-session easy days are passed over)', async () => {
  const { liftEasedStreak } = await import('../../js/core/progress.js');
  const s = (date, entries, extra = {}) => ({ ...session(date, 1, entries), id: date, ...extra });
  const others = { 's1-incline': done(50, 8), 's1-lateral': done(7, 10), 's1-crunches': done(45, 10) };
  const easedDl = mode => ({ ...others, 's1-deadlift': { ...done(185, 6), mode } });
  const log = [s('2026-10-01', easedDl('maintain')), s('2026-10-05', easedDl('deload')), s('2026-10-09', easedDl('maintain'))];
  assert.equal(liftEasedStreak(log, deadlift, '2026-10-12'), 3);
  assert.equal(liftEasedStreak(log, incline, '2026-10-12'), 0);
  // a whole deload week in between doesn't count, and doesn't break the streak
  const week = s('2026-10-07', { ...others, 's1-deadlift': done(185, 5) }, { deload: true });
  assert.equal(liftEasedStreak([...log, week], deadlift, '2026-10-12'), 3);
  // a normal session breaks it
  assert.equal(liftEasedStreak([...log, s('2026-10-10', { ...others, 's1-deadlift': done(185, 7) })], deadlift, '2026-10-12'), 0);
});
