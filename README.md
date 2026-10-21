# Lifting Log

A gym lifting log for a 3-session program with **double progression** (hit the top of the rep range → add weight → drop back to the bottom). It installs to your phone's home screen, works offline, and keeps your data on your device.

- **Workout** — pick a date and session, see what you did last time and what to do today, log weight / reps / notes, mark each exercise Done, Partial or Skip.
- **History** — every session, editable after the fact (status, weight, reps, notes, date), plus **Export / Import** backups.
- **Trends** — sessions per week, and for each lift: weight over time with reps on every dot, change over 1 month / 3 months / 1 year, and your last six sessions.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. **Share → Add to Home Screen**.
3. Open it **from the home-screen icon** (the icon and Safari keep separate storage).
4. To bring in an existing log: **History → Import** and pick a backup `.json` file.

## Your data

Everything is stored **on the device** (browser storage for this site). Nothing is sent anywhere — this repository only contains the app's code.

That also means the device is the only copy. Use **History → Export** regularly (the History tab nudges you after 14 days) and save the file to Files / iCloud Drive. **Import** merges a backup into the current log without creating duplicates.

## Changing the program

Edit [`js/config/program.js`](js/config/program.js). Each exercise has an `id`, `name`, `detail`, rep range, and optional default weight / unit. Rules:

- Never change an `id` once you've logged that exercise — saved logs refer to it.
- Exercises with the same `name` share "last time" and Trends across sessions.
- When you drop an exercise, move it to `RETIRED` so its history still shows.
- Weight increments for "↑ add N lbs today" live in `INCREMENTS`.

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
    records.js          the saved-session shape, statuses, building a record
    log.js              immutable add / edit / delete / merge operations
    migrate.js          reads any saved or exported format → current schema
    progress.js         last time, pre-filled weight, progression hints
    trends.js           series, grouping, change over time, weekly counts
  data/
    storage.js          localStorage wrapper (+ in-memory version for tests)
    repository.js       the one place the log is saved; save-then-update
    backup.js           export / import files, backup reminder
  ui/                   one module per screen, plus shared helpers
    dom.js  charts.js  tabs.js  workout.js  history.js  trends.js
  dev/demo.js           sample data for the Trends preview (never saved)
tests/
  unit/                 logic tests
  e2e/                  end-to-end tests + a tiny static server
  fixtures/             sample log (made up)
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
