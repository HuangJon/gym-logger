/**
 * The training program. This is the file to edit when the program changes.
 *
 * Exercise fields
 *   id             stable key used in saved logs — never change it once you've logged the exercise
 *   name           display name; exercises with the same name share "last time" and Trends across sessions
 *   detail         sets × reps text shown under the name
 *   reps           [low, high] target rep range for double progression
 *   sets           number of working sets (defaults to DEFAULT_SETS)
 *   defaultWeight  starting weight before anything is logged (optional) — a rough estimate; adjust with ✎
 *   unit           'lbs' (default) or 'kg'
 *   bw             true for bodyweight exercises (no weight box)
 *   rest           seconds of rest between sets for the rest timer (defaults to DEFAULT_REST_SECONDS)
 *   tag / warn     optional small labels on the card
 *
 * Removing an exercise from the program? Move it to RETIRED so old logs still show up.
 */

export const PREHAB = {
  title: 'Every Session — Prehab',
  sets: '2×10 each',
  exercises: ['Straight arm pulls', 'External rotation', 'Internal rotation', 'Face pulls'],
};

export const SESSIONS = {
  1: [
    { id: 's1-incline',  name: 'Incline DB Press',          detail: '2×6–12',               reps: [6, 12],  defaultWeight: 50 },
    { id: 's1-deadlift', name: 'Deadlift',                  detail: '2×5–8 · 2–3 min rest', reps: [5, 8],   defaultWeight: 185, rest: 150 },
    { id: 's1-lateral',  name: 'Cable Lateral Raises',      detail: '2×8–15',               reps: [8, 15],  defaultWeight: 5, tag: 'circuit' },
    { id: 's1-crunches', name: 'Cable Crunches',            detail: '2×10–15',              reps: [10, 15], unit: 'kg', tag: 'circuit' },
    { id: 's1-pulldown', name: 'Single Arm Cable Pulldown', detail: '2×8–12',               reps: [8, 12],  defaultWeight: 25, unit: 'kg' },
  ],
  2: [
    { id: 's2-ohpress',   name: 'DB Shoulder Press',    detail: '2×6–10',         reps: [6, 10], defaultWeight: 30, warn: '⚠ zero soreness first' },
    { id: 's2-rows',      name: 'Bent Over Rows',       detail: '2×6–12',         reps: [6, 12], defaultWeight: 35 },
    { id: 's2-lateral',   name: 'Cable Lateral Raises', detail: '2×8–15',         reps: [8, 15],  defaultWeight: 5, tag: 'circuit' },
    { id: 's2-pallof',    name: 'Pallof Press',         detail: '2×5 × 5s holds', reps: [5, 5], unit: 'kg', tag: 'circuit' },
    { id: 's2-legraiser', name: 'Hanging Leg Raises',   detail: '2×8–12',         reps: [8, 12], bw: true },
  ],
  3: [
    { id: 's3-incline',  name: 'Incline DB Press',       detail: '2×6–12',                   reps: [6, 12],  defaultWeight: 50 },
    { id: 's3-bss',      name: 'Bulgarian Split Squats', detail: '2×5–8',                    reps: [5, 8],   defaultWeight: 15 },
    { id: 's3-lateral',  name: 'Cable Lateral Raises',   detail: '2×8–15',                   reps: [8, 15],  defaultWeight: 5, tag: 'circuit' },
    { id: 's3-crunches', name: 'Cable Crunches',         detail: '2×10–15',                  reps: [10, 15], unit: 'kg', tag: 'circuit' },
    { id: 's3-abwheel',  name: 'Ab Wheel',               detail: '2×8–10 · if feeling good', reps: [8, 10],  bw: true },
  ],
};

/** Exercises from earlier programs: not in today's workout, but their logs still show in History and Trends. */
export const RETIRED = [
  { id: 's2-dips',    name: 'Dips',                detail: 'old program · 3×6–12', reps: [6, 12], bw: true },
  { id: 's2-oldrows', name: 'Bent Over Rows', detail: 'old program · 3×6–12', reps: [6, 12] },   // same lift as today's rows: shares last time + Trends
];

/** Double progression: how much to add once you hit the top of the rep range (in the exercise's unit). */
export const INCREMENTS = {
  'Incline DB Press': 5, 'Bent Over Rows': 2.5, 'Cable Lateral Raises': 2.5, 'Cable Crunches': 2.5,
  'Deadlift': 5, 'Bulgarian Split Squats': 5, 'DB Shoulder Press': 5,
};
export const DEFAULT_INCREMENT = 2.5;

/** Working sets per exercise unless an exercise sets its own `sets`. Change to 3 when the program moves to 3 sets. */
export const DEFAULT_SETS = 2;

export const SESSION_LABELS = { 1: 'Session 1', 2: 'Session 2', 3: 'Session 3' };
export const SESSION_COLORS = { 1: 'var(--s1)', 2: 'var(--s2)', 3: 'var(--s3)' };

/** A "Last time" older than this many days gets an "ease back in" note. */
export const STALE_AFTER_DAYS = 14;
/** Target sessions per week (dashed line on the weekly chart). */
export const WEEKLY_GOAL = 3;

/** Rest timer: seconds between sets unless an exercise sets its own `rest`. The timer is off until you turn it on. */
export const DEFAULT_REST_SECONDS = 90;

/** Coming back after this many days without doing a lift → its target is eased back. */
export const EASE_BACK_FACTOR = 0.9;   // ~10% lighter, bottom of the rep range

/** Deload: lighter weight, fewer sets, easy reps. Deload sessions don't count toward progression. */
export const DELOAD = {
  weightFactor: 0.9,        // ~10% lighter, rounded to the lift's step
  setsFactor: 0.5,          // half the sets, rounded up
  weekDays: 7,              // "Deload week" covers this many days
  breakDays: 7,
  frequentWindowWeeks: 6,   // warn when choosing a deload if there have been…
  frequentStretches: 2,     // …this many separate deload stretches in that window (including this one)             // a gap this long between sessions counts as a break (resets the count)
  // Usual guidance is a deload every 4–8 weeks; this sits on the earlier side because climbing adds fatigue.
  suggestAfterWeeks: 4,     // suggest a deload after this many weeks without a break if lifts are stalling…
  stalledLifts: 2,          // …this many lifts missed target in their last 2 sessions
  alwaysAfterWeeks: 6,      // …or after this many weeks regardless
  snoozeDays: 7,            // "Not now" hides the suggestion this long
};
