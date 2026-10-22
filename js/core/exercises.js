/** Lookups over the program definition. */
import { SESSIONS, RETIRED, INCREMENTS, DEFAULT_INCREMENT, DEFAULT_SETS, DEFAULT_REST_SECONDS, CIRCUIT_REST_SECONDS } from '../config/program.js';
import { UNITS, convertWeight } from './numbers.js';

const sessionOf = id => Number(String(id).match(/^s(\d)/)?.[1]) || null;

const CURRENT = Object.entries(SESSIONS).flatMap(([n, list]) => list.map(ex => ({ ...ex, session: Number(n) })));
const OLD = RETIRED.map(ex => ({ ...ex, session: sessionOf(ex.id), retired: true }));
const BY_ID = new Map([...CURRENT, ...OLD].map(ex => [ex.id, ex]));

export const sessionNumbers = () => Object.keys(SESSIONS).map(Number);
export const sessionExercises = n => CURRENT.filter(ex => ex.session === Number(n));
export const findExercise = id => BY_ID.get(id) || null;
/** Every exercise, current first, then retired. */
export const allExercises = () => [...CURRENT, ...OLD];

/**
 * Your unit choice per lift (by name), from settings — so the numbers match the labels on the
 * machine. Set once at startup and whenever you switch; everything else reads it through unitOf().
 */
let unitChoices = {};
export function setUnitChoices(map) {
  unitChoices = Object.fromEntries(Object.entries(map && typeof map === 'object' ? map : {}).filter(([, u]) => UNITS.includes(u)));
}
/** The unit the program file uses for this lift. */
export const programUnitOf = ex => ex?.unit || 'lbs';
/** The unit to show and log this lift in: your choice, else the program's. */
export const unitOf = ex => unitChoices[ex?.name] || programUnitOf(ex);
/** − / + step and target bump. INCREMENTS are in the program's unit; in the other unit it's 2.5. */
export const incrementOf = ex => (unitOf(ex) === programUnitOf(ex) ? INCREMENTS[ex?.name] ?? DEFAULT_INCREMENT : DEFAULT_INCREMENT);
/** The program's starting weight, in the unit you're using. */
export const defaultWeightOf = ex => (ex?.bw ? null : convertWeight(ex?.defaultWeight ?? null, programUnitOf(ex), unitOf(ex), incrementOf(ex)));
export const setsOf = ex => ex?.sets ?? DEFAULT_SETS;
export const restOf = ex => ex?.rest ?? (ex?.tag === 'circuit' ? CIRCUIT_REST_SECONDS : DEFAULT_REST_SECONDS);
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
