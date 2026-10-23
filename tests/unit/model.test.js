import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExercise, sessionExercises, exercisesForSession, unitOf, incrementOf, repRangeText, allExercises } from '../../js/core/exercises.js';
import { normalizeEntry, buildSessionRecord, statusCounts, byNewest, meetsTarget, setsOfEntry, summarizeSets, formatSets } from '../../js/core/records.js';
import { addSession, updateEntry, setSessionDate, deleteSession, mergeSessions } from '../../js/core/log.js';
import { migrateLog, SCHEMA_VERSION } from '../../js/core/migrate.js';
import { SESSIONS, RETIRED } from '../../js/config/program.js';
import { session, done, skipped } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// ── program / exercises ──
test('program: every exercise id is unique and has a rep range', () => {
  const ids = allExercises().map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const ex of allExercises()) assert.ok(Array.isArray(ex.reps) && ex.reps[0] <= ex.reps[1], ex.id);
});

test('program: exercise ids start with their session number', () => {
  for (const [n, list] of Object.entries(SESSIONS)) for (const ex of list) assert.ok(ex.id.startsWith(`s${n}-`), ex.id);
});

test('findExercise covers current and retired exercises', () => {
  assert.equal(findExercise('s1-incline').name, 'Incline DB Press');
  assert.equal(findExercise('s2-dips').retired, true);
  assert.equal(findExercise('nope'), null);
});

test('sessionExercises / unitOf / incrementOf / repRangeText', () => {
  assert.equal(sessionExercises(1).length, SESSIONS[1].length);
  assert.equal(unitOf(findExercise('s1-crunches')), 'kg');
  assert.equal(unitOf(findExercise('s1-incline')), 'lbs');
  assert.equal(incrementOf(findExercise('s1-deadlift')), 5);
  assert.equal(incrementOf(findExercise('s3-pulldown')), 2.5);   // default
  assert.equal(repRangeText([6, 12]), '6–12');
  assert.equal(repRangeText([5, 5]), '5');
});

test('exercisesForSession: current sessions show the program plus anything extra logged', () => {
  const s = session('2026-10-01', 2, { 's2-rows': done(40, 8), 's2-dips': done(null, 8) });
  const ids = exercisesForSession(s).map(e => e.id);
  assert.deepEqual(ids.slice(0, SESSIONS[2].length), SESSIONS[2].map(e => e.id));
  assert.equal(ids.at(-1), 's2-dips');
});

test('exercisesForSession: old-program sessions show only what was logged, in program order', () => {
  const s = session('2026-05-01', 2, { 's2-pallof': done(27, 5), 's2-dips': done(null, 8), 's2-lateral': done(7, 7) }, { program: 'old' });
  assert.deepEqual(exercisesForSession(s).map(e => e.id), ['s2-lateral', 's2-pallof', 's2-dips']);
});

// ── records ──
test('normalizeEntry upgrades early shapes and drops junk', () => {
  assert.deepEqual(normalizeEntry({ skipped: true, note: 'tired', weight: 5 }), { status: 'skip', note: 'tired' });
  assert.deepEqual(normalizeEntry({ unrecorded: true }), { status: 'unrecorded', note: '' });
  assert.deepEqual(normalizeEntry({ weight: 185, unit: 'lbs', reps: '' }), { status: 'complete', note: '', weight: 185, unit: 'lbs' });
  assert.deepEqual(normalizeEntry({ status: 'partial', weight: '50', reps: '6', unit: 'kg' }), { status: 'partial', note: '', weight: 50, unit: 'kg', reps: 6 });
  assert.deepEqual(normalizeEntry(null), { status: 'unrecorded', note: '' });
});

test('normalizeEntry keeps sets (weight × reps), the target, and fields it does not know', () => {
  const e = normalizeEntry({ status: 'partial', unit: 'lbs', sets: [{ weight: 50, reps: 9 }, { weight: 45, reps: 8 }], target: { weight: 50, reps: 9, sets: 3 }, rpe: 8 });
  assert.deepEqual(e, { rpe: 8, status: 'partial', note: '', sets: [{ weight: 50, reps: 9 }, { weight: 45, reps: 8 }], weight: 50, unit: 'lbs', reps: 8, target: { reps: 9, sets: 3, weight: 50 } });
  // bare rep numbers take the entry's weight; zero-rep sets are dropped
  assert.deepEqual(normalizeEntry({ weight: 50, unit: 'lbs', sets: [9, 0, 8] }).sets, [{ weight: 50, reps: 9 }, { weight: 50, reps: 8 }]);
  assert.deepEqual(normalizeEntry({ status: 'skip', sets: [{ reps: 5 }], target: { reps: 5, sets: 2 } }), { status: 'skip', note: '', target: { reps: 5, sets: 2 } });
});

test('setsOfEntry / summarizeSets / formatSets', () => {
  assert.deepEqual(setsOfEntry({ sets: [{ weight: 50, reps: 9 }] }, 2), [{ weight: 50, reps: 9 }]);
  assert.deepEqual(setsOfEntry({ weight: 50, reps: 8 }, 2), [{ weight: 50, reps: 8 }, { weight: 50, reps: 8 }]);   // older logs
  assert.deepEqual(setsOfEntry({ reps: 8 }, 1), [{ reps: 8 }]);
  assert.deepEqual(setsOfEntry({}, 2), []);
  assert.deepEqual(summarizeSets([{ weight: 50, reps: 9 }, { weight: 45, reps: 10 }]), { weight: 50, reps: 9 });
  assert.equal(formatSets([{ weight: 50, reps: 6 }, { weight: 50, reps: 5 }], 'lbs'), '50 lbs × 6, 5');
  assert.equal(formatSets([{ weight: 50, reps: 6 }, { weight: 45, reps: 8 }]), '50×6, 45×8');
  assert.equal(formatSets([{ reps: 8 }, { reps: 9 }]), '8, 9 reps');
  assert.equal(formatSets([]), '');
});

test('meetsTarget: enough sets, each at least the target weight and reps', () => {
  const t = { weight: 50, reps: 9, sets: 2 };
  assert.ok(meetsTarget([{ weight: 50, reps: 9 }, { weight: 50, reps: 9 }], t));
  assert.ok(meetsTarget([{ weight: 55, reps: 10 }, { weight: 50, reps: 9 }, { weight: 40, reps: 5 }], t));   // extra sets don't count against you
  assert.ok(!meetsTarget([{ weight: 50, reps: 9 }, { weight: 50, reps: 8 }], t));
  assert.ok(!meetsTarget([{ weight: 50, reps: 9 }, { weight: 45, reps: 9 }], t));
  assert.ok(!meetsTarget([{ weight: 50, reps: 9 }], t));
  assert.ok(meetsTarget([{ reps: 9 }, { reps: 9 }], { reps: 9, sets: 2 }));   // bodyweight
  assert.ok(meetsTarget([], null));
});

test('buildSessionRecord: only logged sets count; complete/partial from the target', () => {
  const targets = { 's1-incline': { weight: 50, reps: 9, sets: 2 }, 's1-deadlift': { weight: 185, reps: 6, sets: 2 },
                    's1-lateral': { weight: 7.5, reps: 12, sets: 2 }, 's1-crunches': { weight: 55, reps: 11, sets: 2 }, };
  const pulldownTarget = { weight: null, reps: 8, sets: 2 };
  const rec = buildSessionRecord({
    sessionNum: 1, date: '2026-10-21', now: 123, targetOf: ex => targets[ex.id],
    scratch: {
      's1-incline': { done: [{ weight: 50, reps: 9 }, { weight: 50, reps: 9 }], note: ' felt solid ' },
      's1-deadlift': { done: [{ weight: 185, reps: 6 }] },                        // one of two sets → partial
      's1-lateral': { skipped: true, done: [{ weight: 7.5, reps: 12 }] },         // skip drops sets
      's1-crunches': { note: 'cable busy' },                                      // nothing logged
    },
  });
  assert.equal(rec.id, '123');
  assert.deepEqual(rec.entries['s1-incline'], { status: 'complete', note: 'felt solid', sets: [{ weight: 50, reps: 9 }, { weight: 50, reps: 9 }], weight: 50, unit: 'lbs', reps: 9, target: { reps: 9, sets: 2, weight: 50 } });
  assert.deepEqual(rec.entries['s1-deadlift'], { status: 'partial', note: '', sets: [{ weight: 185, reps: 6 }], weight: 185, unit: 'lbs', reps: 6, target: { reps: 6, sets: 2, weight: 185 } });
  assert.deepEqual(rec.entries['s1-lateral'], { status: 'skip', note: '', target: { reps: 12, sets: 2, weight: 7.5 } });
  assert.deepEqual(rec.entries['s1-crunches'], { status: 'unrecorded', note: 'cable busy' });
  // a first-time lift with no weight target; unit from the program (pulldown is in kg, in Workout C now)
  const c = buildSessionRecord({ sessionNum: 3, date: '2026-10-21', now: 124, targetOf: ex => (ex.id === 's3-pulldown' ? pulldownTarget : null),
    scratch: { 's3-pulldown': { done: [{ weight: 45, reps: 8 }, { weight: 45, reps: 8 }] } } });
  assert.deepEqual(c.entries['s3-pulldown'], { status: 'complete', note: '', sets: [{ weight: 45, reps: 8 }, { weight: 45, reps: 8 }], weight: 45, unit: 'kg', reps: 8, target: { reps: 8, sets: 2 } });
  assert.equal('s1-pulldown' in rec.entries, false, 'pulldown is no longer in Workout A');
});

test('buildSessionRecord: drop sets, lighter weight, bodyweight', () => {
  const rec = buildSessionRecord({
    sessionNum: 1, date: '2026-10-21', now: 1, targetOf: () => ({ weight: 50, reps: 6, sets: 2 }),
    scratch: { 's1-incline': { done: [{ weight: 50, reps: 6 }, { weight: 45, reps: 8 }] } },
  });
  assert.equal(rec.entries['s1-incline'].status, 'partial');            // second set lighter than target
  assert.equal(rec.entries['s1-incline'].weight, 50);                   // summary = heaviest
  const bw = buildSessionRecord({ sessionNum: 2, date: '2026-10-21', now: 1, targetOf: () => ({ weight: null, reps: 9, sets: 2 }), scratch: { 's2-legraiser': { done: [{ weight: 99, reps: 9 }, { reps: 10 }] } } });
  assert.deepEqual(bw.entries['s2-legraiser'], { status: 'complete', note: '', sets: [{ reps: 9 }, { reps: 10 }], reps: 9, target: { reps: 9, sets: 2 } });
});

test('statusCounts and byNewest', () => {
  const s = session('2026-10-01', 1, { 's1-incline': done(50, 8), 's1-deadlift': skipped() });
  assert.deepEqual(statusCounts(s), { complete: 1, partial: 0, skip: 1, unrecorded: SESSIONS[1].length - 2 });
  const a = session('2026-10-01', 1, {}, { ts: 5 }), b = session('2026-10-02', 1, {}, { ts: 1 }), c = session('2026-10-02', 1, {}, { ts: 9 });
  assert.deepEqual([a, b, c].sort(byNewest).map(x => x.id), [c.id, b.id, a.id]);
});

// ── log operations ──
test('log operations never mutate their input', () => {
  const a = session('2026-10-01', 1, { 's1-incline': done(50, 8) }, { id: 'a' });
  const list = Object.freeze([Object.freeze(a)]);
  const added = addSession(list, session('2026-10-02', 1, {}, { id: 'b' }));
  assert.deepEqual(added.map(s => s.id), ['b', 'a']);
  const edited = updateEntry(list, 'a', 's1-incline', { status: 'partial', weight: 52.5, reps: 6 });
  assert.equal(edited[0].entries['s1-incline'].weight, 52.5);
  assert.equal(list[0].entries['s1-incline'].weight, 50);
  assert.equal(setSessionDate(list, 'a', '2026-03-01')[0].date, '2026-03-01');
  assert.throws(() => setSessionDate(list, 'a', 'bad'));
  assert.equal(deleteSession(list, 'a').length, 0);
});

test('mergeSessions replaces same ids and adds new ones', () => {
  const existing = [session('2026-10-01', 1, {}, { id: 'x' }), session('2026-10-02', 2, {}, { id: 'y' })];
  const incoming = [session('2026-10-05', 1, {}, { id: 'x' }), session('2026-10-06', 3, {}, { id: 'z' })];
  const r = mergeSessions(existing, incoming);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.sessions.length, 3);
  assert.equal(r.sessions.find(s => s.id === 'x').date, '2026-10-05');
});

// ── migration ──
test('migrateLog: empty, current, legacy and bare-array inputs', () => {
  assert.deepEqual(migrateLog(null), { schemaVersion: SCHEMA_VERSION, sessions: [], climbs: [], skipped: 0 });
  const s = session('2026-10-01', 1, { 's1-incline': done(50, 8) }, { id: 'a', program: 'old', note: 'injured' });
  assert.deepEqual(migrateLog({ schemaVersion: 2, sessions: [s] }).sessions[0], s);
  const legacy = { app: 'lifting-log', format: 1, entries: [{ id: 'old1', session: '3', date: '2026-05-28', ts: 5, entries: { 's3-bss': { skipped: true } } }] };
  const m = migrateLog(legacy);
  assert.equal(m.sessions[0].session, 3);
  assert.deepEqual(m.sessions[0].entries['s3-bss'], { status: 'skip', note: '' });
  assert.equal(migrateLog([s]).sessions.length, 1);
});

test('migrateLog skips unreadable sessions and rejects non-logs', () => {
  const r = migrateLog({ entries: [{ date: 'bad', session: 1, entries: {} }, { date: '2026-10-01', session: 7, entries: {} }, { date: '2026-10-01', session: 1, entries: {} }] });
  assert.equal(r.sessions.length, 1);
  assert.equal(r.skipped, 2);
  assert.ok(r.sessions[0].id);   // missing ids get generated
  assert.throws(() => migrateLog({ hello: 1 }));
});

test('every past save format still loads (fixtures are permanent — never edit them)', () => {
  const load = name => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
  const v1 = migrateLog(load('schema-v1.json'));
  assert.equal(v1.skipped, 0);
  assert.equal(v1.sessions.length, 3);
  assert.deepEqual(v1.sessions[0].entries['s1-deadlift'], { status: 'skip', note: 'back tight' });
  assert.deepEqual(v1.sessions[1].entries['s3-bss'], { status: 'complete', note: '', weight: 15, unit: 'lbs', reps: 7 });
  assert.equal(v1.sessions[2].program, 'old');
  const v2 = migrateLog(load('schema-v2.json'));
  assert.equal(v2.sessions[0].note, 'tweaked shoulder');
  assert.equal(v2.sessions[0].entries['s1-crunches'].unit, 'kg');
  const v3 = migrateLog(load('schema-v3.json'));
  assert.deepEqual(v3.sessions[0].entries['s1-incline'].sets, [{ weight: 50, reps: 9 }, { weight: 50, reps: 8 }]);
  assert.deepEqual(v3.sessions[0].entries['s1-incline'].target, { reps: 9, sets: 2, weight: 50 });
  assert.equal(v3.sessions[0].futureField, 'kept');   // unknown fields survive
  assert.equal(v3.sessions[0].entries['s1-incline'].rpe, 8);
  const v4 = migrateLog(load('schema-v4.json'));
  assert.equal(v4.sessions[0].deload, true);
  assert.equal(v4.sessions[0].entries['s1-incline'].deload, false);   // one lift kept normal in a deload session
  assert.equal(v4.sessions[0].entries['s1-pulldown'].unit, 'kg');
  assert.deepEqual(v4.sessions[0].prehab, ['Face pulls', 'External rotation']);
  assert.equal(v4.climbs.length, 2);
  assert.deepEqual(v4.climbs[0], { id: 'climb-1', date: '2026-10-19', intensity: 'hard', ts: 1792500000000, note: 'projecting' });
  assert.equal(v4.climbs[1].gym, 'future field');
});

test('retired exercises are not in the current program', () => {
  const current = new Set(Object.values(SESSIONS).flat().map(e => e.id));
  for (const ex of RETIRED) assert.ok(!current.has(ex.id), ex.id);
});

test('rotation: the next workout after the most recent session; when each was last done', async () => {
  const { nextSession, lastDoneOf } = await import('../../js/core/records.js');
  assert.equal(nextSession([]), 1);
  const log = [session('2026-10-01', 1, {}), session('2026-10-03', 2, {}), session('2026-10-05', 3, {}), session('2026-10-08', 1, {})];
  assert.equal(nextSession(log), 2);
  assert.equal(nextSession(log.slice(0, 3)), 1, 'after C comes A');
  assert.equal(lastDoneOf(log, 1), '2026-10-08');
  assert.equal(lastDoneOf(log, 3), '2026-10-05');
  assert.equal(lastDoneOf([], 2), null);
});

test('pick-one slots: crunches or ab wheel count as one in Workout C', async () => {
  const { slotCounts } = await import('../../js/core/records.js');
  const { exerciseSlots, sessionExercises, pickOneOthers, findExercise } = await import('../../js/core/exercises.js');
  assert.equal(exerciseSlots(sessionExercises(3)).length, 5, '6 exercises, 5 slots');
  assert.deepEqual(pickOneOthers(findExercise('s3-crunches')).map(e => e.id), ['s3-abwheel']);
  assert.deepEqual(pickOneOthers(findExercise('s1-crunches')), []);
  const only = session('2026-10-21', 3, { 's3-incline': done(50, 8), 's3-crunches': done(45, 10) });
  assert.deepEqual(slotCounts(only), { done: 2, total: 5 });
  const both = session('2026-10-21', 3, { 's3-crunches': done(45, 10), 's3-abwheel': done(null, 8) });
  assert.deepEqual(slotCounts(both), { done: 1, total: 5 });
  // an old Workout A that logged pulldown still shows it
  const oldA = session('2026-10-01', 1, { 's1-pulldown': done(25, 8, 'kg') });
  assert.deepEqual(slotCounts(oldA), { done: 1, total: 5 });
});

test('beyond target: extra sets and reps above target (only when the target is hit)', async () => {
  const { beyondTarget, beyondText } = await import('../../js/core/records.js');
  const { exerciseVerdict } = await import('../../js/core/progress.js');
  const t = { weight: 50, reps: 8, sets: 3 };
  const set = (reps, weight = 50) => ({ weight, reps });
  assert.deepEqual(beyondTarget([set(10), set(9), set(8), set(8)], t), { sets: 1, reps: 3 });
  assert.equal(beyondText({ sets: 1, reps: 3 }), '+1 set · +3 reps');
  assert.equal(beyondText({ sets: 2, reps: 0 }), '+2 sets');
  assert.equal(beyondTarget([set(8), set(8), set(8)], t), null);            // exactly on target
  assert.equal(beyondTarget([set(10), set(9), set(7)], t), null);           // missed a set → no bonus
  assert.equal(exerciseVerdict([set(9), set(8), set(8)], t).label, '✓ target hit · +1 rep');
  assert.equal(exerciseVerdict([set(8), set(8), set(8)], t).label, '✓ target hit');
});
