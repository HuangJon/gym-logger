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

/** One climbing day per date: set it to 'easy' / 'hard' (keeping its id and note), or clear it with null. */
export function setClimbDay(climbs, date, intensity, now = Date.now()) {
  const existing = climbs.find(c => c.date === date);
  const others = climbs.filter(c => c.date !== date);
  if (!intensity) return others;
  if (existing) return [...others, { ...existing, intensity: intensity === CLIMB.HARD ? CLIMB.HARD : CLIMB.EASY }];
  return addClimb(others, { date, intensity, now });
}

export const removeClimb = (climbs, id) => climbs.filter(c => c.id !== id);

/** Climbs on one date. */
export const climbsOn = (climbs, date) => climbs.filter(c => c.date === date);

/** Hard climbing days in the `days` days up to and including `today`. */
export function hardClimbsRecent(climbs, today, days = 14) {
  return new Set(climbs.filter(c => c.intensity === CLIMB.HARD && c.date <= today && daysBetween(c.date, today) < days).map(c => c.date)).size;
}

/** Back, biceps and grip usually need ~48 h after hard climbing. */
export const CLIMB_RECOVERY_DAYS = 2;

/**
 * The most recent hard climb in the CLIMB_RECOVERY_DAYS days before `date` (not the same day — you
 * lift before climbing), or null.
 */
export function recentHardClimb(climbs, date, days = CLIMB_RECOVERY_DAYS) {
  return climbs.filter(c => c.intensity === CLIMB.HARD && c.date < date && daysBetween(c.date, date) <= days)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

export const climbsByNewest = (a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts || 0) - (a.ts || 0);
