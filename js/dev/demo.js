/**
 * Sample sessions for the Trends "Preview with sample data" button. Generated in memory and never
 * saved. Deterministic (seeded) so the preview looks the same every time.
 */
import { SESSIONS } from '../config/program.js';
import { dayNum, fromDayNum } from '../core/dates.js';
import { unitOf, incrementOf } from '../core/exercises.js';

const STARTING_WEIGHT = {
  'Incline DB Press': 45, 'Deadlift': 175, 'Cable Lateral Raises': 5, 'Cable Crunches': 35,
  'Single Arm Cable Pulldown': 50, 'DB Shoulder Press': 30, 'Bent Over Rows': 40, 'Pallof Press': 20, 'Bulgarian Split Squats': 15,
};

/** Sample climbing days to go with the sample sessions: Tuesdays (alternating hard / easy) and some Saturdays. */
export function makeDemoClimbs(today, weeks = 10) {
  const end = dayNum(today), climbs = [];
  let n = 0;
  for (let d = end - weeks * 7; d < end; d++) {
    const weekday = (new Date(d * 86_400_000).getUTCDay() + 6) % 7;
    if (weekday === 1) climbs.push({ id: `demo-c${d}`, date: fromDayNum(d), intensity: n++ % 2 ? 'easy' : 'hard', ts: d });
    if (weekday === 5 && d % 3 === 0) climbs.push({ id: `demo-c${d}`, date: fromDayNum(d), intensity: 'easy', ts: d });
  }
  return climbs;
}

export function makeDemoSessions(today, weeks = 10) {
  const hardClimbDays = new Set(makeDemoClimbs(today, weeks).filter(c => c.intensity === 'hard').map(c => dayNum(c.date) + 1));
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const end = dayNum(today), progress = {}, sessions = [];
  let count = 0;
  for (let d = end - weeks * 7; d < end; d++) {
    const weekday = (new Date(d * 86_400_000).getUTCDay() + 6) % 7;   // 0 = Monday
    if (![0, 2, 4].includes(weekday) || random() < 0.12) continue;     // Mon/Wed/Fri, some missed days
    const sessionNum = (count++ % 3) + 1;
    const mode = count === 10 ? 'maintain' : count === 19 ? 'deload' : 'normal';
    const tired = hardClimbDays.has(d);   // the day after a hard climb: more misses
    const entries = {};
    for (const ex of SESSIONS[sessionNum]) {
      const p = progress[ex.name] ||= { weight: ex.bw ? null : (STARTING_WEIGHT[ex.name] ?? null), reps: ex.reps[0] };
      const roll = random();
      if (roll < 0.07) { entries[ex.id] = { status: 'skip', note: '' }; continue; }
      const partial = mode === 'normal' && roll < (tired ? 0.4 : 0.15);
      const entry = { status: partial ? 'partial' : 'complete', note: '', reps: partial ? Math.max(1, p.reps - 2) : p.reps,
        target: { reps: p.reps, sets: 2, ...(p.weight != null ? { weight: p.weight } : {}) } };
      if (p.weight != null) { entry.weight = p.weight; entry.unit = unitOf(ex); }
      entries[ex.id] = entry;
      if (!partial && mode === 'normal') {                               // double progression
        if (p.reps < ex.reps[1]) p.reps++;
        else if (p.weight != null) { p.weight += incrementOf(ex); p.reps = ex.reps[0]; }
      }
    }
    sessions.push({ id: `demo-${count}`, session: sessionNum, date: fromDayNum(d), ts: count, entries,
      ...(mode === 'maintain' ? { maintain: true } : mode === 'deload' ? { deload: true } : {}) });
  }
  return sessions;
}
