/**
 * Deloads: when to suggest one, and whether a deload week is running.
 *
 * A deload session is saved with `deload: true`. It shows in History and Trends but never moves
 * progression (see `performances` in progress.js), so the first normal session afterwards picks up
 * from the last session before the deload.
 */
import { DELOAD } from '../config/program.js';
import { daysBetween, addDays, isISODate } from './dates.js';
import { byOldest, STATUS, MODE, effectiveSessionMode } from './records.js';
import { sessionNumbers, sessionExercises } from './exercises.js';
import { performances } from './progress.js';
import { hardClimbsRecent } from './climbs.js';

/** What a session amounted to (see effectiveSessionMode): more than half the lifts on Maintain / Deload. */
const dayMode = record => effectiveSessionMode(record, DELOAD.easyShare);

/**
 * First session date of the current training block: sessions since the last break
 * (a gap of DELOAD.breakDays or more) or the last deload. Null if there's nothing since.
 */
export function blockStart(sessions, today) {
  let start = null, prev = null;
  for (const record of [...sessions].sort(byOldest)) {
    if (record.date > today) break;
    if (dayMode(record) === MODE.DELOAD) { start = null; prev = record.date; continue; }
    if (start === null || daysBetween(prev, record.date) >= DELOAD.breakDays) start = record.date;
    prev = record.date;
  }
  if (prev === null || daysBetween(prev, today) >= DELOAD.breakDays) return null;   // on a break right now
  return start;
}

/** Lifts in today's program whose last 2 (non-deload) sessions both missed target. */
export function stalledLifts(sessions, today) {
  const names = new Map();
  for (const n of sessionNumbers()) for (const ex of sessionExercises(n)) if (!names.has(ex.name)) names.set(ex.name, ex);
  return [...names.values()].filter(ex => {
    const recent = performances(sessions, ex, today, { limit: 2 });
    return recent.length === 2 && recent.every(p => p.status === STATUS.PARTIAL);
  }).map(ex => ex.name);
}

/**
 * Should the app suggest a deload week?
 * Lots of hard climbing lately brings both thresholds a week earlier.
 * @param settings { deloadUntil?, deloadSnoozedUntil? }
 * @param climbs   climbing days ({ date, intensity })
 * @returns {{ suggest: boolean, weeks: number, stalled: string[], hardClimbs: number, why: string }}
 */
export function deloadAdvice(sessions, today, settings = {}, climbs = []) {
  const none = { suggest: false, weeks: 0, stalled: [], hardClimbs: 0, why: '' };   // see maintainCount for the Maintain signal
  if (deloadWeekActive(settings, today)) return none;
  if (isISODate(settings.deloadSnoozedUntil) && today <= settings.deloadSnoozedUntil) return none;
  const start = blockStart(sessions, today);
  if (!start) return none;
  const weeks = Math.floor(daysBetween(start, today) / 7);
  const stalled = stalledLifts(sessions, today);
  const hardClimbs = hardClimbsRecent(climbs, today);
  const early = hardClimbs >= DELOAD.hardClimbs ? 1 : 0;
  const maintains = maintainCount(sessions, today);
  const tired = maintains >= DELOAD.maintainSessions;
  const suggest = tired || weeks >= DELOAD.alwaysAfterWeeks - early || (weeks >= DELOAD.suggestAfterWeeks - early && stalled.length >= DELOAD.stalledLifts);
  if (!suggest) return { ...none, weeks, stalled, hardClimbs };
  const parts = [`${weeks} weeks of training since your last break or deload`];
  if (tired) parts.push(`${maintains} maintain sessions in the last ${DELOAD.maintainWindowDays / 7} weeks — a sign you're running low`);
  if (stalled.length) parts.push(`${listNames(stalled)} missed target ${stalled.length === 1 ? 'its' : 'their'} last 2 times`);
  if (early) parts.push(`${hardClimbs} hard climbing days in the last 2 weeks`);
  return { suggest, weeks, stalled, hardClimbs, why: parts.join('; ') };
}

/**
 * Maintain days (more than half the lifts on Maintain) in the last DELOAD.maintainWindowDays, counted
 * since your last deload. Choosing Maintain a lot is a fatigue signal. Pass `plannedDate` to count
 * one you're about to start.
 */
export function maintainCount(sessions, today, plannedDate = null) {
  const from = addDays(today, -DELOAD.maintainWindowDays + 1);
  const recent = sessions.filter(s => s.date >= from && s.date <= today);
  const lastDeload = recent.filter(s => dayMode(s) === MODE.DELOAD).map(s => s.date).sort().pop() ?? '';
  const n = recent.filter(s => dayMode(s) === MODE.MAINTAIN && s.date > lastDeload).length;
  return n + (plannedDate ? 1 : 0);
}
export const maintainOften = (sessions, today, plannedDate = null) => maintainCount(sessions, today, plannedDate) >= DELOAD.maintainSessions;

/**
 * Are deloads coming too often? Counts separate deload stretches (deload sessions more than 10 days
 * apart start a new stretch) in the last DELOAD.frequentWindowWeeks. Pass `plannedDate` to count a
 * deload you're about to start.
 * @returns {{ tooMany: boolean, stretches: number, weeks: number }}
 */
export function deloadFrequency(sessions, today, plannedDate = null) {
  const weeks = DELOAD.frequentWindowWeeks, from = addDays(today, -weeks * 7 + 1);
  const dates = sessions.filter(s => s.date >= from && s.date <= today && dayMode(s) === MODE.DELOAD).map(s => s.date);
  if (plannedDate) dates.push(plannedDate);
  dates.sort();
  let stretches = 0, prev = null;
  for (const d of dates) { if (prev === null || daysBetween(prev, d) > 10) stretches++; prev = d; }
  return { tooMany: stretches >= DELOAD.frequentStretches, stretches, weeks };
}

const listNames = names => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Is a deload week running on `date`? */
export const deloadWeekActive = (settings, date) => isISODate(settings?.deloadUntil) && date <= settings.deloadUntil;

/** Settings change that starts a deload week on `date` (inclusive, DELOAD.weekDays long). */
export const startDeloadWeek = date => ({ deloadUntil: addDays(date, DELOAD.weekDays - 1), deloadSnoozedUntil: null });
export const endDeloadWeek = () => ({ deloadUntil: null });
export const snoozeDeload = today => ({ deloadSnoozedUntil: addDays(today, DELOAD.snoozeDays - 1) });
