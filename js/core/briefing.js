/**
 * "Before you start": a short read on today's workout — how it went last time, climbing since,
 * and tips only when they apply (recent hard climb, a rough last session, a long gap).
 */
import { STALE_AFTER_DAYS, SESSION_LABELS } from '../config/program.js';
import { daysBetween, formatShort } from './dates.js';
import { normalizeEntry, DID_IT, STATUS, MODE, byNewest, entryMode } from './records.js';
import { sessionExercises, exercisesForSession } from './exercises.js';
import { recentHardClimb } from './climbs.js';

const listNames = names => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** How the last session went: lifts with a target (normal mode) that hit it / fell short. */
function howItWent(record) {
  const hit = [], short = [];
  for (const ex of exercisesForSession(record)) {
    const e = normalizeEntry(record.entries?.[ex.id]);
    if (!DID_IT.has(e.status) || !e.target || entryMode(record, e) !== MODE.NORMAL) continue;
    (e.status === STATUS.COMPLETE ? hit : short).push(ex.name);
  }
  return { hit: hit.length, total: hit.length + short.length, short };
}

/**
 * @returns {{ last: { date, hit, total, short: string[] } | null, sinceDays: number|null,
 *            climbs: { hard: number, easy: number }, tips: string[] }}
 */
export function sessionBriefing({ sessions, climbs, sessionNum, date }) {
  const earlier = sessions.filter(s => s.date < date).sort(byNewest);
  const lastSame = earlier.find(s => Number(s.session) === Number(sessionNum)) || null;
  const lastAny = earlier[0] || null;
  const last = lastSame ? { date: lastSame.date, ...howItWent(lastSame) } : null;
  const sinceDays = lastAny ? daysBetween(lastAny.date, date) : null;

  const from = lastSame?.date ?? lastAny?.date ?? null;
  const between = climbs.filter(c => c.date < date && (!from || c.date >= from));
  const climbCount = { hard: between.filter(c => c.intensity === 'hard').length, easy: between.filter(c => c.intensity === 'easy').length };

  const tips = [];
  const hard = recentHardClimb(climbs, date);
  if (hard) {
    const ago = daysBetween(hard.date, date);
    const when = ago === 1 ? 'yesterday' : `${ago} days ago (${formatShort(hard.date)})`;
    const overlap = sessionExercises(sessionNum).filter(ex => ex.climb).map(ex => ex.name);
    tips.push(overlap.length
      ? `Hard climb ${when} — ${listNames(overlap)} lean on the same back, biceps and grip. If ${overlap.length > 1 ? 'they feel' : 'it feels'} beat up, tap ↓ Deload on ${overlap.length > 1 ? 'those' : 'it'}.`
      : `Hard climb ${when} — today's lifts don't lean much on your climbing muscles, so go ahead as planned.`);
  }
  if (last && last.total >= 3 && last.short.length * 2 >= last.total) {
    tips.push(`Last time ${last.short.length} of ${last.total} lifts fell short — if today feels heavy too, Maintain is a fine choice.`);
  }
  if (sinceDays !== null && sinceDays > STALE_AFTER_DAYS) {
    tips.push(`${sinceDays} days since you last lifted — targets are eased back to help you get going again.`);
  }
  return { last, label: SESSION_LABELS[sessionNum], sinceDays, climbs: climbCount, tips };
}
