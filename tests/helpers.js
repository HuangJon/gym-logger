/** Builders for test data. */
let seq = 0;

/** A saved session. entries: { exerciseId: { status, weight?, reps?, unit?, note? } } */
export function session(date, sessionNum, entries, extra = {}) {
  seq++;
  return {
    id: extra.id ?? `t${seq}`,
    session: sessionNum,
    date,
    ts: extra.ts ?? seq,
    entries: Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { note: '', ...e }])),
    ...(extra.program ? { program: extra.program } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

export const done = (weight, reps, unit = 'lbs') => ({ status: 'complete', ...(weight != null ? { weight, unit } : {}), ...(reps != null ? { reps } : {}) });
export const partial = (weight, reps, unit = 'lbs') => ({ ...done(weight, reps, unit), status: 'partial' });
export const skipped = () => ({ status: 'skip' });
export const unrecorded = () => ({ status: 'unrecorded' });
