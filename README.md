# Lifting Log

A gym lifting log for a 3-session program with **double progression** (hit the top of the rep range → add weight → drop back to the bottom). It installs to your phone's home screen, works offline, and keeps your data on your device.

- **Workout** — pick a date and session; each exercise shows today's **target** (weight × reps × sets — tap it to adjust) and what you did last time. Log **one set at a time**: weight and reps start at the target, adjust with − / +, tap **Log set**. The set collapses into a ✓ tab and the next one opens pre-filled with what you just did. Tap a ✓ tab to fix a set, **+** to add one, or **Skip** the exercise.
- **Unfinished workouts are kept** — what you've logged is saved as you go, so closing the app mid-workout loses nothing; reopen and carry on. **Discard workout** (two taps) throws it away.
- **Rest timer** (optional, off by default) — turn it on in the session header; after each logged set a countdown runs at the bottom (90 s, deadlift 150 s; −15 / +15 / ✕). It beeps and vibrates where the phone allows — only while the app is open.
- **Deloads** — flip **Deload session** before starting (or the **Deload** switch mid-session if you're feeling weak), or **Deload week…** to keep it on for 7 days. **↓ Deload this lift** on a card deloads just that lift (or keeps one lift normal in a deload session) — useful when one area is beat up, e.g. pulling muscles after hard climbing. The app also suggests a deload week when you've trained a while without a break (see below). Deload sessions are tagged in History (where you can also mark or unmark one) and shown as hollow teal dots in Trends.
- **History** — every session, editable after the fact (status, weight, reps, notes, date), plus **Export / Import** backups.
- **Trends** — sessions per week, and for each lift: weight over time with reps on every dot, change over 1 month / 3 months / 1 year, and your last six sessions.

## How targets work (double progression)

- First time: the program's default weight × the bottom of the rep range.
- Hit the target last time → same weight, one more rep (never above the top of the range).
- Every set at the top of the range → add the increment from `INCREMENTS`, back to the bottom of the range.
- Missed the target (partial) → **the same target again**. No increase until you hit it. After 3 misses in a row at the same weight, the target note suggests ~10% lighter (you decide, with ✎).
- **Went lighter than the target on every set** (e.g. finding your weight) → the next target builds on the weight you actually used.
- Below the range last time → same weight, aim for the bottom of the range (or go lighter).
- **Back after a break** (more than 14 days since you last did the lift) → ~10% lighter, bottom of the range.
- **Deload** → ~10% lighter than last time, bottom of the range, half the sets (rounded up); stop 2–3 reps short of failure. Deload sessions **don't count toward progression** — the next normal session builds on the last session before the deload.

### When a deload is suggested

Common guidance is a deload every 4–8 weeks, lasting about a week. Because climbing adds fatigue, the app sits on the earlier side and suggests a deload week when either:

- **6+ weeks** of training without a break, or
- **4+ weeks** and **2+ lifts missed their target in their last 2 sessions** (stalling).

A gap of 7+ days or a deload resets the count. "Not now" hides the suggestion for a week.

Deloading **too often** is a signal too: turning on a deload when you've already had another deload in the last 6 weeks shows a note that it often points to hard climbing, short sleep, or targets rising too fast. All of these numbers are in `DELOAD` in `config/program.js`.

## lbs or kg

Each lift has a one-tap **lbs | kg** switch on its card, so the numbers match the machine's labels. The choice is remembered per lift (on this device). Past entries keep the unit they were logged in; targets, "last time" and Trends convert them to the unit you use now. Starting weights for lifts you've never logged (`defaultWeight`) are rough estimates — adjust with ✎ after the first session.

Only logged sets are saved. An exercise is **complete** when its logged sets meet the target (enough sets, each at least the target weight and reps), otherwise **partial**; with no sets logged it's "not recorded". Each set keeps its own weight, so drop sets are recorded as they happened. History shows what you did next to the target.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. **Share → Add to Home Screen**.
3. Open it **from the home-screen icon** (the icon and Safari keep separate storage).
4. To bring in an existing log: **History → Import** and pick a backup `.json` file.

## Your data

Everything is stored **on the device** (browser storage for this site). Nothing is sent anywhere — this repository only contains the app's code.

That also means the device is the only copy. Use **History → Export** regularly (the History tab nudges you after 14 days) and save the file to Files / iCloud Drive. **Import** merges a backup into the current log without creating duplicates.

Safeguards built in:

- **Local copies** — before every save the previous log is kept on the device (newest 3, capped at 600 KB). **History → Restore an earlier copy** undoes a bad edit; restoring keeps the current log as a copy too.
- **Upgrades are safe** — the saved format is versioned (`core/migrate.js`). Before an older format is upgraded, the original is copied aside, and every past format has a permanent fixture in `tests/fixtures/` that must keep loading.
- **No downgrades** — if an older copy of the app opens a log saved by a newer version, it shows a warning and refuses to save, so it can't drop fields it doesn't understand. Unknown fields are always preserved.

Storage use is small: about 0.5 KB per session (~70 KB per year of 3×/week training), against ~5 MB of browser storage.

## Changing the program

Edit [`js/config/program.js`](js/config/program.js). Each exercise has an `id`, `name`, `detail`, rep range, and optional default weight / unit. Rules:

- Never change an `id` once you've logged that exercise — saved logs refer to it.
- Exercises with the same `name` share "last time" and Trends across sessions.
- When you drop an exercise, move it to `RETIRED` so its history still shows.
- Weight increments (target bumps and the − / + buttons) live in `INCREMENTS`.
- The number of working sets is `DEFAULT_SETS` (change it to 3 when the program moves to 3 sets), or `sets` on a single exercise.

## Development

No build step: the files in this repo are exactly what the browser loads (plain ES modules).

```bash
npm install          # only needed for the end-to-end tests (Playwright)
npm start            # http://localhost:8080
npm test             # unit tests (Node's built-in test runner)
npm run test:e2e     # drives the real app in a phone-sized Chromium
```

First time running the end-to-end tests locally: `npx playwright install chromium`.

### Project structure

```
index.html              page shell (tabs + static markup)
sw.js                   offline support (caches the app files, network-first)
manifest.webmanifest    home-screen app metadata
css/
  tokens.css            every color, light + dark (components never use raw colors)
  base.css              reset, tabs, shared components
  workout.css  history.css  trends.css
js/
  main.js               wires storage, the log and the three screens
  config/program.js     ← the training program
  core/                 pure logic, no DOM — fully unit-tested
    dates.js            calendar-day helpers ("YYYY-MM-DD" everywhere)
    numbers.js          parsing / rounding / est. 1RM
    exercises.js        lookups over the program
    records.js          the saved-session shape (per-set reps + target), statuses
    log.js              immutable add / edit / delete / merge operations
    migrate.js          reads any saved or exported format → current schema
    progress.js         last time, today's target, − / + steps, the live badge
    trends.js           series, grouping, change over time, weekly counts
    deload.js           when to suggest a deload, deload week on/off
  data/
    storage.js          localStorage wrapper (+ in-memory version for tests)
    repository.js       the one place the log is saved: save-then-update, local copies, read-only guard
    backup.js           export / import files, backup reminder
    draft.js            the workout in progress (saved on every change, cleared on complete/discard)
    settings.js         per-device preferences (rest timer, deload week) — not in backups
  ui/                   one module per screen, plus shared helpers
    dom.js  charts.js  tabs.js  workout.js  history.js  trends.js  rest-timer.js
  dev/demo.js           sample data for the Trends preview (never saved)
tests/
  unit/                 logic tests
  e2e/                  end-to-end tests + a tiny static server
  fixtures/             sample log (made up) + one file per past save format
```

### Conventions

- **Logic in `core/`, screens in `ui/`.** Anything that can be a pure function lives in `core/` and gets a unit test.
- **No inline event handlers.** Screens use `delegate()` from `ui/dom.js` with `data-action` attributes.
- **Saves go through `repository.commit(next)`**, which saves first and only updates the screens if the save worked. Log operations in `core/log.js` return new arrays and never mutate.
- **Escape user text** with `esc()` before putting it in HTML.
- **Adding a file under `js/` or `css/`?** Add it to `APP_FILES` in `sw.js` (a unit test fails if you forget).
- **Changing the saved shape?** Bump `SCHEMA_VERSION` in `core/migrate.js` and handle the old shape there.

## Deploying

GitHub Pages serves the `main` branch as-is. Push to `main` and the installed app picks up the new version the next time it's opened with a connection. Tests run on every push (see `.github/workflows/test.yml`).
