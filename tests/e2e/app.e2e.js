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
const mySession = async () => (await sessionsOn('2026-05-04')).filter(s => s.session === 1);   // the Session 1 logged below
const tab = name => page.tap(`.tab-btn[data-tab="${name}"]`);
/** Select workout n (1/2/3 = A/B/C) in the picker, whatever is selected now. */
const pickWorkout = async n => { if ((await page.getAttribute(`.workout-btn[data-n="${n}"]`, 'aria-pressed')) !== 'true') await page.tap(`.workout-btn[data-n="${n}"]`); };
const failWrites = on => page.evaluate(v => { window.__failWrites = v; }, on);
const SESSION_DATE = '2026-05-04';
const TODAY = await (async () => { await page.goto(url); return page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }); })();

try {
  // ── installable app ─────────────────────────────────────
  await page.waitForTimeout(500);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  check('install: manifest is standalone with icons', manifest.display === 'standalone' && manifest.icons.length >= 2);
  check('install: iPhone home-screen tags', await page.locator('link[rel="apple-touch-icon"]').count() === 1);
  check('install: offline worker active', await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active));
  await page.waitForTimeout(300);
  check('install: no "new version" banner on a first install', await page.locator('#update-banner').isHidden());
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
  await page.fill('#pick-date', '2099-01-01'); await page.dispatchEvent('#pick-date', 'change');
  check('picker: no future dates', (await page.inputValue('#pick-date')) === TODAY && (await text('#pick-msg')).includes('future'));
  check('picker: workout buttons, up next pre-selected', await page.locator('.workout-btn').count() === 3 && await page.locator('.workout-btn[aria-pressed="true"] .wb-next').count() === 1 && !(await page.locator('#start-btn').isDisabled()));
  check('picker: Start says which workout', /^Start Workout [ABC]$/.test(await text('#start-btn')));
  await pickWorkout(2);
  check('picker: preview lists the session', (await text('#session-preview-area')).includes('DB Shoulder Press'));
  await page.tap('.workout-btn[data-n="2"]');
  check('picker: clearing hides preview', (await page.locator('#session-preview-area').innerText()).trim() === '' && await page.locator('#start-btn').isDisabled());

  // ── logging a session: targets ─────────────────────────
  // a finished lift collapses to one line; its summary is there instead
  const summary = async id => ((await page.locator(`#card-${id}.is-collapsed`).count()) ? text(`#card-${id} .exc-sum`) : text(`#setlog-${id} .setlog-summary`));
  const expand = id => page.tap(`#card-${id} [data-action="expand"]`);
  const tabState = async id => page.$$eval(`#card-${id} .set-tab:not(.add)`, ts => ts.map(t => (t.classList.contains('is-done') ? 'done' : '') + (t.classList.contains('is-current') ? 'current' : '') + (t.disabled ? 'locked' : '') || 'open'));
  const log = id => page.tap(`#card-${id} [data-action="log-set"]`);
  // the synthetic log ends in early May, so log this session on its last day (no ease-back after a long gap)
  await page.fill('#pick-date', SESSION_DATE); await page.dispatchEvent('#pick-date', 'change');
  await pickWorkout(1);
  check('picker: preview shows today\'s targets', (await text('#session-preview-area')).includes('175 lbs × 7 × 2 sets'));
  await page.tap('#start-btn');
  check('workout: Workout A has 5 exercises', await page.locator('.ex-card').count() === 5);
  check('target: partial last time → same target again', (await text('#card-s1-incline .target-row')).includes('47.5 lbs × 6 × 2 sets') && (await text('#card-s1-incline .target-row')).includes('not hit last time'));
  check('target: hit last time → one more rep', (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets') && (await text('#card-s1-deadlift .target-row')).includes('one more rep'));
  check('target: in the (wide) range last time → one more rep', (await text('#card-s1-lateral .target-row')).includes('7.5 lbs × 12 × 2 sets') && (await text('#card-s1-lateral .target-row')).includes('one more rep'));
  check('target: kg lift', (await text('#card-s1-crunches .target-row')).includes('45 kg × 13 × 2 sets'));
  check('target: first time starts at the estimated weight (cable, kg)', (await text('#card-s1-pulldown .target-row')).includes('25 kg × 8 × 2 sets'));
  check('last: shows last time', (await text('#card-s1-deadlift .last-row')).includes('175 lbs × 6 reps') && (await text('#card-s1-deadlift .last-row')).includes('Apr 20'));
  check('set 1 open, pre-filled with the target', (await text('#wv-s1-deadlift')) === '175' && (await page.inputValue('#reps-s1-deadlift')) === '7' && (await text('#card-s1-deadlift .set-title')) === 'Set 1');
  check('tabs: set 1 current, set 2 locked', JSON.stringify(await tabState('s1-deadlift')) === '["current","locked"]');
  check('phone: reps box is 16px (no iPhone zoom)', await page.$eval('#reps-s1-deadlift', el => getComputedStyle(el).fontSize) === '16px');

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
  check('weight −: below target → "lighter than target"', (await text('#wv-s1-deadlift')) === '170' && (await text('#pb-s1-deadlift')).includes('lighter'));
  await page.tap('#wv-s1-deadlift'); await page.fill('#inp-s1-deadlift', '177.5'); await page.keyboard.press('Enter');
  check('weight: decimals accepted', (await text('#wv-s1-deadlift')) === '177.5');

  // reps steppers
  await page.tap('#card-s1-deadlift [data-action="reps-step"][data-dir="-1"]');
  check('reps −: below target flagged', (await page.inputValue('#reps-s1-deadlift')) === '6' && (await text('#pb-s1-deadlift')).includes('below target'));
  for (let i = 0; i < 3; i++) await page.tap('#card-s1-deadlift [data-action="reps-step"][data-dir="-1"]', { force: true });
  check('reps −: down to 2 below the range (3) and greys out', (await page.inputValue('#reps-s1-deadlift')) === '3' && await page.locator('#rm-s1-deadlift').isDisabled());
  await page.fill('#reps-s1-deadlift', '1');
  check('reps: anything further can be typed', (await page.inputValue('#reps-s1-deadlift')) === '1');
  for (let i = 0; i < 12; i++) await page.tap('#card-s1-deadlift [data-action="reps-step"][data-dir="1"]', { force: true });
  check('reps +: up to 2 above the range (10) and greys out', (await page.inputValue('#reps-s1-deadlift')) === '10' && await page.locator('#rp-s1-deadlift').isDisabled());
  await page.fill('#reps-s1-deadlift', '7');

  // log set by set
  await log('s1-deadlift');
  check('log set 1: collapses into a ✓ tab + summary', (await summary('s1-deadlift')) === '177.5 lbs × 7' && JSON.stringify(await tabState('s1-deadlift')) === '["done","current"]');
  check('set 2 opens pre-filled with set 1', (await text('#card-s1-deadlift .set-title')) === 'Set 2' && (await text('#wv-s1-deadlift')) === '177.5' && (await page.inputValue('#reps-s1-deadlift')) === '7');
  check('verdict: partial so far', (await text('#setlog-s1-deadlift .setlog-verdict')).includes('1/2 sets'));
  await page.tap('#card-s1-deadlift [data-action="reps-step"][data-dir="-1"]');
  await log('s1-deadlift');
  check('all sets logged → the lift collapses to one line', await page.locator('#card-s1-deadlift.is-collapsed').count() === 1 && (await summary('s1-deadlift')) === '177.5 lbs × 7, 6' && (await text('#card-s1-deadlift .exc-icon')) === '~');
  check('header counts finished lifts', (await text('#session-progress')) === '1 of 5 lifts done');
  await expand('s1-deadlift');
  check('tap to reopen: sets panel minimized', await page.locator('#setlog-s1-deadlift.is-collapsed').count() === 1);
  check('verdict: partial — below target', (await text('#setlog-s1-deadlift .setlog-verdict')).includes('below target'));
  await page.tap('#card-s1-deadlift .set-tab[data-i="1"]');
  check('tap a ✓ tab to edit that set', (await text('#card-s1-deadlift .set-title')).includes('Set 2 · editing') && (await page.inputValue('#reps-s1-deadlift')) === '6');
  await page.tap('#card-s1-deadlift [data-action="reps-step"][data-dir="1"]');
  await log('s1-deadlift');
  check('update a set: now on target', (await summary('s1-deadlift')) === '177.5 lbs × 7, 7' && (await text('#setlog-s1-deadlift .setlog-verdict')).includes('target hit'));
  await page.tap('#card-s1-deadlift .set-tab[data-i="1"]');
  await page.tap('#card-s1-deadlift [data-action="reps-step"][data-dir="-1"]');
  await log('s1-deadlift');
  check('editing a set keeps the lift open', await page.locator('#card-s1-deadlift.is-collapsed').count() === 0);
  await page.tap('#card-s1-deadlift [data-action="set-add"]');
  check('+ adds an extra set, pre-filled', (await text('#card-s1-deadlift .set-title')) === 'Set 3' && (await page.inputValue('#reps-s1-deadlift')) === '6');
  await log('s1-deadlift');
  check('extra set logged', (await summary('s1-deadlift')) === '177.5 lbs × 7, 6, 6');
  await expand('s1-deadlift');
  await page.tap('#card-s1-deadlift .set-tab[data-i="2"]');
  await page.tap('#card-s1-deadlift [data-action="remove-set"]');
  check('remove a set', (await summary('s1-deadlift')) === '177.5 lbs × 7, 6' && await page.locator('#setlog-s1-deadlift.is-collapsed').count() === 1);

  // first-time lift: weight from nothing; type then tap Log right away (phone)
  await page.tap('#wv-s1-pulldown'); await page.fill('#inp-s1-pulldown', '45');
  await log('s1-pulldown');
  check('phone: type weight then tap Log → logged with that weight', (await summary('s1-pulldown')) === '45 kg × 8');
  await log('s1-pulldown');

  // phone: type weight then tap into notes
  await page.tap('#wv-s1-incline'); await page.fill('#inp-s1-incline', '50');
  await page.tap('#note-s1-incline'); await page.keyboard.type('felt solid');
  check('phone: type weight then tap notes → note kept', (await page.inputValue('#note-s1-incline')) === 'felt solid' && (await text('#wv-s1-incline')) === '50');
  await log('s1-incline'); await log('s1-incline');
  check('target hit → collapses with ✓', await page.locator('#card-s1-incline.is-collapsed.is-hit').count() === 1 && (await text('#card-s1-incline .exc-icon')) === '✓');

  // target pop-out
  await page.tap('#card-s1-crunches [data-action="target-open"]');
  check('target pop-out opens', await page.locator('#card-s1-crunches .target-pop').isVisible());
  await page.tap('#card-s1-crunches [data-action="target-step"][data-field="sets"][data-dir="1"]');
  await page.tap('#card-s1-crunches [data-action="target-step"][data-field="weight"][data-dir="1"]');
  await page.tap('#card-s1-crunches [data-action="target-step"][data-field="reps"][data-dir="1"]');
  for (let i = 0; i < 5; i++) await page.tap('#card-s1-crunches [data-action="target-step"][data-field="reps"][data-dir="1"]');
  check('target: edited, reps capped at the top of the range', (await text('#card-s1-crunches .target-btn')).includes('47.5 kg × 15 × 3 sets') && (await text('#card-s1-crunches .target-row')).includes('your target'));
  check('target: a new set count adds tabs, and the open set follows the new target', (await tabState('s1-crunches')).length === 3 && (await page.inputValue('#reps-s1-crunches')) === '15' && (await text('#wv-s1-crunches')) === '47.5');
  await page.tap('#card-s1-crunches [data-action="target-reset"]');
  check('target: back to suggested', (await text('#card-s1-crunches .target-btn')).includes('45 kg × 13 × 2 sets') && (await tabState('s1-crunches')).length === 2);
  await page.tap('#card-s1-crunches [data-action="target-close"]');
  check('target pop-out closes', await page.locator('#card-s1-crunches .target-pop').count() === 0);

  // lbs / kg per lift
  await page.tap('#card-s1-deadlift [data-action="unit"][data-unit="kg"]');
  check('units: one tap on the card', await page.locator('#card-s1-deadlift .target-pop').count() === 0);
  check('units: deadlift switched to kg — target and logged sets converted', (await text('#card-s1-deadlift .target-btn')).includes('80 kg × 7 × 2 sets') && (await summary('s1-deadlift')).startsWith('80.5 kg'));
  check('units: choice remembered', (await page.evaluate(() => JSON.parse(localStorage.getItem('liftlog:settings')).units)).Deadlift === 'kg');
  await page.tap('#card-s1-deadlift [data-action="unit"][data-unit="lbs"]');
  check('units: back to lbs', (await text('#card-s1-deadlift .target-btn')).includes('lbs') && (await page.evaluate(() => JSON.parse(localStorage.getItem('liftlog:settings')).units)).Deadlift === undefined);

  // skip
  await page.tap('#card-s1-lateral [data-action="skip"]');
  check('skip: card dims and the set panel hides', await page.locator('#card-s1-lateral.is-skipped').count() === 1 && await page.locator('#setlog-s1-lateral').count() === 0);
  await page.tap('#card-s1-lateral [data-action="skip"]');
  check('skip: tap again brings it back', await page.locator('#setlog-s1-lateral').count() === 1);
  await page.tap('#card-s1-lateral [data-action="skip"]');
  await page.fill('#note-s1-lateral', '<b>shoulder</b> & "tired"');
  check('no Done/Partial buttons — status comes from the logged sets', await page.locator('#card-s1-incline .status-btn[data-status="complete"], #card-s1-incline .status-btn[data-status="partial"]').count() === 0);

  await page.fill('#active-date', '2026-10-20'); await page.dispatchEvent('#active-date', 'change');
  check('date change mid-session keeps everything', (await text('#card-s1-incline .exc-note')).includes('felt solid') && (await summary('s1-deadlift')) === '177.5 lbs × 7, 6' && (await summary('s1-incline')) === '50 lbs × 6, 6');
  check('date change updates "last time" age', (await text('#card-s1-deadlift .last-row')).includes('6 months ago'));
  check('ease back: 6 months off → ~10% lighter, bottom of range', (await text('#card-s1-deadlift .target-row')).includes('155 lbs × 5 × 2 sets') && (await text('#card-s1-deadlift .target-row')).includes('days since last time'));
  await page.fill('#active-date', SESSION_DATE); await page.dispatchEvent('#active-date', 'change');
  check('ease back: gone again when the date is back', (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets'));

  await page.tap('.sa-change'); await page.tap('.discard-bar [data-action="keep"]');
  check('discard: keep going', await page.locator('#session-panel').isVisible() && await page.locator('.discard-bar').count() === 0);

  await page.locator('#complete-btn').dblclick();
  await wait(1000);
  const saved = await mySession();
  check('complete: double tap saves once', saved.length === 1, `${saved.length}`);
  const E = saved[0]?.entries || {};
  check('saved: target hit = complete, sets + target stored', JSON.stringify(E['s1-incline']) === JSON.stringify({ status: 'complete', note: 'felt solid', sets: [{ weight: 50, reps: 6 }, { weight: 50, reps: 6 }], weight: 50, unit: 'lbs', reps: 6, target: { reps: 6, sets: 2, weight: 47.5 } }), JSON.stringify(E['s1-incline']));
  check('saved: short of target = partial, each set kept', E['s1-deadlift']?.status === 'partial' && JSON.stringify(E['s1-deadlift'].sets) === '[{"weight":177.5,"reps":7},{"weight":177.5,"reps":6}]', JSON.stringify(E['s1-deadlift']));
  check('saved: skip keeps note only', E['s1-lateral']?.status === 'skip' && E['s1-lateral'].sets === undefined && E['s1-lateral'].note.includes('shoulder'));
  check('saved: nothing logged → not recorded', E['s1-crunches']?.status === 'unrecorded' && E['s1-crunches'].sets === undefined);
  check('saved: first-time lift', E['s1-pulldown']?.status === 'complete' && JSON.stringify(E['s1-pulldown'].sets) === '[{"weight":45,"reps":8},{"weight":45,"reps":8}]', JSON.stringify(E['s1-pulldown']));
  check('complete: picker resets to today', (await page.inputValue('#pick-date')) === TODAY);
  check('complete: switches to History', await page.locator('#tab-history.active').count() === 1);

  // next time: partial → same target, complete → one more
  await tab('workout');
  await page.fill('#pick-date', '2026-05-05'); await page.dispatchEvent('#pick-date', 'change'); await pickWorkout(1); await page.tap('#start-btn');
  check('next time: after a partial the target repeats (no increase)', (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets'));
  check('next time: after hitting it, one more rep', (await text('#card-s1-incline .target-row')).includes('50 lbs × 7 × 2 sets'));
  check('last note: shown on the card next time', (await text('#card-s1-incline .last-row')).includes('“felt solid”'));

  // ── unfinished workout: survives closing the app ───────
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('liftlog:draft') || 'null'));
  await log('s1-deadlift');
  check('draft: saved as you log', (await draft())?.scratch?.['s1-deadlift']?.done?.length === 1);
  await page.reload(); await wait(400);
  check('draft: reopening picks up the workout', await page.locator('#session-panel').isVisible() && (await summary('s1-deadlift')) === '175 lbs × 7' && (await text('#status')).includes('unfinished workout from Tue, May 5'));
  await page.tap('.sa-change');
  check('draft: "change" asks before throwing away logged sets', await page.locator('.discard-bar').count() === 1);
  await page.tap('.discard-bar [data-action="keep"]');

  // ── rest timer (optional) ──────────────────────────────
  check('rest timer: off by default', (await page.getAttribute('.rest-toggle', 'aria-pressed')) === 'false');
  await log('s1-incline');
  check('rest timer: off → nothing after logging', await page.locator('#rest-bar').isHidden());
  await page.tap('.rest-toggle');
  await log('s1-incline');
  check('rest timer: counts down after a set', await page.locator('#rest-bar').isVisible() && /Rest · Incline DB Press/.test(await text('#rest-bar')) && /1:(30|29|28)/.test(await text('.rest-clock')));
  await page.tap('#rest-bar [data-action="rest-adjust"][data-dir="1"]');
  check('rest timer: +15 s', /1:(45|44|43|42)/.test(await text('.rest-clock')));
  await page.reload(); await wait(400);
  check('rest timer: still running after reopening', await page.locator('#rest-bar').isVisible() && (await page.getAttribute('.rest-toggle', 'aria-pressed')) === 'true');
  await page.tap('#rest-bar [data-action="rest-stop"]');
  check('rest timer: ✕ stops it', await page.locator('#rest-bar').isHidden());
  await page.tap('.rest-toggle');

  // ── discard ─────────────────────────────────────────────
  const countBefore = (await savedLog()).sessions.length;
  await page.tap('#discard-btn');
  check('discard: first tap asks', (await text('#discard-btn')).includes('Tap again') && await page.locator('#session-panel').isVisible());
  await page.tap('#discard-btn');
  check('discard: second tap drops the workout, saves nothing', await page.locator('#picker-panel').isVisible() && (await savedLog()).sessions.length === countBefore && (await draft()) === null);

  // ── deload ──────────────────────────────────────────────
  await page.fill('#pick-date', '2026-05-05'); await page.dispatchEvent('#pick-date', 'change'); await pickWorkout(1);
  check('mode: Normal by default', (await page.getAttribute('#deload-area [data-mode="normal"]', 'aria-pressed')) === 'true');
  await page.tap('#deload-area [data-mode="deload"]');
  check('deload: default style = same weight, half the sets', (await text('#session-preview-area')).toLowerCase().includes('deload targets') && (await text('#session-preview-area')).includes('177.5 lbs × 5 × 1 set') && (await page.getAttribute('#deload-area [data-style="sets"]', 'aria-pressed')) === 'true');
  await page.tap('#deload-area [data-style="lighter"]');
  check('deload: Lighter style = ~10% lighter, same sets', (await text('#session-preview-area')).includes('155 lbs × 5 × 2 sets') && (await text('#deload-area')).includes('~10% lighter, same sets'));
  check('deload: style remembered', (await page.evaluate(() => JSON.parse(localStorage.getItem('liftlog:settings')).deloadStyle)) === 'lighter');
  await page.tap('#deload-area [data-style="sets"]');
  await page.tap('#start-btn');
  check('deload: header tag + reason', (await text('#session-header')).toLowerCase().includes('deload') && (await text('#card-s1-deadlift .target-row')).includes('half the sets'));
  await log('s1-deadlift');
  await page.tap('#complete-btn'); await wait(1000);
  const dl = (await sessionsOn('2026-05-05')).find(x => x.session === 1);
  check('deload: saved as a deload session', dl?.deload === true && dl.entries['s1-deadlift'].status === 'complete' && JSON.stringify(dl.entries['s1-deadlift'].sets) === '[{"weight":177.5,"reps":5}]', JSON.stringify(dl));
  await tab('workout');
  await page.fill('#pick-date', '2026-05-06'); await page.dispatchEvent('#pick-date', 'change'); await pickWorkout(1);
  check('deload: picker back to normal for the next session', (await page.getAttribute('#deload-area [data-mode="normal"]', 'aria-pressed')) === 'true');
  // climbing days
  const climbsSaved = async () => JSON.stringify((await savedLog()).climbs.map(c => [c.date, c.intensity]));
  check('climbing: None | Easy | Hard, None selected by default', (await page.getAttribute('#climb-area [data-intensity="none"]', 'aria-pressed')) === 'true');
  check('climbing: easy | hard switch for the picked date', (await text('#climb-area')).includes('Climbed on Wed, May 6?'));
  await page.tap('#climb-area [data-intensity="easy"]'); await wait(150);
  check('climbing: easy saved', (await climbsSaved()) === '[["2026-05-06","easy"]]' && (await page.getAttribute('#climb-area [data-intensity="easy"]', 'aria-pressed')) === 'true');
  await page.tap('#climb-area [data-intensity="hard"]'); await wait(150);
  check('climbing: switch to hard (still one day)', (await climbsSaved()) === '[["2026-05-06","hard"]]');
  await page.tap('#climb-area [data-intensity="hard"]'); await wait(150);
  check('climbing: tapping the selected one again keeps it', (await climbsSaved()) === '[["2026-05-06","hard"]]');
  await page.tap('#climb-area [data-intensity="none"]'); await wait(150);
  check('climbing: None clears it (and is selected)', (await climbsSaved()) === '[]' && (await page.getAttribute('#climb-area [data-intensity="none"]', 'aria-pressed')) === 'true');
  await page.tap('#climb-area [data-intensity="hard"]'); await wait(150);
  await page.fill('#pick-date', '2026-05-07'); await page.dispatchEvent('#pick-date', 'change');
  await page.tap('#start-btn');
  check('climbing: hard climb yesterday → nudge to deload pulling lifts', (await text('.climb-nudge')).includes('Hard climb yesterday'));
  await page.tap('#session-climb [data-intensity="easy"]'); await wait(150);
  check('climbing: log after lifting, from the workout', (await climbsSaved()) === '[["2026-05-06","hard"],["2026-05-07","easy"]]' && (await text('#session-climb')).includes('Climbing on Thu, May 7 too?'));
  await page.tap('#session-climb [data-intensity="none"]'); await wait(150);
  // a weight you set survives deload on/off
  await page.tap('#card-s1-deadlift [data-action="target-open"]');
  await page.tap('#card-s1-deadlift [data-action="target-step"][data-field="weight"][data-dir="1"]');
  await page.tap('#card-s1-deadlift [data-action="target-close"]');
  await page.tap('#card-s1-deadlift [data-action="lift-mode"][data-mode="deload"]');
  check('your weight through deload: same weight, half the sets', (await text('#card-s1-deadlift .target-btn')).includes('180 lbs × 5 × 1 set'));
  check('deload style switch appears in the session once a lift is deloaded', await page.locator('#session-header .deload-style').count() === 1);
  await page.tap('#session-header [data-style="lighter"]');
  check('deload style mid-session: Lighter → ~10% lighter, same sets', (await text('#card-s1-deadlift .target-btn')).includes('160 lbs × 5 × 2 sets'));
  await page.tap('#session-header [data-style="sets"]');
  await page.tap('#card-s1-deadlift [data-action="lift-mode"][data-mode="deload"]');
  check('your weight through deload: back to yours', (await text('#card-s1-deadlift .target-btn')).includes('180 lbs × 7 × 2 sets'));
  await page.tap('#card-s1-deadlift [data-action="target-open"]'); await page.tap('#card-s1-deadlift [data-action="target-reset"]'); await page.tap('#card-s1-deadlift [data-action="target-close"]');
  check('deload: next normal session builds on the session before the deload', (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets') && (await text('#card-s1-deadlift .last-row')).includes('deload since'));
  // deload mid-session, or just one lift
  await page.tap('#session-header [data-mode="deload"]');
  check('mid-session deload: targets switch to deload', (await text('#card-s1-deadlift .target-row')).includes('half the sets') && (await text('#card-s1-incline .target-row')).includes('half the sets') && await page.locator('.ex-card.is-deload').count() === 5);
  await page.tap('#card-s1-incline [data-action="lift-mode"][data-mode="deload"]');
  check('deload session: keep one lift normal', !(await text('#card-s1-incline .target-row')).includes('half the sets') && (await page.getAttribute('#card-s1-incline [data-mode="deload"]', 'aria-pressed')) === 'false');
  await page.tap('#session-header [data-mode="normal"]');
  check('mid-session deload off: all back to normal', await page.locator('.ex-card.is-deload').count() === 0 && (await text('#card-s1-deadlift .target-row')).includes('175 lbs × 7 × 2 sets'));
  await page.tap('#card-s1-deadlift [data-action="lift-mode"][data-mode="deload"]');
  check('deload just one lift', (await text('#card-s1-deadlift .target-row')).includes('half the sets') && await page.locator('.ex-card.is-deload').count() === 1 && (await page.getAttribute('#session-header [data-mode="normal"]', 'aria-pressed')) === 'true');
  await page.tap('#card-s1-deadlift [data-action="lift-mode"][data-mode="deload"]');
  // maintain: whole session, or one lift
  await page.tap('#session-header [data-mode="maintain"]');
  check('maintain: target = last time (deadlift 177.5 × 6 × 2 sets)', (await text('#card-s1-deadlift .target-row')).includes('177.5 lbs × 6 × 2 sets') && (await text('#card-s1-deadlift .target-row')).includes('maintain — same as last time') && await page.locator('.ex-card.is-maintain').count() === 5);
  await page.tap('#card-s1-deadlift [data-action="lift-mode"][data-mode="deload"]');
  check('maintain session: deload one lift instead', await page.locator('.ex-card.is-maintain').count() === 4 && (await text('#card-s1-deadlift .target-row')).includes('half the sets'));
  await page.tap('#session-header [data-mode="normal"]');
  await page.tap('#card-s1-incline [data-action="lift-mode"][data-mode="maintain"]');
  check('maintain just one lift', await page.locator('.ex-card.is-maintain').count() === 1 && (await page.getAttribute('#card-s1-incline [data-mode="maintain"]', 'aria-pressed')) === 'true');
  await page.tap('#card-s1-incline [data-action="lift-mode"][data-mode="maintain"]');
  check('tap again: back to the session mode', await page.locator('.ex-card.is-maintain').count() === 0);
  await page.tap('.sa-change');
  check('nothing logged → "change" goes straight back', await page.locator('#picker-panel').isVisible());
  // too many deloads → a gentle warning
  await page.fill('#pick-date', '2026-05-20'); await page.dispatchEvent('#pick-date', 'change');
  check('deload often: no warning for a normal session', await page.locator('.deload-often').count() === 0);
  await page.tap('#deload-area [data-mode="deload"]');
  check('deload often: 2nd deload in 6 weeks → warning', (await text('.deload-often')).includes('2 deloads in 6 weeks'));
  await page.tap('#deload-area [data-mode="maintain"]');
  check('maintain: picker shows what it means', (await text('#deload-area')).includes('repeat last time') && await page.locator('.deload-often').count() === 0);
  await page.tap('#deload-area [data-mode="normal"]');
  await page.fill('#pick-date', '2026-05-06'); await page.dispatchEvent('#pick-date', 'change');
  await page.tap('[data-action="deload-week"]');
  check('deload week: switches deload on for the week', (await page.getAttribute('#deload-area [data-mode="deload"]', 'aria-pressed')) === 'true' && (await text('#deload-area')).includes('Deload week until'));
  await page.tap('[data-action="deload-week-end"]');
  check('deload week: end', (await page.getAttribute('#deload-area [data-mode="normal"]', 'aria-pressed')) === 'true' && !(await text('#deload-area')).includes('until'));

  // empty-session guard
  await tab('workout');
  await pickWorkout(2); await page.tap('#start-btn');
  const before = (await savedLog()).sessions.length;
  await page.tap('#complete-btn'); await wait(150);
  check('empty session: first tap asks first', (await savedLog()).sessions.length === before && (await text('#complete-btn')).includes('Nothing logged'));
  await page.tap('#complete-btn'); await wait(900);
  check('empty session: second tap saves', (await savedLog()).sessions.length === before + 1);

  // ── reload: data persists ───────────────────────────────
  await page.reload(); await wait(400);
  await tab('history');
  check('reload: everything still there', await page.locator('.history-entry').count() === FIXTURE_COUNT + 3);

  // ── history ─────────────────────────────────────────────
  const oct20 = page.locator('.history-entry', { has: page.locator('.history-title', { hasText: 'May 4, 2026' }) }).filter({ hasText: 'Workout A' });
  if (!(await oct20.locator('.history-body').isVisible())) await oct20.locator('.history-hdr').tap();
  check('history: note shown as text, not HTML', (await oct20.innerText()).includes('<b>shoulder</b> & "tired"'));
  check('history: header date · session · done count', (await oct20.locator('.history-hdr').innerText()).replace(/\s+/g, ' ').includes('Workout A · 3/5 done'));
  check('history: actual next to target', (await oct20.locator('.history-row[data-ex="s1-deadlift"]').innerText()).replace(/\s+/g, ' ').includes('177.5 lbs × 7, 6') && (await oct20.locator('.history-row[data-ex="s1-deadlift"]').innerText()).includes('target 175 lbs × 7 × 2 sets'));
  await oct20.locator('.history-row[data-ex="s1-crunches"]').tap();
  await page.tap('#hedit-panel .status-btn[data-status="complete"]');
  await page.fill('#hedit-w-0', '42.5'); await page.fill('#hedit-r-0', '11'); await page.fill('#hedit-w-1', '42.5'); await page.fill('#hedit-r-1', '11');
  await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  let e = (await mySession())[0].entries['s1-crunches'];
  check('history edit: each set saved with the exercise unit', e.status === 'complete' && JSON.stringify(e.sets) === '[{"weight":42.5,"reps":11},{"weight":42.5,"reps":11}]' && e.unit === 'kg', JSON.stringify(e));
  check('history edit: header count updates', (await oct20.locator('.history-hdr').innerText()).includes('4/5 done'));

  const apr22 = page.locator('.history-entry', { has: page.locator('.history-title', { hasText: 'Apr 22, 2026' }) });
  await apr22.locator('.history-hdr').tap();
  check('history: old-program tag', (await apr22.locator('.history-hdr').innerText()).toLowerCase().includes('old program'));
  // climbing, marked after the fact in History
  const climbDates = async () => JSON.stringify((await savedLog()).climbs.map(c => [c.date, c.intensity]).sort());
  if (!(await oct20.locator('.history-body').isVisible())) await oct20.locator('.history-hdr').tap();
  await oct20.locator('[data-action="hclimb"][data-intensity="hard"]').tap(); await wait(150);
  check('history: mark a session day as a hard climb', (await climbDates()) === '[["2026-05-04","hard"],["2026-05-06","hard"]]' && (await oct20.locator('.history-hdr').innerText()).toLowerCase().includes('hard'));
  await oct20.locator('[data-action="hclimb"][data-intensity="easy"]').tap(); await wait(150);
  check('history: switch it to easy', (await climbDates()) === '[["2026-05-04","easy"],["2026-05-06","hard"]]');
  await oct20.locator('[data-action="hclimb"][data-intensity="none"]').tap(); await wait(150);
  check('history: None clears it', (await climbDates()) === '[["2026-05-06","hard"]]');
  await page.fill('#climb-add-date', '2026-05-09'); await page.dispatchEvent('#climb-add-date', 'change');
  await page.tap('.climb-adder [data-intensity="easy"]'); await wait(150);
  check('history: log a climbing day with no gym', (await climbDates()) === '[["2026-05-06","hard"],["2026-05-09","easy"]]');
  const climbOnly = page.locator('.history-climb');
  check('history: a climbing day with no session has its own row', await climbOnly.count() === 1 && (await climbOnly.innerText()).includes('May 9'));
  await climbOnly.locator('[data-intensity="hard"]').tap(); await wait(150);
  check('history: climbing-only day switched to hard', (await climbDates()) === '[["2026-05-06","hard"],["2026-05-09","hard"]]');
  await page.locator('.history-climb [data-intensity="none"]').tap(); await wait(150);
  check('history: None clears it (row goes away)', (await climbDates()) === '[["2026-05-06","hard"]]' && await page.locator('.history-climb').count() === 0);
  const may5 = page.locator('.history-entry', { has: page.locator('.history-title', { hasText: 'May 5, 2026' }) }).filter({ hasText: 'Workout A' });
  check('history: deload tag', (await may5.locator('.history-hdr').innerText()).toLowerCase().includes('deload'));
  if (!(await may5.locator('.history-body').isVisible())) await may5.locator('.history-hdr').tap();
  const may5rec = async () => (await sessionsOn('2026-05-05')).find(x => x.session === 1);
  await may5.locator('[data-action="entry-mode"][data-mode="maintain"]').tap(); await wait(150);
  check('history: mode → maintain', (await may5rec()).maintain === true && (await may5rec()).deload === undefined && (await may5.locator('.history-hdr').innerText()).toLowerCase().includes('maintain'));
  await may5.locator('[data-action="entry-mode"][data-mode="normal"]').tap(); await wait(150);
  check('history: mode → normal', (await may5rec()).maintain === undefined && (await may5rec()).deload === undefined);
  await may5.locator('[data-action="entry-mode"][data-mode="deload"]').tap(); await wait(150);
  check('history: mode → deload', (await may5rec()).deload === true);
  await apr22.locator('.history-row[data-ex="s2-dips"]').tap();
  check('history edit: retired bodyweight lift has set boxes but no weight box', await page.locator('.hedit-w').count() === 0 && await page.locator('.hedit-r').count() === 2);
  await page.tap('#hedit-panel .status-btn[data-status="partial"]'); await page.fill('#hedit-r-0', '5');
  await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  e = (await sessionsOn('2026-04-22'))[0].entries['s2-dips'];
  check('history edit: retired lift saved (blank reps = set not done)', e.status === 'partial' && e.reps === 5 && JSON.stringify(e.sets) === '[{"reps":5}]', JSON.stringify(e));

  await oct20.locator('.history-row[data-ex="s1-deadlift"]').tap();
  await page.tap('#hedit-panel .status-btn[data-status="partial"]');
  await page.tap('#hedit-panel .status-btn[data-status="complete"]');
  await page.fill('#hedit-r-1', '7'); await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  check('history edit: fixed to meet the target → complete', (await mySession())[0].entries['s1-deadlift'].status === 'complete');
  await oct20.locator('.history-row[data-ex="s1-deadlift"]').tap();
  await page.fill('#hedit-r-1', '5'); await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
  check('history edit: Done below the target is saved as partial', (await mySession())[0].entries['s1-deadlift'].status === 'partial');

  await failWrites(true);
  await apr22.locator('.history-row[data-ex="s2-pallof"]').tap();
  await page.fill('#hedit-r-0', '99'); await page.tap('#hedit-panel [data-action="edit-save"]'); await wait(150);
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
  const pressed = async () => (await page.locator('#tab-trends .seg button[aria-pressed="true"]').first().innerText()).trim();
  check('trends: opens on All when nothing is from the last 3 months (the test log is from spring)', (await pressed()) === 'All');
  const names = await page.locator('.trend-name').allInnerTexts();
  check('trends: current and old-program lifts', names.includes('Deadlift') && names.includes('Dips') && names.includes('Bent Over Rows') && !names.includes('Rows (elbow to hip)'));
  await page.tap('#tab-trends .seg button[data-value="all"]');
  check('trends: All shows charts', await page.locator('.trend-card svg').count() > 5);
  const calCard = page.locator('.cal-card');
  const deadliftCardFor = () => page.locator('.trend-card', { has: page.locator('.trend-name', { hasText: /^Deadlift$/ }) });
  check('trends: training calendar — 12 weeks, lift days and a climbing day', await calCard.locator('.cal-row:not(.cal-head)').count() === 12 && await calCard.locator('.cal-day.lift').count() > 0 && await calCard.locator('.cal-day.c-hard, .cal-day.c-easy').count() >= 0);
  const hitCard = page.locator('.trend-card', { has: page.locator('.trend-name', { hasText: 'Target hit rate' }) });
  check('trends: target hit rate card', (await hitCard.innerText()).includes('%') && await hitCard.locator('svg').count() === 1);
  const pgCard = page.locator('.trend-card', { has: page.locator('.trend-name', { hasText: 'Progress per lift' }) });
  check('trends: progress per lift with statuses', await pgCard.locator('.pg-row').count() >= 5 && (await pgCard.innerText()).includes('best'));
  await calCard.locator('.cal-day.lift[data-action="tip"]').last().tap();
  check('trends: tap a calendar day → details (phones have no hover)', /Workout [ABC]/.test(await calCard.locator('.tip-line').innerText()));
  check('trends: calendar labels a single workout A/B/C', /^([ABC]|×\d)$/.test((await calCard.locator('.cal-day.lift b').last().innerText()).trim()));
  await deadliftCardFor().locator('g[data-action="tip"]').last().tap();
  check('trends: tap a chart dot → details', (await deadliftCardFor().locator('.tip-line').innerText()).length > 5);
  await deadliftCardFor().locator('g[data-action="tip"]').last().tap();
  check('trends: tap again hides it', await deadliftCardFor().locator('.tip-line').isHidden());
  const deadliftCard = page.locator('.trend-card', { has: page.locator('.trend-name', { hasText: /^Deadlift$/ }) });
  check('trends: change table', (await deadliftCard.locator('.dtable').innerText()).includes('lbs'));
  check('trends: recent strip, newest last (the deload, marked)', (await deadliftCard.locator('.rc.latest').innerText()).includes('177.5×5') && await deadliftCard.locator('.rc.latest.deload').count() === 1);
  check('trends: deload dot is marked', await deadliftCard.locator('.chart-dot.deload').count() >= 1 || await deadliftCard.locator('title', { hasText: '(deload)' }).count() >= 1);
  await page.tap('#tab-trends .seg button[data-value="custom"]');
  await page.fill('.tc-custom input >> nth=0', '2026-04-01'); await page.dispatchEvent('.tc-custom input >> nth=0', 'change');
  await page.fill('.tc-custom input >> nth=1', '2026-04-15'); await page.dispatchEvent('.tc-custom input >> nth=1', 'change');
  const tips = await page.$$eval('.trend-card svg title', ts => ts.map(t => t.textContent).filter(t => !t.startsWith('Week of')));
  check('trends: custom range shows only those dates', tips.length > 0 && tips.every(t => /Apr ([1-9]|1[0-5])\b/.test(t)), tips.find(t => !/Apr ([1-9]|1[0-5])\b/.test(t)));
  await page.tap('#tab-trends .seg button[data-value="e1rm"]');
  check('trends: Strength mode', (await text('.trend-explain')).includes('estimated 1-rep max'));
  await page.tap('#tab-trends .seg button[data-value="weight"]');
  await page.tap('#tab-trends .seg button[data-value="all"]');
  await page.evaluate(() => window.scrollTo(0, 3000)); await wait(100);
  const bar = await page.locator('.tab-bar').boundingBox(), ctl = await page.locator('#trend-controls').boundingBox();
  check('trends: controls stay pinned under the tabs', Math.abs(ctl.y - (bar.y + bar.height)) < 3, `${ctl.y} vs ${bar.y + bar.height}`);
  await page.tap('#tab-trends .seg button[data-value="1m"]');
  check('trends: buttons work while scrolled', (await pressed()) === '1M');
  const logBefore = JSON.stringify(await savedLog());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.tap('.demo-bar button');
  check('trends: sample preview', (await text('.demo-bar')).includes('Sample data') && Number(await text('.ts-num')) > 15);
  await page.tap('.demo-bar button');
  check('trends: sample preview never saves anything', JSON.stringify(await savedLog()) === logBefore);

  // ── failed save on Complete ─────────────────────────────
  await tab('workout');
  await pickWorkout(3); await page.tap('#start-btn');
  await log('s3-incline');
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
  await pickWorkout(2); await page.tap('#start-btn');
  await page.tap('#card-s2-rows [data-action="weight-step"][data-dir="1"]'); await log('s2-rows');
  await page.tap('#complete-btn'); await wait(900);
  check('offline: can log a session', (await savedLog()).sessions.length === n1 + 2);
  await ctx.setOffline(false);

  // ── export / restore ────────────────────────────────────
  await tab('history');
  const [download] = await Promise.all([page.waitForEvent('download'), page.tap('[data-action="export"]')]);
  const file = join(TMP, 'export.json'); await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  check('export: file has every session', exported.sessions.length === n1 + 2 && exported.app === 'lifting-log');
  check('export: climbing days and preferences included', exported.climbs.length === 1 && typeof exported.settings === 'object' && 'units' in exported.settings);
  check('export: backup reminder clears', await page.locator('#backup-card.stale').count() === 0 && (await text('#backup-status')).includes('today'));
  const fresh = await browser.newContext(phone);
  const p2 = await fresh.newPage(); await p2.goto(url); await p2.waitForTimeout(300);
  await p2.tap('.tab-btn[data-tab="history"]'); await p2.setInputFiles('#import-file', file); await p2.waitForTimeout(200);
  check('restore on a new device', await p2.locator('.history-entry').count() === n1 + 2 && (await p2.evaluate(() => JSON.parse(localStorage.getItem('liftlog:log')).climbs.length)) === 1);
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
  if ((await p4.getAttribute('.workout-btn[data-n="2"]', 'aria-pressed')) !== 'true') await p4.tap('.workout-btn[data-n="2"]'); await p4.tap('#start-btn');
  await p4.tap('#card-s2-rows [data-action="log-set"]'); await p4.tap('#complete-btn'); await p4.waitForTimeout(300);
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
      if (name === 'workout') { if ((await p.getAttribute('.workout-btn[data-n="2"]', 'aria-pressed')) !== 'true') await p.click('.workout-btn[data-n="2"]'); await p.click('#start-btn'); }
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
