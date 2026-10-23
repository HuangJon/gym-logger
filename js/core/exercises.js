/** Lookups over the program definition. */
import { SESSIONS, RETIRED, INCREMENTS, STACKS, DEFAULT_INCREMENT, DEFAULT_SETS, DEFAULT_REST_SECONDS, CIRCUIT_REST_SECONDS } from '../config/program.js';
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
export const defaultWeightOf = ex => (ex?.bw ? null : snapToStack(ex, convertWeight(ex?.defaultWeight ?? null, programUnitOf(ex), unitOf(ex), incrementOf(ex))));

/** The machine's plates (lbs) for a stack lift used in lbs, else null (then weights move by the increment). */
export const stackOf = ex => (ex?.stack && unitOf(ex) === 'lbs' ? STACKS[ex.stack] ?? null : null);
/** Nearest plate on the stack (weights for other lifts come back unchanged). */
export function snapToStack(ex, weight) {
  const plates = stackOf(ex);
  if (!plates || weight == null || !Number.isFinite(Number(weight))) return weight;
  return plates.reduce((best, p) => (Math.abs(p - weight) < Math.abs(best - weight) ? p : best), plates[0]);
}
/**
 * One plate up (+1) or down (−1) from `weight` on a stack lift. A weight between plates moves to the
 * plate on that side; at either end it stays put. Null for lifts without a stack.
 */
export function nextPlate(ex, weight, direction) {
  const plates = stackOf(ex);
  if (!plates) return null;
  const w = Number(weight) || 0;
  if (direction > 0) return plates.find(p => p > w + 1e-9) ?? plates[plates.length - 1];
  return [...plates].reverse().find(p => p < w - 1e-9) ?? plates[0];
}
export const setsOf = ex => ex?.sets ?? DEFAULT_SETS;
export const restOf = ex => ex?.rest ?? (ex?.tag === 'circuit' ? CIRCUIT_REST_SECONDS : DEFAULT_REST_SECONDS);
export const repRangeText = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/**
 * A workout's exercises as "slots" you need to do: each exercise is its own slot, except exercises
 * sharing a `pickOne` name, which share one slot (do at least one; the others are optional).
 */
export function exerciseSlots(list) {
  const slots = new Map();
  for (const ex of list) {
    const key = ex.pickOne ? `pick:${ex.pickOne}` : ex.id;
    if (!slots.has(key)) slots.set(key, []);
    slots.get(key).push(ex);
  }
  return [...slots.values()];
}

/** The other exercises an exercise can stand in for (same pickOne group in its workout). */
export const pickOneOthers = ex => (ex?.pickOne ? sessionExercises(ex.session).filter(o => o.pickOne === ex.pickOne && o.id !== ex.id) : []);

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
