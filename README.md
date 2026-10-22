# Lifting Log

A gym lifting log for a 3-session program with **double progression** (hit the top of the rep range → add weight → drop back to the bottom). It installs to your phone's home screen, works offline, and keeps your data on your device.

- **Workout** — three workouts, **A · B · C**, done in rotation: the next one is pre-selected ("up next"), and each button says when you last did it. Each exercise shows today's **target** (weight × reps × sets — tap it to adjust) and what you did last time. Log **one set at a time**: weight and reps start at the target, adjust with − / +, tap **Log set**. When every set is logged the lift **collapses to one line** (tap to reopen) and the header counts "3 of 5 lifts done". Tap a ✓ tab to fix a set, **+** to add one, or **Skip** the exercise. Dates can't be in the future.
- **Unfinished workouts are kept** — what you've logged is saved as you go, so closing the app mid-workout loses nothing; reopen and carry on. **Discard workout** (two taps) throws it away.
- **Rest timer** (optional, off by default) — turn it on in the session header; after each logged set a countdown runs at the bottom (90 s, circuit lifts — laterals and ab work — 45 s; −15 / +15 / ✕). It beeps and vibrates where the phone allows — only while the app is open.
- **Normal | Maintain | Deload** — pick a mode for the whole session (before starting or mid-session), or tap **↓ Deload** / **= Maintain** on a card for just that lift. **Maintain** repeats last time's numbers (an off day — hitting them counts as done, not a miss); **Deload** is planned recovery. **Deload week…** keeps Deload on for 7 days.
- **Climbing days** — a **None | Easy | Hard** switch under the session picker (any date) and at the end of a workout (since you climb after lifting). In **History** you can log a climbing day for any date (rest days with no gym too) and switch easy/hard on any session. Climbing days also show as ▲ on the weekly chart in Trends. A hard climb the day before brings up a reminder to deload pulling lifts if you're beat up, and 4+ hard days in two weeks brings the deload suggestion a week earlier.
- **Last time's note** shows on each card, so "grip slipped" is in front of you next session.
- **Updates** — when a new version is installed while the app is open, a banner offers a one-tap refresh (a workout in progress is kept).
- **History** — every session, editable after the fact (status, weight, reps, notes, date), plus **Export / Import** backups.
- **Trends** — sessions per week (with climbing days), a 12-week **training calendar** (lift days by session, maintain / deload days, easy / hard climbs), **target hit rate** per week (normal sessions — a steady drop is an early fatigue sign) with the day after a hard climb vs other days, **progress per lift** (best set, recent PRs, last progressed, stalled / holding / top of range), and for each lift: weight over time with reps on every dot, change over 1 month / 3 months / 1 year, and your last six sessions.

## How targets work (double progression)

- First time: the program's default weight × the bottom of the rep range.
- Hit the target last time → same weight, one more rep (never above the top of the range).
- Every set at the top of the range → add the increment from `INCREMENTS`, back to the bottom of the range.
- Missed the target (partial) → **the same target again**. No increase until you hit it. After 3 misses in a row at the same weight, the target note suggests ~10% lighter (you decide, with ✎).
- **Went lighter than the target on every set** (e.g. finding your weight) → the next target builds on the weight you actually used.
- Below the range last time → same weight, aim for the bottom of the range (or go lighter).
- **Back after a break** (more than 14 days since you last did the lift) → ~10% lighter, bottom of the range.
- **Deload** → bottom of the range, stop 2–3 reps short of failure, and one of two styles (switch in the app): **Fewer sets** (default) — same weight, half the sets (rounded up); or **Lighter** — ~10% lighter, same sets (falls back to fewer sets if the weight is too light to drop a step). After a long break a deload starts from the eased weight. Deload sessions **don't count toward progression** — the next normal session builds on the last session before the deload.

### When a deload is suggested

Common guidance is a deload every 4–8 weeks, lasting about a week. Because climbing adds fatigue, the app sits on the earlier side and suggests a deload week when either:

- **6+ weeks** of training without a break, or
- **4+ weeks** and **2+ lifts missed their target in their last 2 sessions** (stalling).

A gap of 7+ days or a deload resets the count. "Not now" hides the suggestion for a week.

Easing off is a signal too, at two levels:

- **Whole-body** — a session counts as a *maintain day* (or *deload day*) when **more than half the lifts you did** were on Maintain (or Deload), whether set for the session or lift by lift. Picking Maintain for the 4th time in 4 weeks (since your last deload) shows a warning, and 4 maintain days in 4 weeks triggers the deload suggestion.
- **One lift** — if the same lift was eased off on its own (Maintain / Deload on just that lift) **3 sessions in a row**, its card says that lift may be beat up (e.g. from climbing) or its target too high, and suggests ~10% lighter for a fresh run. Whole-session easy days are passed over, so a deload week doesn't trigger it. Deloading **too often** is a signal too: turning on a deload when you've already had another deload in the last 6 weeks shows a note that it often points to hard climbing, short sleep, or targets rising too fast. All of these numbers are in `DELOAD` in `config/program.js`.

## lbs or kg

Each lift has a one-tap **lbs | kg** switch on its card, so the numbers match the machine's labels. The choice is remembered per lift (on this device). Past entries keep the unit they were logged in; targets, "last time" and Trends convert them to the unit you use now. Starting weights for lifts you've never logged (`defaultWeight`) are rough estimates — adjust with ✎ after the first session.

Only logged sets are saved. An exercise is **complete** when its logged sets meet the target (enough sets, each at least the target weight and reps), otherwise **partial**; with no sets logged it's "not recorded". Each set keeps its own weight, so drop sets are recorded as they happened. History shows what you did next to the target.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. **Share → Add to Home Screen**.
3. Open it **from the home-screen icon** (the icon and Safari keep separate storage).
4. To bring in an existing log: **History → Import** and pick a backup `.json` file.

## Your data

Everything is stored **on the device** — sessions, climbing days and preferences (browser storage for this site). Nothing is sent anywhere — this repository only contains the app's code.

That also means the device is the only copy. Use **History → Export** regularly (the file includes climbing days and your lbs/kg choices) (the History tab nudges you after 14 days) and save the file to Files / iCloud Drive. **Import** merges a backup into the current log without creating duplicates.

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
- The number of working sets is `DEFAULT_SETS` (2), or `sets` on a single exercise — the pressing lifts and split squats use 3; pulling lifts stay at 2 because climbing adds plenty of pulling.

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
    climbs.js           climbing days
    insights.js         Trends extras: training calendar, target hit rate, progress / PRs per lift
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
- **Releasing?** Bump `CACHE` in `sw.js` (e.g. `liftlog-v5` → `liftlog-v6`) so phones with the app open see the "new version — Refresh" banner.
- **Changing the saved shape?** Bump `SCHEMA_VERSION` in `core/migrate.js` and handle the old shape there.

## Deploying

GitHub Pages serves the `main` branch as-is. Push to `main` and the installed app picks up the new version the next time it's opened with a connection. Tests run on every push (see `.github/workflows/test.yml`).
