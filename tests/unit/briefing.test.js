/** "Before you start": last time, climbing since, tips that apply. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionBriefing } from '../../js/core/briefing.js';
import { session, done, partial } from '../helpers.js';

const T = (w, r) => ({ weight: w, reps: r, sets: 2 });
const withT = (e, t) => ({ ...e, target: t });

test('briefing: last time this workout + how it went + climbing since', () => {
  const sessions = [
    session('2026-10-14', 1, { 's1-incline': withT(done(50, 8), T(50, 8)), 's1-deadlift': withT(partial(185, 6), T(185, 7)), 's1-lateral': withT(done(7.5, 10), T(7.5, 10)) }),
    session('2026-10-16', 2, { 's2-rows': done(35, 8) }),
  ];
  const climbs = [{ date: '2026-10-15', intensity: 'hard' }, { date: '2026-10-18', intensity: 'easy' }, { date: '2026-10-10', intensity: 'hard' }];
  const b = sessionBriefing({ sessions, climbs, sessionNum: 1, date: '2026-10-21' });
  assert.deepEqual(b.last, { date: '2026-10-14', hit: 2, total: 3, short: ['Deadlift'] });
  assert.deepEqual(b.climbs, { hard: 1, easy: 1 });
  assert.equal(b.tips.length, 0, 'nothing worth flagging');
  assert.equal(b.label, 'Workout A');
});

test('briefing tips: hard climb names the climbing-heavy lifts — or says go ahead when there are none', () => {
  const climbs = [{ date: '2026-10-20', intensity: 'hard' }];
  const a = sessionBriefing({ sessions: [], climbs, sessionNum: 1, date: '2026-10-21' });
  assert.match(a.tips[0], /Hard climb yesterday — Deadlift and Single Arm Cable Pulldown lean on/);
  const b = sessionBriefing({ sessions: [], climbs, sessionNum: 2, date: '2026-10-22' });
  assert.match(b.tips[0], /Hard climb 2 days ago .* Bent Over Rows and Hanging Leg Raises/);
  const c = sessionBriefing({ sessions: [], climbs, sessionNum: 3, date: '2026-10-21' });
  assert.match(c.tips[0], /don't lean much on your climbing muscles/);
  assert.equal(sessionBriefing({ sessions: [], climbs, sessionNum: 1, date: '2026-10-20' }).tips.length, 0, 'same day = after lifting');
  assert.equal(sessionBriefing({ sessions: [], climbs, sessionNum: 1, date: '2026-10-24' }).tips.length, 0, 'recovered');
});

test('briefing tips: rough last session; long gap', () => {
  const rough = [session('2026-10-14', 1, { 's1-incline': withT(partial(50, 6), T(50, 8)), 's1-deadlift': withT(partial(185, 6), T(185, 7)), 's1-lateral': withT(done(7.5, 10), T(7.5, 10)) })];
  assert.match(sessionBriefing({ sessions: rough, climbs: [], sessionNum: 1, date: '2026-10-17' }).tips[0], /2 of 3 lifts fell short — .*Maintain/);
  const gap = sessionBriefing({ sessions: rough, climbs: [], sessionNum: 2, date: '2026-11-10' });
  assert.equal(gap.last, null);
  assert.match(gap.tips[0], /27 days since you last lifted/);
});
