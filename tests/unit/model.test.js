import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExercise, sessionExercises, exercisesForSession, unitOf, incrementOf, repRangeText, allExercises } from '../../js/core/exercises.js';
import { normalizeEntry, buildSessionRecord, statusCounts, byNewest } from '../../js/core/records.js';
import { addSession, updateEntry, setSessionDate, deleteSession, mergeSessions } from '../../js/core/log.js';
import { migrateLog, SCHEMA_VERSION } from '../../js/core/migrate.js';
import { SESSIONS, RETIRED } from '../../js/config/program.js';
import { session, done, skipped } from '../helpers.js';

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
  assert.equal(incrementOf(findExercise('s1-pulldown')), 2.5);   // default
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

test('buildSessionRecord: status rules', () => {
  const planned = ex => ({ 's1-incline': 50, 's1-deadlift': 185, 's1-lateral': 5 })[ex.id] ?? null;
  const rec = buildSessionRecord({
    sessionNum: 1, date: '2026-10-21', now: 123, plannedWeight: planned,
    scratch: {
      's1-incline': { status: 'complete', reps: 9, note: ' felt solid ' },   // planned weight used
      's1-deadlift': { status: 'partial', weight: 187.5, reps: 6 },          // typed weight used
      's1-lateral': { status: 'skip', reps: 12, weight: 7 },                 // skip drops weight/reps
      's1-pulldown': { weight: 45 },                                         // unmarked keeps what you typed
    },
  });
  assert.equal(rec.id, '123');
  assert.equal(rec.session, 1);
  assert.deepEqual(rec.entries['s1-incline'], { status: 'complete', note: 'felt solid', weight: 50, unit: 'lbs', reps: 9 });
  assert.deepEqual(rec.entries['s1-deadlift'], { status: 'partial', note: '', weight: 187.5, unit: 'lbs', reps: 6 });
  assert.deepEqual(rec.entries['s1-lateral'], { status: 'skip', note: '' });
  assert.deepEqual(rec.entries['s1-pulldown'], { status: 'unrecorded', note: '', weight: 45, unit: 'lbs' });
  assert.deepEqual(rec.entries['s1-crunches'], { status: 'unrecorded', note: '' });   // untouched: no planned weight added
  assert.equal(Object.keys(rec.entries).length, SESSIONS[1].length);
});

test('buildSessionRecord: bodyweight exercises never get a weight', () => {
  const rec = buildSessionRecord({ sessionNum: 2, date: '2026-10-21', now: 1, plannedWeight: () => 99, scratch: { 's2-legraiser': { status: 'complete', reps: 10 } } });
  assert.deepEqual(rec.entries['s2-legraiser'], { status: 'complete', note: '', reps: 10 });
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
  assert.deepEqual(migrateLog(null), { schemaVersion: SCHEMA_VERSION, sessions: [], skipped: 0 });
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

test('retired exercises are not in the current program', () => {
  const current = new Set(Object.values(SESSIONS).flat().map(e => e.id));
  for (const ex of RETIRED) assert.ok(!current.has(ex.id), ex.id);
});
