/** Deloads, ease-back targets, the saved workout in progress, settings and the rest timer clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findExercise } from '../../js/core/exercises.js';
import { computeTarget, lighterWeight, lastPerformance, performances, targetReason } from '../../js/core/progress.js';
import { blockStart, stalledLifts, deloadAdvice, deloadWeekActive, startDeloadWeek, endDeloadWeek, snoozeDeload } from '../../js/core/deload.js';
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
const lateral = findExercise('s1-lateral');       // 12–15, +2.5
const legRaise = findExercise('s2-legraiser');    // bodyweight 8–12

test('lighterWeight: ~10% down to the lift step, never a huge cut on light weights', () => {
  assert.equal(lighterWeight(deadlift, 185, 0.9), 165);
  assert.equal(lighterWeight(incline, 50, 0.9), 45);
  assert.equal(lighterWeight(lateral, 15, 0.9), 12.5);
  assert.equal(lighterWeight(lateral, 5, 0.9), 5);          // 2.5 would be a 50% cut
  assert.equal(lighterWeight(lateral, 12.5, 0.9), 10);
  assert.equal(lighterWeight(deadlift, null, 0.9), null);
});

test('computeTarget: deload = ~10% lighter, bottom of range, half the sets', () => {
  const last = { ...done(185, 7), sets: [{ weight: 185, reps: 7 }, { weight: 185, reps: 7 }], date: '2026-10-01' };
  assert.deepEqual(computeTarget(deadlift, last, { date: '2026-10-03', deload: true }), { weight: 165, reps: 5, sets: 1, reason: 'deload' });
  assert.deepEqual(computeTarget(legRaise, { ...done(null, 10), date: '2026-10-01' }, { date: '2026-10-03', deload: true }), { weight: null, reps: 8, sets: 1, reason: 'deload' });
  assert.match(targetReason(deadlift, { reason: 'deload' }, last, 'lbs'), /deload — ~10% lighter, half the sets/);
});

test('computeTarget: ease back after more than 14 days off', () => {
  const last = { ...done(185, 8), date: '2026-09-01' };
  const eased = computeTarget(deadlift, last, { date: '2026-09-20' });
  assert.deepEqual(eased, { weight: 165, reps: 5, sets: 2, reason: 'ease', daysOff: 19 });
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
  assert.deepEqual(back.active, { sessionNum: 1, date: '2026-10-21', deload: true });
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
