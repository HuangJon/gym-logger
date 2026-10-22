/**
 * Climbing days. Climbing loads the same muscles as several lifts (back, biceps, grip, shoulders),
 * so the app keeps a simple record — date + easy/hard — to show next to lifting and to factor into
 * deload suggestions.
 *
 *   Climb = { id, date: "YYYY-MM-DD", intensity: 'easy'|'hard', ts, note? }
 */
import { daysBetween, addDays } from './dates.js';

export const CLIMB = Object.freeze({ EASY: 'easy', HARD: 'hard' });

export const addClimb = (climbs, { date, intensity, now = Date.now() }) =>
  [...climbs, { id: `climb-${now}`, date, intensity: intensity === CLIMB.HARD ? CLIMB.HARD : CLIMB.EASY, ts: now }];

export const removeClimb = (climbs, id) => climbs.filter(c => c.id !== id);

/** Climbs on one date. */
export const climbsOn = (climbs, date) => climbs.filter(c => c.date === date);

/** Hard climbing days in the `days` days up to and including `today`. */
export function hardClimbsRecent(climbs, today, days = 14) {
  return new Set(climbs.filter(c => c.intensity === CLIMB.HARD && c.date <= today && daysBetween(c.date, today) < days).map(c => c.date)).size;
}

/** The most recent hard climb on `date` or the day before (fatigue that likely carries into today's lifting). */
export function recentHardClimb(climbs, date) {
  const yesterday = addDays(date, -1);
  return climbs.filter(c => c.intensity === CLIMB.HARD && (c.date === date || c.date === yesterday))
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

export const climbsByNewest = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0);
