/** Lookups over the program definition. */
import { SESSIONS, RETIRED, INCREMENTS, DEFAULT_INCREMENT } from '../config/program.js';

const sessionOf = id => Number(String(id).match(/^s(\d)/)?.[1]) || null;

const CURRENT = Object.entries(SESSIONS).flatMap(([n, list]) => list.map(ex => ({ ...ex, session: Number(n) })));
const OLD = RETIRED.map(ex => ({ ...ex, session: sessionOf(ex.id), retired: true }));
const BY_ID = new Map([...CURRENT, ...OLD].map(ex => [ex.id, ex]));

export const sessionNumbers = () => Object.keys(SESSIONS).map(Number);
export const sessionExercises = n => CURRENT.filter(ex => ex.session === Number(n));
export const findExercise = id => BY_ID.get(id) || null;
/** Every exercise, current first, then retired. */
export const allExercises = () => [...CURRENT, ...OLD];

export const unitOf = ex => ex?.unit || 'lbs';
export const incrementOf = ex => INCREMENTS[ex?.name] ?? DEFAULT_INCREMENT;
export const repRangeText = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/**
 * Exercises to show for a logged session: the current program for that session plus anything
 * else it logged. Sessions from an older program (program: 'old') show only what was logged.
 */
export function exercisesForSession(record) {
  const loggedIds = Object.keys(record.entries || {});
  const base = record.program === 'old' ? [] : sessionExercises(record.session);
  const order = [...sessionExercises(record.session).map(ex => ex.id), ...OLD.map(ex => ex.id)];
  const extra = loggedIds
    .filter(id => !base.some(ex => ex.id === id))
    .map(findExercise)
    .filter(Boolean)
    .sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  return [...base, ...extra];
}
