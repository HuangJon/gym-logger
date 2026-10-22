/** Small number helpers shared across the app. */

/** True for a real logged value (not blank, null, undefined or NaN). */
export const hasValue = v => v !== '' && v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v));

/** Round to at most 2 decimals so quarter-pound weights show exactly (36.25, not 36.3). */
export const round2 = v => Math.round(v * 100) / 100;

export const UNITS = ['lbs', 'kg'];
const LBS_PER_KG = 2.20462;
/** Convert a weight between 'lbs' and 'kg', rounded to the nearest `step` (no rounding when step is 0). */
export function convertWeight(weight, from, to, step = 0) {
  if (!hasValue(weight) || from === to || !UNITS.includes(from) || !UNITS.includes(to)) return weight;
  const raw = to === 'kg' ? weight / LBS_PER_KG : weight * LBS_PER_KG;
  return step ? round2(Math.max(step, Math.round(raw / step) * step)) : round2(raw);
}

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
