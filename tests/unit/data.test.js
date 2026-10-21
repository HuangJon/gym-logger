import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStorage, createLocalStorage } from '../../js/data/storage.js';
import { createRepository } from '../../js/data/repository.js';
import { createBackup, parseBackup, backupStatus, markBackedUp } from '../../js/data/backup.js';
import { SCHEMA_VERSION } from '../../js/core/migrate.js';
import { makeDemoSessions } from '../../js/dev/demo.js';
import { migrateLog } from '../../js/core/migrate.js';
import { lineChart, weeklyBarsChart } from '../../js/ui/charts.js';
import { session, done } from '../helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── storage ──
test('createLocalStorage reads/writes JSON with a prefix and survives bad data', () => {
  const map = new Map();
  const backend = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const s = createLocalStorage('p:', backend);
  s.write('a', { x: 1 });
  assert.equal(map.get('p:a'), '{"x":1}');
  assert.deepEqual(s.read('a'), { x: 1 });
  map.set('p:bad', '{not json');
  assert.equal(s.read('bad'), null);
  assert.equal(s.read('missing'), null);
});

// ── repository ──
test('repository: commit saves, updates and notifies', async () => {
  const storage = createMemoryStorage();
  const repo = createRepository(storage);
  repo.load();
  let calls = 0;
  const unsubscribe = repo.subscribe(() => calls++);
  const s = session('2026-10-21', 1, { 's1-incline': done(50, 8) }, { id: 'a' });
  await repo.commit([s]);
  assert.equal(repo.sessions.length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(storage.dump().log, { schemaVersion: SCHEMA_VERSION, sessions: [s] });
  unsubscribe();
  await repo.commit([]);
  assert.equal(calls, 1);
});

test('repository: a failed save changes nothing and does not notify', async () => {
  const storage = { read: () => null, write: () => { throw new Error('quota'); } };
  const repo = createRepository(storage);
  repo.load();
  let calls = 0;
  repo.subscribe(() => calls++);
  await assert.rejects(repo.commit([session('2026-10-21', 1, {})]), /quota/);
  assert.equal(repo.sessions.length, 0);
  assert.equal(calls, 0);
});

test('repository: loads older formats and rewrites them in the current schema', () => {
  const storage = createMemoryStorage({ log: { entries: [{ id: 'x', session: 1, date: '2026-10-01', entries: { 's1-incline': { weight: 50, unit: 'lbs' } } }] } });
  const repo = createRepository(storage);
  repo.load();
  assert.equal(repo.sessions[0].entries['s1-incline'].status, 'complete');
  assert.equal(storage.dump().log.schemaVersion, SCHEMA_VERSION);
});

test('repository: unreadable saved data loads as empty instead of crashing', () => {
  const repo = createRepository(createMemoryStorage({ log: { nonsense: true } }));
  assert.deepEqual(repo.load(), []);
});

// ── backup ──
test('backup round trip', () => {
  const sessions = [session('2026-10-21', 1, { 's1-incline': done(50, 8) }, { id: 'a' })];
  const file = createBackup(sessions, '2026-10-21', 'T');
  assert.equal(file.filename, 'lifting-log-backup-2026-10-21.json');
  assert.deepEqual(parseBackup(file.json), { sessions, skipped: 0 });
});

test('parseBackup accepts the earlier export format', () => {
  const old = JSON.stringify({ app: 'lifting-log', format: 1, entries: [{ id: 'log-2026-04-19', session: 1, date: '2026-04-19', ts: 1, program: 'old', entries: { 's1-incline': { status: 'complete', weight: 55, unit: 'lbs', reps: 6, note: '' } } }], weights: {} });
  const r = parseBackup(old);
  assert.equal(r.sessions[0].program, 'old');
  assert.equal(r.sessions[0].entries['s1-incline'].weight, 55);
});

test('parseBackup rejects junk with a readable message', () => {
  assert.throws(() => parseBackup('{not json'), /isn’t a lifting-log backup/);
  assert.throws(() => parseBackup('{"hello":1}'), /isn’t a lifting-log backup/);
  assert.throws(() => parseBackup('{"entries":[]}'), /No sessions/);
});

test('backupStatus: stale when never backed up or older than 14 days (only once there is data)', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(backupStatus(storage, 0, '2026-10-21'), { last: null, stale: false });
  assert.equal(backupStatus(storage, 3, '2026-10-21').stale, true);
  markBackedUp(storage, '2026-10-10');
  assert.equal(backupStatus(storage, 3, '2026-10-21').stale, false);
  assert.equal(backupStatus(storage, 3, '2026-10-25').stale, true);
});

// ── demo data ──
test('demo sessions are valid, deterministic and recent', () => {
  const a = makeDemoSessions('2026-10-21'), b = makeDemoSessions('2026-10-21');
  assert.deepEqual(a, b);
  assert.ok(a.length > 15);
  assert.equal(migrateLog({ sessions: a }).skipped, 0);
  assert.ok(a.every(s => s.date < '2026-10-21' && s.date >= '2026-08-12'));
});

// ── charts ──
test('lineChart: empty input, labels only when there is room, grid levels, band', () => {
  assert.equal(lineChart([], { valueOf: p => p.v }), '');
  const few = [{ date: '2026-10-01', v: 50, r: 8 }, { date: '2026-10-08', v: 52.5, r: 6 }];
  const svg = lineChart(few, { valueOf: p => p.v, labelOf: p => p.r, grid: 'levels', tagChanges: true, band: [6, 12] });
  assert.match(svg, /<svg/);
  assert.equal((svg.match(/class="chart-lbl/g) || []).length, 2);
  assert.equal((svg.match(/class="chart-tag"/g) || []).length, 1);
  assert.match(svg, /chart-band/);
  const many = Array.from({ length: 31 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, v: i, r: i }));
  assert.equal((lineChart(many, { valueOf: p => p.v, labelOf: p => p.r }).match(/class="chart-lbl/g) || []).length, 0);
});

test('lineChart escapes tooltip text', () => {
  const svg = lineChart([{ date: '2026-10-01', v: 1 }], { valueOf: p => p.v, tipOf: () => '<b>x</b>' });
  assert.ok(svg.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('weeklyBarsChart draws one bar per week', () => {
  const weeks = Array.from({ length: 8 }, (_, i) => ({ start: `2026-08-${String(3 + i * 7).padStart(2, '0')}`, count: i % 4 }));
  assert.equal((weeklyBarsChart(weeks, 3).match(/<rect/g) || []).length, 8);
});

// ── offline worker ──
test('sw.js caches every app file, and every cached file exists', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
  const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [relative(ROOT, p)]; });
  for (const file of [...walk(join(ROOT, 'js')), ...walk(join(ROOT, 'css'))]) assert.ok(listed.includes(file), `${file} missing from sw.js APP_FILES`);
  for (const file of listed) assert.ok(existsSync(join(ROOT, file)), `${file} listed in sw.js but missing`);
});

test('index.html links every stylesheet', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const css of readdirSync(join(ROOT, 'css'))) assert.ok(html.includes(`css/${css}`), css);
});
