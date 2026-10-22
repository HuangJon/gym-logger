/**
 * Pure, immutable operations on the list of saved sessions. Each returns a new array and never
 * mutates its input, so a failed save can't leave the app in a half-changed state.
 */
import { isISODate } from './dates.js';
import { normalizeEntry } from './records.js';

export const addSession = (sessions, record) => [record, ...sessions];

export const updateEntry = (sessions, sessionId, exerciseId, entry) =>
  sessions.map(s => s.id === sessionId ? { ...s, entries: { ...s.entries, [exerciseId]: normalizeEntry(entry) } } : s);

export function setSessionDate(sessions, sessionId, date) {
  if (!isISODate(date)) throw new Error(`Not a date: ${date}`);
  return sessions.map(s => s.id === sessionId ? { ...s, date } : s);
}

/** Mark or unmark a session as a deload (deloads don't move progression). */
export const setSessionDeload = (sessions, sessionId, deload) =>
  sessions.map(s => {
    if (s.id !== sessionId) return s;
    const { deload: _old, ...rest } = s;
    return deload ? { ...rest, deload: true } : rest;
  });

export const deleteSession = (sessions, sessionId) => sessions.filter(s => s.id !== sessionId);

/** Merge imported sessions: same id replaces, new ids are added. */
export function mergeSessions(existing, incoming) {
  const byId = new Map(existing.map(s => [s.id, s]));
  let added = 0, updated = 0;
  for (const s of incoming) { byId.has(s.id) ? updated++ : added++; byId.set(s.id, s); }
  return { sessions: [...byId.values()], added, updated };
}
