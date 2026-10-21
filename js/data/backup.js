/**
 * Backups: the log only lives on this device, so Export/Import is how it moves to a new phone or
 * survives deleting the app.
 */
import { migrateLog, SCHEMA_VERSION } from '../core/migrate.js';
import { daysBetween } from '../core/dates.js';

export const BACKUP_STALE_DAYS = 14;
const LAST_BACKUP_KEY = 'lastBackup';

/** The backup file for the current log. */
export function createBackup(sessions, today, exportedAt = new Date().toISOString()) {
  return {
    filename: `lifting-log-backup-${today}.json`,
    json: JSON.stringify({ app: 'lifting-log', schemaVersion: SCHEMA_VERSION, exportedAt, sessions }, null, 1),
  };
}

/**
 * Read a backup file's text. Accepts current and older export formats.
 * @returns {{ sessions: object[], skipped: number }}
 * @throws {Error} if it isn't a lifting-log backup or contains no sessions
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn’t a lifting-log backup.'); }
  let result;
  try { result = migrateLog(data); } catch { throw new Error('That file isn’t a lifting-log backup.'); }
  if (!result.sessions.length) throw new Error('No sessions found in that file.');
  return { sessions: result.sessions, skipped: result.skipped };
}

/** When the last export happened, and whether it's time for another. */
export function backupStatus(storage, sessionCount, today) {
  const last = storage.read(LAST_BACKUP_KEY);
  const stale = sessionCount > 0 && (!last || daysBetween(last, today) > BACKUP_STALE_DAYS);
  return { last, stale };
}

export const markBackedUp = (storage, today) => storage.write(LAST_BACKUP_KEY, today);

/**
 * Hand a file to the user: the share sheet on phones ("Save to Files"), a download elsewhere.
 * @returns {Promise<boolean>} false if the user cancelled the share sheet
 */
export async function deliverFile({ filename, json }) {
  const file = new File([json], filename, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Lifting log backup' });
      return true;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
