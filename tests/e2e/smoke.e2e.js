/**
 * Smoke tests: the basics that must never break, checked on a clean phone in several setups
 * (small and normal screens, light and dark, fresh install and with a log). Short and blunt on
 * purpose — if any of these fail, the app is unusable.
 *
 * Run: npm run test:smoke
 *   SMOKE_FILE=path/to/preview.html  → test a single-file preview build instead of the repo
 *   CHROMIUM_PATH=…                  → use a specific Chromium binary
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(join(HERE, '..', 'fixtures', 'schema-v4.json'), 'utf8');

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed++; else failures.push(`${name}${detail ? ` → ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` → ${detail}` : ''}`);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Serve the repo, or a preview file wrapped the way Claude's viewer wraps it. */
async function serve() {
  if (!process.env.SMOKE_FILE) return startServer();
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${readFileSync(process.env.SMOKE_FILE, 'utf8')}</body></html>`;
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const { server, url } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_PATH ? ['--headless=new'] : [],
});

const SETUPS = [
  { name: 'small phone · light · fresh', viewport: { width: 320, height: 568 }, colorScheme: 'light', seed: null },
  { name: 'phone · dark · with a log', viewport: { width: 390, height: 844 }, colorScheme: 'dark', seed: SAMPLE },
  { name: 'tablet · light · with a log', viewport: { width: 768, height: 1024 }, colorScheme: 'light', seed: SAMPLE },
];

for (const setup of SETUPS) {
  const ctx = await browser.newContext({ viewport: setup.viewport, colorScheme: setup.colorScheme, isMobile: setup.viewport.width < 600, hasTouch: true });
  if (setup.seed) await ctx.addInitScript(seed => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('liftlog:log', seed); sessionStorage.setItem('seeded', '1'); } }, setup.seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const tag = s => `[${setup.name}] ${s}`;
  const visible = sel => page.locator(sel).first().isVisible();
  const inView = async sel => {
    const box = await page.locator(sel).first().boundingBox();
    return !!box && box.x >= 0 && box.x + box.width <= setup.viewport.width + 1 && box.width > 40 && box.height > 20;
  };
  const sessions = async () => (JSON.parse(await page.evaluate(() => localStorage.getItem('liftlog:log') || '{"sessions":[]}')).sessions || []).length;

  await page.goto(url); await wait(400);

  // ── the picker ──────────────────────────────────────────
  check(tag('picker: start button visible, enabled, on screen'), await visible('#start-btn') && await page.isEnabled('#start-btn') && await inView('#start-btn'));
  check(tag('picker: start button names the workout'), /^Start Workout [ABC]$/.test((await page.innerText('#start-btn')).trim()));
  check(tag('picker: three workouts to choose from'), await page.locator('.workout-btn').count() === 3);
  const picked = await page.locator('.workout-btn[aria-pressed="true"]').getAttribute('data-n');
  await page.tap(`.workout-btn[data-n="${picked}"]`);
  check(tag('picker: tapping the picked workout again keeps Start ready'), await page.isEnabled('#start-btn') && await page.locator('.workout-btn[aria-pressed="true"]').count() === 1);
  check(tag('picker: no sideways scrolling'), await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // ── every workout can be started, logged and saved ─────
  for (const n of [1, 2, 3]) {
    const before = await sessions();
    await page.tap(`.workout-btn[data-n="${n}"]`);
    check(tag(`workout ${n}: preview of today's targets`), await page.locator('.preview-ex').count() >= 4);
    await page.tap('#start-btn'); await wait(150);
    check(tag(`workout ${n}: session opens with lift cards`), await visible('#session-panel') && await page.locator('.ex-card').count() >= 4 && !(await visible('#picker-panel')));
    const logBtn = page.locator('[data-action="log-set"]').first();
    check(tag(`workout ${n}: Log set button on screen`), await logBtn.isVisible() && await inView('[data-action="log-set"]'));
    await logBtn.tap(); await wait(100);
    check(tag(`workout ${n}: logging a set counts it`), /\d+ lbs|\d+ kg|\d+ reps/.test(await page.locator('.setlog-summary').first().innerText()));
    await page.locator('.ex-card:not(.is-collapsed) .ex-min-btn').nth(1).tap(); await wait(60);
    const minimized = page.locator('.ex-card.is-collapsed.is-todo');
    check(tag(`workout ${n}: any lift can be minimized and opened again`), await minimized.count() === 1 && (await minimized.locator('[data-action="expand"]').tap(), await wait(60), await page.locator('.ex-card.is-todo').count() === 0));
    const lastCard = page.locator('.ex-card').last();
    await lastCard.locator('[data-action="skip"]').tap(); await wait(80);
    check(tag(`workout ${n}: Skip minimizes the lift, greyed out`), await page.locator('.ex-card').last().evaluate(el => el.classList.contains('is-collapsed') && el.classList.contains('is-skipped')));
    check(tag(`workout ${n}: Complete and Discard are there`), await page.locator('#complete-btn').count() === 1 && await page.locator('#discard-btn').count() === 1);
    await page.tap('#complete-btn'); await wait(900);
    check(tag(`workout ${n}: Complete saves it`), await sessions() === before + 1);
    check(tag(`workout ${n}: then shows it in History`), await page.locator('#tab-history').isVisible());
    await page.tap('.tab-btn[data-tab="workout"]'); await wait(100);
    check(tag(`workout ${n}: back to the picker with Start`), await visible('#picker-panel') && await visible('#start-btn') && await page.isEnabled('#start-btn'));
  }

  // ── an unfinished workout survives a reload, and can be discarded ──
  await page.tap('#start-btn'); await page.locator('[data-action="log-set"]').first().tap(); await wait(100);
  await page.reload(); await wait(400);
  check(tag('resume: an unfinished workout comes back after reload'), await visible('#session-panel') && /\d/.test(await page.locator('.setlog-summary').first().innerText()));
  const before = await sessions();
  await page.tap('#discard-btn'); await wait(100); await page.tap('#discard-btn'); await wait(200);
  check(tag('discard: back to the picker, nothing saved'), await visible('#start-btn') && await sessions() === before);

  // ── the other tabs ──────────────────────────────────────
  await page.tap('.tab-btn[data-tab="history"]'); await wait(150);
  check(tag('history: saved workouts listed, backup buttons there'), await page.locator('.history-entry').count() >= 3 && await visible('[data-action="export"]') && await visible('[data-action="copy-log"]'));
  await page.tap('.tab-btn[data-tab="trends"]'); await wait(200);
  check(tag('trends: renders charts'), await page.locator('#tab-trends svg').count() > 0);
  await page.tap('.tab-btn[data-tab="workout"]'); await wait(100);
  check(tag('workout tab: Start still there after visiting other tabs'), await visible('#start-btn'));

  check(tag('no JavaScript errors'), errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map(f => `  ✗ ${f}`).join('\n')); process.exit(1); }
