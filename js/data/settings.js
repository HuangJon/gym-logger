/**
 * Small per-device preferences (rest timer on/off, deload week, snoozed suggestion).
 * Kept apart from the workout log: losing them never loses a workout, and they aren't in backups.
 */
const KEY = 'settings';
export const DEFAULT_SETTINGS = Object.freeze({ restTimer: false, deloadUntil: null, deloadSnoozedUntil: null });

export function createSettings(storage) {
  let current = { ...DEFAULT_SETTINGS, ...(isObject(storage.read(KEY)) ? storage.read(KEY) : {}) };
  return {
    get: () => current,
    /** Merge `patch` in and save (best effort — a failed save keeps the change for this visit). */
    update(patch) {
      current = { ...current, ...patch };
      try { storage.write(KEY, current); } catch { /* storage full or blocked */ }
      return current;
    },
  };
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
