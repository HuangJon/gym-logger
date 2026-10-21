/**
 * End-to-end tests: drives the real app in a phone-sized Chromium, the way you'd use it.
 * Run: npm run test:e2e   (set CHROMIUM_PATH to use a specific Chromium binary)
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'sample-log.json');
const FIXTURE_COUNT = JSON.parse(readFileSync(FIXTURE, 'utf8')).entries.length;
const TMP = mkdtempSync(join(tmpdir(), 'liftlog-'));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed++; else failures.push(`${name}${detail ? ` → ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` → ${detail}` : ''}`);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Lets a test make every save fail (simulates full or blocked storage).
const FAILABLE_STORAGE = () => {
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (window.__failWrites) throw new Error('storage full'); return setItem.call(this, k, v); };
};

const { server, url } = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_PATH ? ['--headless=new'] : [],
});
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true };
const ctx = await browser.newContext(phone);
await ctx.addInitScript(FAILABLE_STORAGE);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const text = async sel => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const savedLog = () => page.evaluate(() => JSON.parse(localStorage.getItem('liftlog:log') || 'null'));
const sessionsOn = async date => (await savedLog()).sessions.filter(s => s.date === date);
const tab = name => page.tap(`.tab-btn[data-tab="${name}"]`);
const failWrites = on => page.evaluate(v => { window.__failWrites = v; }, on);
const TODAY = await (async () => { await page.goto(url); return page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }); })();

try {
  // ── installable app ─────────────────────────────────────
  await page.waitForTimeout(500);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  check('install: manifest is standalone with icons', manifest.display === 'standalone' && manifest.icons.length >= 2);
  check('install: iPhone home-screen tags', await page.locator('link[rel="apple-touch-icon"]').count() === 1);
  check('install: offline worker active', await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active));
  check('empty: history says nothing logged yet', (await text('#history-list')).includes('No sessions logged yet'));

  // ── import ──────────────────────────────────────────────
  await tab('history');
  check('backup: no nag while the log is empty', await page.locator('#backup-card.stale').count() === 0);
  await page.setInputFiles('#import-file', FIXTURE);
  await wait(200);
  check('import: all sessions shown', await page.locator('.history-entry').count() === FIXTURE_COUNT);
  check('import: message', (await text('#backup-msg')).includes(`${FIXTURE_COUNT} new`));
  check('backup: nags once there is data and no backup', await page.locator('#backup-card.stale').count() === 1);
  await page.setInputFiles('#import-file', FIXTURE);
  await wait(200);
  check('import: re-import updates instead of duplicating', await page.locator('.history-entry').count() === FIXTURE_COUNT && (await text('#backup-msg')).includes(`${FIXTURE_COUNT} updated`));
  const bad = join(TMP, 'bad.json'); writeFileSync(bad, '{"hello": 1}');
  await page.setInputFiles('#import-file', bad);
  await wait(200);
  check('import: other files rejected, log untouched', await page.locator('#backup-msg.error').count() === 1 && await page.locator('.history-entry').count() === FIXTURE_COUNT);

  // ── picker ──────────────────────────────────────────────
  await tab('workout');
  check('picker: date defaults to today', (await page.inputValue('#pick-date')) === TODAY);
  check('picker: Start disabled until a session is picked', await page.locator('#start-btn').isDisabled());
  await page.selectOption('#pick-session', '2');
  check('picker: preview lists the session', (await text('#session-preview-area')).includes('DB Shoulder Press'));
  await page.selectOption('#pick-session', '');
  check('picker: clearing hides preview', (await page.locator('#session-preview-area').innerText()).trim() === '' && await page.locator('#start-btn').isDisabled());

  // ── logging a session: targets ─────────────────────────
  const chips = async id => (await page.locator(`#card-${id} .set-chip`).allInnerTexts()).map(t => t.trim());
  await page.selectOption('#pick-session', '1');
  check('picker: preview shows today\'s targets', (await text('#session-preview-area')).includes('175 lbs × 7 × 2 sets'));
  await page.tap('#start-btn');
  check('workout: Session 1 has 5 exercises', await page.locator('.ex-card').count() === 5);
  check('target: partial last time → same target again', (await text('#card-s1-incline .target-row')).includes('47.5 lbs × 6 × 2 sets') && (await text('#card-s1-incline .target-row')).includes('not hit last time'));
  check('target: hit last time → one more rep', (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets') && (await text('#card-s1-deadlift .target-row')).includes('one more rep'));
  check('target: below range last time → bottom of range', (await text('#card-s1-lateral .target-row')).includes('7.5 lbs × 12 × 2 sets') && (await text('#card-s1-lateral .target-row')).includes('below range'));
  check('target: kg lift', (await text('#card-s1-crunches .target-row')).includes('45 kg × 13 × 2 sets'));
  check('target: first time asks for a weight', (await text('#card-s1-pulldown .target-row')).includes('set a weight'));
  check('last: shows last time and flags a long gap', (await text('#card-s1-deadlift .last-row')).includes('175 lbs × 6 reps') && (await text('#card-s1-deadlift .last-row')).includes('been a while'));
  check('pre-filled: weight = target', (await text('#wv-s1-deadlift')) === '175');
  check('pre-filled: one box per set = target reps', JSON.stringify(await chips('s1-deadlift')) === '["7","7"]');
  check('no verdict badge until you change something', await page.locator('#pb-s1-deadlift').count() === 0);

  // weight: typing, validation, steppers
  for (const badWeight of ['0', '-5', '']) {
    await page.tap('#wv-s1-deadlift'); await page.fill('#inp-s1-deadlift', badWeight); await page.keyboard.press('Enter');
    check(`weight: "${badWeight}" rejected`, (await text('#wv-s1-deadlift')) === '175');
  }
  await page.tap('#wv-s1-deadlift'); await page.fill('#inp-s1-deadlift', '200'); await page.keyboard.press('Escape');
  check('weight: Escape cancels', (await text('#wv-s1-deadlift')) === '175');
  await page.tap('#card-s1-deadlift [data-action="weight-step"][data-dir="1"]');
  check('weight +: steps by the lift increment (deadlift 5)', (await text('#wv-s1-deadlift')) === '180');
  await page.tap('#card-s1-deadlift [data-action="weight-step"][data-dir="-1"]');
  await page.tap('#card-s1-deadlift [data-action="weight-step"][data-dir="-1"]');
  check('weight −: below target shows "lighter → partial"', (await text('#wv-s1-deadlift')) === '170' && (await text('#pb-s1-deadlift')).includes('lighter'));
  await page.tap('#wv-s1-deadlift'); await page.fill('#inp-s1-deadlift', '177.5'); await page.keyboard.press('Enter');
  check('weight: decimals accepted', (await text('#wv-s1-deadlift')) === '177.5');
  check('weight: no log yet → − disabled, + starts from 0', await page.locator('#card-s1-pulldown [data-action="weight-step"][data-dir="-1"]').isDisabled());
  await page.tap('#card-s1-pulldown [data-action="weight-step"][data-dir="1"]');
  check('weight: first + gives one increment', (await text('#wv-s1-pulldown')) === '2.5');
  await page.tap('#wv-s1-pulldown'); await page.fill('#inp-s1-pulldown', '45');
  await page.tap('#card-s1-pulldown .status-btn[data-status="complete"]');
  check('phone: type weight then tap Done → both register', (await text('#wv-s1-pulldown')) === '45' && await page.locator('#card-s1-pulldown .status-btn[aria-pressed="true"]').count() === 1);
  await page.tap('#wv-s1-incline'); await page.fill('#inp-s1-incline', '50');
  await page.tap('#note-s1-incline'); await page.keyboard.type('felt solid');
  check('phone: type weight then tap notes → note kept', (await page.inputValue('#note-s1-incline')) === 'felt solid' && (await text('#wv-s1-incline')) === '50');
  check('phone: text boxes are 16px (no iPhone zoom)', await page.$eval('#note-s1-incline', el => getComputedStyle(el).fontSize) === '16px');

  // sets: select a set, − / +
  await page.tap('#card-s1-deadlift .set-chip >> nth=1');
  await page.tap('#card-s1-deadlift [data-action="set-step"][data-dir="-1"]');
  check('sets: − changes the selected set', JSON.stringify(await chips('s1-deadlift')) === '["7","6"]' && (await text('#pb-s1-deadlift')).includes('below target'));
  await page.tap('#card-s1-lateral .set-chip >> nth=0');
  for (let i = 0; i < 5; i++) await page.tap('#card-s1-lateral [data-action="set-step"][data-dir="1"]');
  check('sets: + stops at the top of the range', JSON.stringify(await chips('s1-lateral')) === '["15","12"]');
  await page.tap('#card-s1-crunches .set-chip >> nth=1');
  for (let i = 0; i < 15; i++) await page.tap('#card-s1-crunches [data-action="set-step"][data-dir="-1"]');
  check('sets: − goes down to "–" (set not done)', JSON.stringify(await chips('s1-crunches')) === '["13","–"]' && (await text('#pb-s1-crunches')).includes('1 set not done'));

  // Done / Skip
  await page.tap('#card-s1-incline .status-btn[data-status="complete"]');
  await page.tap('#card-s1-deadlift .status-btn[data-status="complete"]');
  await page.tap('#card-s1-lateral .status-btn[data-status="skip"]');
  check('skip: card dims and the logging rows hide', await page.locator('#card-s1-lateral.is-skipped').count() === 1 && await page.locator('#card-s1-lateral .ex-log').isHidden());
  await page.tap('#card-s1-lateral .status-btn[data-status="skip"]');
  check('skip: tap again clears', await page.locator('#card-s1-lateral .status-btn[aria-pressed="true"]').count() === 0 && await page.locator('#card-s1-lateral .ex-log').isVisible());
  await page.tap('#card-s1-lateral .status-btn[data-status="skip"]');
  await page.fill('#note-s1-lateral', '<b>shoulder</b> & "tired"');
  check('no Partial button — partial is worked out from the target', await page.locator('#card-s1-incline .status-btn[data-status="partial"]').count() === 0);

  await page.fill('#active-date', '2026-10-20'); await page.dispatchEvent('#active-date', 'change');
  check('date change mid-session keeps everything', (await page.inputValue('#note-s1-incline')) === 'felt solid' && (await text('#wv-s1-incline')) === '50' &&
    JSON.stringify(await chips('s1-deadlift')) === '["7","6"]' && await page.locator('#card-s1-incline .status-btn[aria-pressed="true"]').count() === 1);
  check('date change updates "last time" age', (await text('#card-s1-deadlift .last-row')).includes('6 months ago'));

  await page.tap('.sa-change'); await page.tap('.discard-bar [data-action="keep"]');
  check('discard: keep going', await page.locator('#session-panel').isVisible() && await page.locator('.discard-bar').count() === 0);

  await page.locator('#complete-btn').dblclick();
  await wait(1000);
  const saved = await sessionsOn('2026-10-20');
  check('complete: double tap saves once', saved.length === 1, `${saved.length}`);
  const E = saved[0]?.entries || {};
  check('saved: Done untouched = hit target (complete), with target stored', JSON.stringify(E['s1-incline']) === JSON.stringify({ status: 'complete', note: 'felt solid', weight: 50, unit: 'lbs', sets: [6, 6], reps: 6, target: { reps: 6, sets: 2, weight: 47.5 } }), JSON.stringify(E['s1-incline']));
  check('saved: Done short of target = partial, per-set reps kept', E['s1-deadlift']?.status === 'partial' && E['s1-deadlift'].weight === 177.5 && JSON.stringify(E['s1-deadlift'].sets) === '[7,6]' && E['s1-deadlift'].reps === 6, JSON.stringify(E['s1-deadlift']));
  check('saved: skip keeps note only', E['s1-lateral']?.status === 'skip' && E['s1-lateral'].weight === undefined && E['s1-lateral'].sets === undefined && E['s1-lateral'].note.includes('shoulder'));
  check('saved: unmarked → not recorded', E['s1-crunches']?.status === 'unrecorded' && E['s1-crunches'].weight === undefined);
  check('saved: first-time lift with typed weight', E['s1-pulldown']?.status === 'complete' && E['s1-pulldown'].weight === 45 && JSON.stringify(E['s1-pulldown'].sets) === '[8,8]', JSON.stringify(E['s1-pulldown']));
  check('complete: picker resets to today', (await page.inputValue('#pick-date')) === TODAY);
  check('complete: switches to History', await page.locator('#tab-history.active').count() === 1);

  // next time: partial → same target, complete → one more
  await tab('workout');
  await page.fill('#pick-date', '2026-10-21'); await page.selectOption('#pick-session', '1'); await page.tap('#start-btn');
  check('next time: after a partial the target repeats (no increase)', (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets'));
  check('next time: after hitting it, one more rep', (await text('#card-s1-incline .target-row')).includes('50 lbs × 7 × 2 sets'));
  await page.tap('.sa-change'); await page.tap('.discard-yes');

  // empty-session guard
  await tab('workout');
  await page.selectOption('#pick-session', '2'); await page.tap('#start-btn');
  const before = (await savedLog()).sessions.length;
  await page.tap('#complete-btn'); await wait(150);
  check('empty session: first tap asks first', (await savedLog()).sessions.length === before && (await text('#complete-btn')).includes('Nothing marked'));
  await page.tap('#complete-btn'); await wait(900);
  check('empty session: second tap saves', (await savedLog()).sessions.length === before + 1);

  // ── reload: data persists ───────────────────────────────
  await page.reload(); await wait(400);
  await tab('history');
  check('reload: everything still there', await page.locator('.history-entry').count() === FIXTURE_COUNT + 2);

  // ── history ─────────────────────────────────────────────
  const oct20 = page.locator('.history-entry', { has: page.locator('.history-title', { hasText: 'Oct 20, 2026' }) });
  if (!(await oct20.locator('.history-body').isVisible())) await oct20.locator('.history-hdr').tap();
  check('history: note shown as text, not HTML', (await oct20.innerText()).includes('<b>shoulder</b> & "tired"'));
  check('history: header date · session · done count', (await oct20.locator('.history-hdr').innerText()).replace(/\s+/g, ' ').includes('Session 1 · 3/5 done'));
  check('history: actual next to target', (await oct20.locator('.history-row[data-ex="s1-deadlift"]').innerText()).replace(/\s+/g, ' ').includes('177.5 lbs · 7, 6 reps') && (await oct20.locator('.history-row[data-ex="s1-deadlift"]').innerText()).includes('target 175 lbs × 7 × 2 sets'));
  await oct20.locator('.history-row[data-ex="s1-crunches"]').tap();
  await page.tap('#hedit-panel .status-btn[data-status="complete"]');
  await page.fill('#hedit-weight', '42.5'); await page.fill('#hedit-set-0', '11'); await page.fill('#hedit-set-1', '11');
  await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  let e = (await sessionsOn('2026-10-20'))[0].entries['s1-crunches'];
  check('history edit: per-set reps saved with the exercise unit', e.status === 'complete' && e.weight === 42.5 && JSON.stringify(e.sets) === '[11,11]' && e.unit === 'kg', JSON.stringify(e));
  check('history edit: header count updates', (await oct20.locator('.history-hdr').innerText()).includes('4/5 done'));

  const apr22 = page.locator('.history-entry', { has: page.locator('.history-title', { hasText: 'Apr 22, 2026' }) });
  await apr22.locator('.history-hdr').tap();
  check('history: old-program tag', (await apr22.locator('.history-hdr').innerText()).toLowerCase().includes('old program'));
  await apr22.locator('.history-row[data-ex="s2-dips"]').tap();
  check('history edit: retired bodyweight lift has set boxes but no weight box', await page.locator('#hedit-weight').count() === 0 && await page.locator('.hedit-set').count() === 2);
  await page.tap('#hedit-panel .status-btn[data-status="partial"]'); await page.fill('#hedit-set-0', '5');
  await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  e = (await sessionsOn('2026-04-22'))[0].entries['s2-dips'];
  check('history edit: retired lift saved (blank set = not done)', e.status === 'partial' && e.reps === 5 && JSON.stringify(e.sets) === '[5,0]', JSON.stringify(e));

  await oct20.locator('.history-row[data-ex="s1-deadlift"]').tap();
  await page.tap('#hedit-panel .status-btn[data-status="partial"]');
  await page.tap('#hedit-panel .status-btn[data-status="complete"]');
  await page.fill('#hedit-set-1', '7'); await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  check('history edit: fixed to meet the target → complete', (await sessionsOn('2026-10-20'))[0].entries['s1-deadlift'].status === 'complete');
  await oct20.locator('.history-row[data-ex="s1-deadlift"]').tap();
  await page.fill('#hedit-set-1', '5'); await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  check('history edit: Done below the target is saved as partial', (await sessionsOn('2026-10-20'))[0].entries['s1-deadlift'].status === 'partial');

  await failWrites(true);
  await apr22.locator('.history-row[data-ex="s2-pallof"]').tap();
  await page.fill('#hedit-set-0', '99'); await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  await failWrites(false);
  check('history edit: failed save keeps the editor with a message', (await text('#hedit-msg')).includes('failed') && await page.locator('#hedit-panel').count() === 1);
  check('history edit: failed save changed nothing', (await sessionsOn('2026-04-22'))[0].entries['s2-pallof'].reps === 5);
  await page.tap('#hedit-panel [data-action="edit-cancel"]');
  check('history edit: cancel closes', await page.locator('#hedit-panel').count() === 0);

  await oct20.locator('.entry-date').fill('2026-03-01'); await wait(200);
  const titles = await page.locator('.history-title').allInnerTexts();
  check('history: changing a date re-sorts the list', titles.at(-1).includes('Mar 1, 2026'), titles.at(-1));
  const mar1 = page.locator('.history-entry', { has: page.locator('.history-title', { hasText: 'Mar 1, 2026' }) });
  const n0 = (await savedLog()).sessions.length;
  await mar1.locator('.delete-entry').tap(); await wait(100);
  check('delete: first tap only arms', (await savedLog()).sessions.length === n0 && (await mar1.locator('.delete-entry').innerText()).includes('again'));
  await mar1.locator('.delete-entry').tap(); await wait(200);
  check('delete: second tap deletes', (await savedLog()).sessions.length === n0 - 1);

  // restore an earlier copy (undo the delete)
  await page.locator('#restore-panel summary').tap();
  check('restore: earlier copies listed (max 3)', (await page.locator('.snap-row').count()) >= 1 && (await page.locator('.snap-row').count()) <= 3);
  await page.locator('.snap-row [data-action="restore"]').first().tap();
  check('restore: first tap only arms', (await savedLog()).sessions.length === n0 - 1);
  await page.locator('.snap-row [data-action="restore"]').first().tap(); await wait(200);
  check('restore: second tap brings the deleted session back', (await savedLog()).sessions.length === n0 && (await text('#backup-msg')).includes('Restored'));
  const snaps = await page.evaluate(() => JSON.parse(localStorage.getItem('liftlog:snapshots')));
  check('restore: local copies stay small (≤ 3)', snaps.length <= 3);

  // ── trends ──────────────────────────────────────────────
  await tab('trends');
  const pressed = async () => (await page.locator('.seg button[aria-pressed="true"]').first().innerText()).trim();
  check('trends: opens on 3M when there is something recent', (await pressed()) === '3M');
  const names = await page.locator('.trend-name').allInnerTexts();
  check('trends: current and old-program lifts', names.includes('Deadlift') && names.includes('Dips') && names.includes('Rows (elbow to hip)'));
  await page.tap('.seg button[data-value="all"]');
  check('trends: All shows charts', await page.locator('.trend-card svg').count() > 5);
  const deadliftCard = page.locator('.trend-card', { has: page.locator('.trend-name', { hasText: /^Deadlift$/ }) });
  check('trends: change table', (await deadliftCard.locator('.dtable').innerText()).includes('lbs'));
  check('trends: recent strip, newest last', (await deadliftCard.locator('.rc.latest').innerText()).includes('175×6'));
  await page.tap('.seg button[data-value="custom"]');
  await page.fill('.tc-custom input >> nth=0', '2026-04-01'); await page.dispatchEvent('.tc-custom input >> nth=0', 'change');
  await page.fill('.tc-custom input >> nth=1', '2026-04-15'); await page.dispatchEvent('.tc-custom input >> nth=1', 'change');
  const tips = await page.$$eval('.trend-card svg title', ts => ts.map(t => t.textContent).filter(t => !t.startsWith('Week of')));
  check('trends: custom range shows only those dates', tips.length > 0 && tips.every(t => /Apr ([1-9]|1[0-5])\b/.test(t)), tips.find(t => !/Apr ([1-9]|1[0-5])\b/.test(t)));
  await page.tap('.seg button[data-value="e1rm"]');
  check('trends: Strength mode', (await text('.trend-explain')).includes('estimated 1-rep max'));
  await page.tap('.seg button[data-value="weight"]');
  await page.tap('.seg button[data-value="all"]');
  await page.evaluate(() => window.scrollTo(0, 3000)); await wait(100);
  const bar = await page.locator('.tab-bar').boundingBox(), ctl = await page.locator('#trend-controls').boundingBox();
  check('trends: controls stay pinned under the tabs', Math.abs(ctl.y - (bar.y + bar.height)) < 3, `${ctl.y} vs ${bar.y + bar.height}`);
  await page.tap('.seg button[data-value="1m"]');
  check('trends: buttons work while scrolled', (await pressed()) === '1M');
  const logBefore = JSON.stringify(await savedLog());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.tap('.demo-bar button');
  check('trends: sample preview', (await text('.demo-bar')).includes('Sample data') && Number(await text('.ts-num')) > 15);
  await page.tap('.demo-bar button');
  check('trends: sample preview never saves anything', JSON.stringify(await savedLog()) === logBefore);

  // ── failed save on Complete ─────────────────────────────
  await tab('workout');
  await page.selectOption('#pick-session', '3'); await page.tap('#start-btn');
  await page.tap('#card-s3-incline .status-btn[data-status="complete"]');
  const n1 = (await savedLog()).sessions.length;
  await failWrites(true); await page.tap('#complete-btn'); await wait(300); await failWrites(false);
  check('complete failure: message, session stays open', (await text('#status')).includes('failed') && await page.locator('#session-panel').isVisible());
  check('complete failure: nothing half-saved', (await savedLog()).sessions.length === n1);
  await page.tap('#complete-btn'); await wait(900);
  check('complete: retry succeeds', (await savedLog()).sessions.length === n1 + 1);

  // ── offline ─────────────────────────────────────────────
  await ctx.setOffline(true);
  await page.reload(); await wait(600);
  await tab('history');
  const offlineCount = await page.locator('.history-entry').count();
  check('offline: app opens with your log', offlineCount === n1 + 1);
  await tab('workout');
  await page.selectOption('#pick-session', '2'); await page.tap('#start-btn');
  await page.tap('#card-s2-rows .status-btn[data-status="complete"]');
  await page.tap('#complete-btn'); await wait(900);
  check('offline: can log a session', (await savedLog()).sessions.length === n1 + 2);
  await ctx.setOffline(false);

  // ── export / restore ────────────────────────────────────
  await tab('history');
  const [download] = await Promise.all([page.waitForEvent('download'), page.tap('[data-action="export"]')]);
  const file = join(TMP, 'export.json'); await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  check('export: file has every session', exported.sessions.length === n1 + 2 && exported.app === 'lifting-log');
  check('export: backup reminder clears', await page.locator('#backup-card.stale').count() === 0 && (await text('#backup-status')).includes('today'));
  const fresh = await browser.newContext(phone);
  const p2 = await fresh.newPage(); await p2.goto(url); await p2.waitForTimeout(300);
  await p2.tap('.tab-btn[data-tab="history"]'); await p2.setInputFiles('#import-file', file); await p2.waitForTimeout(200);
  check('restore on a new device', await p2.locator('.history-entry').count() === n1 + 2);
  await fresh.close();

  // ── site down (e.g. repo made private): installed app still opens ──
  const down = await startServer({ mode: 'down' });
  const swCtx = await browser.newContext(phone);
  const p3 = await swCtx.newPage();
  const port = new URL(url).port;
  await p3.goto(url); await p3.evaluate(() => navigator.serviceWorker.ready); await p3.reload(); await p3.waitForTimeout(300);
  await p3.tap('.tab-btn[data-tab="history"]'); await p3.setInputFiles('#import-file', FIXTURE); await p3.waitForTimeout(200);
  server.close(); await wait(200);
  const takeover = await startServer({ port: Number(port), mode: 'down' });
  await p3.reload(); await p3.waitForTimeout(500);
  await p3.tap('.tab-btn[data-tab="history"]').catch(() => {});
  check('site down: installed app still opens with your log', await p3.locator('.history-entry').count() === FIXTURE_COUNT);
  takeover.server.close(); down.server.close(); await swCtx.close();

  // ── a log from a newer app version is never overwritten ──
  const roServer = await startServer();
  const ro = await browser.newContext(phone);
  await ro.addInitScript(() => { if (!localStorage.getItem('liftlog:log')) localStorage.setItem('liftlog:log', JSON.stringify({ schemaVersion: 99, sessions: [{ id: 'x', session: 1, date: '2026-10-01', ts: 1, entries: {}, fromTheFuture: true }] })); });
  const p4 = await ro.newPage(); await p4.goto(roServer.url); await p4.waitForTimeout(300);
  check('newer log: warning banner shown', await p4.locator('#readonly-banner').isVisible());
  await p4.selectOption('#pick-session', '2'); await p4.tap('#start-btn');
  await p4.tap('#card-s2-rows .status-btn[data-status="complete"]'); await p4.tap('#complete-btn'); await p4.waitForTimeout(300);
  const roLog = await p4.evaluate(() => JSON.parse(localStorage.getItem('liftlog:log')));
  check('newer log: saving refused, data untouched', (await p4.locator('#status').innerText()).includes('newer version') && roLog.schemaVersion === 99 && roLog.sessions[0].fromTheFuture === true);
  await ro.close(); roServer.server.close();

  // ── layout ──────────────────────────────────────────────
  const up = await startServer();
  for (const [width, scheme] of [[320, 'light'], [390, 'dark'], [768, 'light']]) {
    const c = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
    const p = await c.newPage(); await p.goto(up.url); await p.waitForTimeout(300);
    await p.click('.tab-btn[data-tab="history"]'); await p.setInputFiles('#import-file', FIXTURE); await p.waitForTimeout(150);
    let worst = 0;
    for (const name of ['workout', 'history', 'trends']) {
      await p.click(`.tab-btn[data-tab="${name}"]`);
      if (name === 'workout') { await p.selectOption('#pick-session', '2'); await p.click('#start-btn'); }
      if (name === 'history') await p.click('.history-row >> nth=0');
      worst = Math.max(worst, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
      if (process.env.SCREENSHOTS) await p.screenshot({ path: join(process.env.SCREENSHOTS, `${width}-${scheme}-${name}.png`), fullPage: true });
    }
    check(`layout ${width}px ${scheme}: no sideways scrolling`, worst <= 0, `${worst}px`);
    await c.close();
  }
  up.server.close();

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  failures.push(`crashed: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map(f => `- ${f}`).join('\n')); process.exit(1); }
process.exit(0);
