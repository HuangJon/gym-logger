/** Small number helpers shared across the app. */

/** True for a real logged value (not blank, null, undefined or NaN). */
export const hasValue = v => v !== '' && v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v));

/** Round to at most 2 decimals so quarter-pound weights show exactly (36.25, not 36.3). */
export const round2 = v => Math.round(v * 100) / 100;

/** "+2.5", "−1.75", "±0" */
export const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + round2(Math.abs(v));

/** Estimated one-rep max (Epley), rounded to the nearest 0.5. */
export const estimateOneRepMax = (weight, reps) => Math.round(weight * (1 + reps / 30) * 2) / 2;

/** Parse a typed weight; returns null unless it's a sensible positive number. */
export function parseWeight(raw) {
  const v = parseFloat(String(raw).trim());
  return Number.isFinite(v) && v > 0 && v <= 2000 ? v : null;
}

/** Parse typed reps; '' stays '' (not entered), otherwise a whole number ≥ 0 or null if invalid. */
export function parseReps(raw) {
  if (String(raw).trim() === '') return '';
  const v = parseInt(raw, 10);
  return Number.isInteger(v) && v >= 0 && v <= 999 ? v : null;
}
