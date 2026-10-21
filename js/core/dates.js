/**
 * Date helpers. Dates are stored as local calendar days in ISO form ("2026-10-21") so a session
 * never shifts day because of time zones. Arithmetic uses whole day numbers in UTC.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export const isISODate = value => typeof value === 'string' && ISO_RE.test(value);

/** Today's local date as "YYYY-MM-DD". */
export function todayISO(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole-day number for an ISO date (days since 1970-01-01). */
export function dayNum(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** ISO date for a day number. */
export const fromDayNum = n => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);

/** Days from `a` to `b` (positive when b is later). */
export const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));

export const addDays = (iso, n) => fromDayNum(dayNum(iso) + n);

/** Monday-start week number for an ISO date (day number of that week's Monday). */
export function weekStart(iso) {
  const d = dayNum(iso);
  const mondayOffset = (new Date(d * MS_PER_DAY).getUTCDay() + 6) % 7;
  return d - mondayOffset;
}

const toLocalDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

/** "Wed, Oct 21, 2026" */
export const formatLong = iso => iso ? toLocalDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
/** "Wed, Oct 21" */
export const formatShort = iso => iso ? toLocalDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
/** "10/21" */
export const formatMonthDay = iso => { const [, m, d] = String(iso).split('-').map(Number); return `${m}/${d}`; };

/** "today", "yesterday", "5 days ago", "3 weeks ago", "5 months ago" */
export function agoText(iso, ref) {
  const n = daysBetween(iso, ref);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return `${Math.round(n / 30)} months ago`;
}
