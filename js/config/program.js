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
 *   pickOne        exercises in the same workout with the same pickOne name: do at least one, the rest are optional
 *   climb          true if climbing loads the same muscles (back, biceps, grip) — named in the after-climbing tip
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
    { id: 's1-incline',  name: 'Incline DB Press',          detail: '3×6–12',               reps: [6, 12],  defaultWeight: 50, sets: 3 },
    { id: 's1-deadlift', name: 'Deadlift',                  detail: '2×5–8',                reps: [5, 8],   defaultWeight: 185, climb: true },
    { id: 's1-lateral',  name: 'Cable Lateral Raises',      detail: '2×8–15',               reps: [8, 15],  defaultWeight: 7, stack: 'cable', tag: 'circuit' },
    { id: 's1-crunches', name: 'Cable Crunches',            detail: '2×10–15',              reps: [10, 15], defaultWeight: 43, stack: 'cable', tag: 'circuit' },
  ],
  2: [
    { id: 's2-ohpress',   name: 'DB Shoulder Press',    detail: '3×6–12',         reps: [6, 12], defaultWeight: 30, sets: 3, warn: '⚠ zero soreness first' },
    { id: 's2-rows',      name: 'Bent Over Rows',       detail: '2×6–12',         reps: [6, 12], defaultWeight: 35, climb: true },
    { id: 's2-lateral',   name: 'Cable Lateral Raises', detail: '2×8–15',         reps: [8, 15],  defaultWeight: 7, stack: 'cable', tag: 'circuit' },
    { id: 's2-pallof',    name: 'Pallof Press',         detail: '2×5 × 5s holds', reps: [5, 5], defaultWeight: 23, stack: 'cable', tag: 'circuit' },
    { id: 's2-legraiser', name: 'Hanging Leg Raises',   detail: '2×8–12',         reps: [8, 12], bw: true, tag: 'circuit', climb: true },
  ],
  3: [
    { id: 's3-incline',  name: 'Incline DB Press',       detail: '3×6–12',                   reps: [6, 12],  defaultWeight: 50, sets: 3 },
    { id: 's3-bss',      name: 'Bulgarian Split Squats', detail: '3×5–10',                   reps: [5, 10],   defaultWeight: 15, sets: 3 },
    { id: 's3-pulldown', name: 'Single Arm Cable Pulldown', detail: '2×8–12',                reps: [8, 12],   defaultWeight: 50, stack: 'cable', climb: true },
    { id: 's3-lateral',  name: 'Cable Lateral Raises',   detail: '2×8–15',                   reps: [8, 15],  defaultWeight: 7, stack: 'cable', tag: 'circuit' },
    { id: 's3-crunches', name: 'Cable Crunches',         detail: '2×10–15 · or ab wheel',    reps: [10, 15], defaultWeight: 43, stack: 'cable', tag: 'circuit', pickOne: 'core' },
    { id: 's3-abwheel',  name: 'Ab Wheel',               detail: '2×8–10 · or crunches',      reps: [8, 10],   bw: true, tag: 'circuit', pickOne: 'core' },
  ],
};

/** Exercises from earlier programs: not in today's workout, but their logs still show in History and Trends. */
export const RETIRED = [
  { id: 's1-pulldown', name: 'Single Arm Cable Pulldown', detail: 'moved to Workout C', reps: [8, 12], stack: 'cable', climb: true },
  { id: 's2-dips',    name: 'Dips',                detail: 'old program · 3×6–12', reps: [6, 12], bw: true },
  { id: 's2-oldrows', name: 'Bent Over Rows', detail: 'old program · 3×6–12', reps: [6, 12] },   // same lift as today's rows: shares last time + Trends
];

/** Double progression: how much to add once you hit the top of the rep range (in the exercise's unit). */
export const INCREMENTS = {
  'Incline DB Press': 5, 'Bent Over Rows': 5, 'Cable Lateral Raises': 2.5, 'Cable Crunches': 2.5,
  'Deadlift': 5, 'Bulgarian Split Squats': 5, 'DB Shoulder Press': 5,
};
export const DEFAULT_INCREMENT = 2.5;

/**
 * Weight stacks whose plates aren't a round number: the gym's cable machine goes up 1.5 kg (≈3⅓ lb)
 * per plate, labeled in rounded lbs (some plates say "3 kg" / "4.5 kg" — same plates). Lifts with
 * `stack` step plate by plate through this list (in lbs) instead of adding INCREMENTS.
 */
export const STACKS = {
  cable: [3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60, 63, 67, 70],
};

/**
 * Working sets per exercise unless an exercise sets its own `sets`. The pressing lifts and split squats
 * use 3 (climbing doesn't load them); pulling lifts stay at 2 because climbing already adds a lot of pulling.
 */
export const DEFAULT_SETS = 2;

/** The three workouts, done in rotation A → B → C. (Saved logs refer to them as session 1 / 2 / 3.) */
export const SESSION_LABELS = { 1: 'Workout A', 2: 'Workout B', 3: 'Workout C' };
export const SESSION_LETTERS = { 1: 'A', 2: 'B', 3: 'C' };
/** One line under each workout's button so you can tell them apart. */
export const SESSION_FOCUS = { 1: 'Incline · Deadlift', 2: 'Shoulder press · Rows', 3: 'Incline · Split squats · Pulldown' };
export const SESSION_COLORS = { 1: 'var(--s1)', 2: 'var(--s2)', 3: 'var(--s3)' };

/** A "Last time" older than this many days gets an "ease back in" note. */
export const STALE_AFTER_DAYS = 14;
/** Target sessions per week (dashed line on the weekly chart). */
export const WEEKLY_GOAL = 3;

/** Rest timer: seconds between sets unless an exercise sets its own `rest`. The timer is off until you turn it on.
 *  ~90 s is where the research flattens out for muscle growth; much longer adds little. */
export const DEFAULT_REST_SECONDS = 90;
/** Shorter rest for exercises paired in a circuit (tag: 'circuit'). */
export const CIRCUIT_REST_SECONDS = 45;   // you alternate exercises, so each muscle rests longer than the timer

/** Coming back after this many days without doing a lift → its target is eased back. */
export const EASE_BACK_FACTOR = 0.9;   // ~10% lighter, bottom of the rep range

/** Deload: lighter weight, fewer sets, easy reps. Deload sessions don't count toward progression. */
export const DELOAD = {
  // Two styles (switch in the app): 'sets' = same weight, half the sets (default);
  // 'lighter' = ~10% lighter, same sets. Both aim for the bottom of the rep range, 2–3 reps in reserve.
  weightFactor: 0.9,        // 'lighter': ~10% lighter, rounded to the lift's step
  setsFactor: 0.5,          // 'sets': half the sets, rounded up
  weekDays: 7,              // "Deload week" covers this many days
  breakDays: 7,
  frequentWindowWeeks: 6,   // warn when choosing a deload if there have been…
  frequentStretches: 2,     // …this many separate deload stretches in that window (including this one)             // a gap this long between sessions counts as a break (resets the count)
  // Usual guidance is a deload every 4–8 weeks; this sits on the earlier side because climbing adds fatigue.
  suggestAfterWeeks: 4,     // suggest a deload after this many weeks without a break if lifts are stalling…
  stalledLifts: 2,          // …this many lifts missed target in their last 2 sessions
  alwaysAfterWeeks: 6,      // …or after this many weeks regardless
  snoozeDays: 7,            // "Not now" hides the suggestion this long
  easyShare: 0.5,           // a session counts as a maintain / deload day when more than this share of the lifts you did were
  liftEasedStreak: 3,       // the same lift eased off (Maintain / Deload on just that lift) this many sessions in a row → a note on its card
  maintainWindowDays: 28,   // choosing Maintain this many times in this many days (since your last deload)…
  maintainSessions: 4,      // …is a fatigue signal: warns when you pick it, and suggests a deload
  hardClimbs: 4,            // this many hard climbing days in the last 2 weeks (~2 a week) brings suggestions a week earlier
};
