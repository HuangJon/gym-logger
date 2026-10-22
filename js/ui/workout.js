/**
 * Workout tab: pick a date + session (Normal, Maintain or Deload), log each set against the target,
 * complete the session. The workout in progress is saved on every change and picked up again
 * if the app is closed mid-workout.
 */
import { PREHAB, SESSION_LABELS, SESSION_COLORS } from '../config/program.js';
import { sessionExercises, findExercise, unitOf, programUnitOf, setUnitChoices, incrementOf, repRangeText, restOf } from '../core/exercises.js';
import { todayISO, isISODate, formatShort, agoText } from '../core/dates.js';
import { hasValue, parseWeight, parseReps, convertWeight, UNITS } from '../core/numbers.js';
import { STATUS, MODE, buildSessionRecord, formatSets } from '../core/records.js';
import { addSession } from '../core/log.js';
import { lastNote, canStepRepsDown, canStepRepsUp, lastPerformance, computeTarget, targetReason, missedStreak, MISSES_BEFORE_HINT, lighterWeight, deloadTarget, DELOAD_STYLES, stepWeight, stepReps, stepTarget, setBadge, exerciseVerdict } from '../core/progress.js';
import { deloadAdvice, deloadFrequency, maintainCount, maintainOften, deloadWeekActive, startDeloadWeek, endDeloadWeek, snoozeDeload } from '../core/deload.js';
import { saveDraft, loadDraft, clearDraft } from '../data/draft.js';
import { setClimbDay, climbsOn, recentHardClimb, hardClimbsRecent } from '../core/climbs.js';
import { esc, delegate, autoResize, flash, confirmTap } from './dom.js';
import { createRestTimer } from './rest-timer.js';
import { climbSwitch, climbChoice } from './climb-switch.js';

const COMPLETE_LABEL = 'Complete Session';

export function createWorkoutView({ root, repo, storage, settings, onSaved, onUnitsChanged }) {
  const $ = sel => root.querySelector(sel);
  const ui = {
    pickerPanel: $('#picker-panel'), sessionPanel: $('#session-panel'),
    pickDate: $('#pick-date'), pickSession: $('#pick-session'), startBtn: $('#start-btn'),
    preview: $('#session-preview-area'), hint: $('#picker-hint'),
    header: $('#session-header'), prehab: $('#prehab'), exercises: $('#exercise-area'),
    completeBtn: $('#complete-btn'), status: $('#status'), deloadArea: $('#deload-area'), climbArea: $('#climb-area'), sessionClimb: $('#session-climb'),
  };

  let active = null;   // { sessionNum, date, mode } while logging
  /**
   * Per exercise, nothing saved until Complete:
   * { skipped?, note?, done: [{weight?, reps}], current?: index being edited (undefined = next set),
   *   draft?: {weight?, reps} for the open set, target?: your edited target, targetOpen? }
   */
  let scratch = {};
  let saving = false;

  const stateOf = id => (scratch[id] ||= { done: [] });
  /** Last normal (non-deload) session for this lift — what progression builds on. */
  const lastFor = (ex, date = active.date) => lastPerformance(repo.sessions, ex, date);
  /** How this lift is trained today: its own choice on the card, else the session's mode. */
  const liftMode = ex => scratch[ex.id]?.mode ?? active.mode;
  const liftDeload = ex => liftMode(ex) === MODE.DELOAD;
  /** How deloads are done: 'sets' (same weight, half the sets) or 'lighter' (~10% lighter, same sets). */
  const deloadStyle = () => (settings.get().deloadStyle === DELOAD_STYLES.LIGHTER ? DELOAD_STYLES.LIGHTER : DELOAD_STYLES.SETS);
  const suggestedTarget = (ex, date = active.date, mode = liftMode(ex)) => computeTarget(ex, lastFor(ex, date), {
    date, deload: mode === MODE.DELOAD, maintain: mode === MODE.MAINTAIN, deloadStyle: deloadStyle(), lastActive: lastPerformance(repo.sessions, ex, date, { includeDeload: true })?.date,
  });

  /** Fewer sets | Lighter switch, shown wherever a deload is on. */
  const deloadStyleSwitch = () => `<div class="seg deload-style" role="group" aria-label="How to deload">${[[DELOAD_STYLES.SETS, 'Fewer sets'], [DELOAD_STYLES.LIGHTER, 'Lighter']]
    .map(([value, label]) => `<button type="button" data-action="deload-style" data-style="${value}" aria-pressed="${deloadStyle() === value}">${label}</button>`).join('')}</div>`;
  const deloadHow = () => (deloadStyle() === DELOAD_STYLES.LIGHTER
    ? '~10% lighter, same sets, bottom of the rep range'
    : 'same weight, half the sets, bottom of the rep range');
  const targetFor = ex => scratch[ex.id]?.target ?? suggestedTarget(ex);

  /** Normal | Maintain | Deload switch (session-wide, in the picker and the workout header). */
  const MODE_LABELS = [[MODE.NORMAL, 'Normal'], [MODE.MAINTAIN, 'Maintain'], [MODE.DELOAD, 'Deload']];
  const modeSwitch = (current, action) => `<div class="seg mode-seg" role="group" aria-label="Session mode">${MODE_LABELS.map(([value, label]) =>
    `<button type="button" data-action="${action}" data-mode="${value}" aria-pressed="${current === value}">${label}</button>`).join('')}</div>`;
  const MODE_HOW = {
    [MODE.NORMAL]: 'push for progress — one more rep or more weight',
    [MODE.MAINTAIN]: 'repeat last time — same weight and reps, 2–3 reps in the tank',
  };

  /** Choosing Maintain often is a fatigue signal (like deloading often). */
  function maintainWarning(date) {
    const n = maintainCount(repo.sessions, date, date);
    return maintainOften(repo.sessions, date, date) ? `<div class="deload-often" role="note">
        <b>That's ${n} maintain sessions in 4 weeks</b> — choosing Maintain this often is a fatigue signal, usually hard climbing, short sleep, or targets rising too fast.
        A deload week may help more than another maintain day.
      </div>` : '';
  }

  const rest = createRestTimer({ el: $('#rest-bar'), onChange: () => persist() });
  const persist = () => { if (active) saveDraft(storage, { active, scratch, rest: rest.snapshot() }); };

  /** Index of the open set: one you tapped to edit, else the next set to log, else null (all logged). */
  function openIndex(ex) {
    const st = stateOf(ex.id);
    if (st.current !== undefined) return st.current;
    return st.done.length < targetFor(ex).sets ? st.done.length : null;
  }

  /** Values in the open set: your changes, else the set you're editing, else the previous set, else the target. */
  function draftOf(ex) {
    const st = stateOf(ex.id), i = openIndex(ex), t = targetFor(ex);
    if (st.draft) return st.draft;
    if (i !== null && i < st.done.length) return { ...st.done[i] };
    const prev = st.done[st.done.length - 1];
    if (prev) return { ...prev };
    return ex.bw ? { reps: t.reps } : { weight: t.weight ?? null, reps: t.reps };
  }
  const editDraft = (ex, change) => { const st = stateOf(ex.id); st.draft = { ...draftOf(ex), ...change }; };

  // ── picker ──────────────────────────────────────────────
  let pickMode = null;   // your choice for the next session; null = follow the deload week

  function resetPicker() {
    ui.pickDate.value = todayISO();
    ui.pickSession.value = '';
    pickMode = null;
    renderPicker();
  }

  const pickedDate = () => (isISODate(ui.pickDate.value) ? ui.pickDate.value : todayISO());
  const modePicked = () => pickMode ?? (deloadWeekActive(settings.get(), pickedDate()) ? MODE.DELOAD : MODE.NORMAL);

  function renderPicker() {
    renderDeloadArea();
    renderClimbArea();
    renderPreview();
  }

  /**
   * None | Easy | Hard for a day's climbing. Shown under the picker (any date) and at the end of a workout (you climb after).
   */
  function climbRow(date, { after = false } = {}) {
    const current = climbsOn(repo.climbs, date)[0]?.intensity ?? null;
    const hard = hardClimbsRecent(repo.climbs, date);
    const when = date === todayISO() ? 'today' : `on ${esc(formatShort(date))}`;
    return `<div class="climb-row${current ? ` is-${current}` : ''}">
        <span class="climb-label">🧗 ${after ? `Climbing ${when} too?` : `Climbed ${when}?`}</span>
        ${climbSwitch(date, current, 'climb-set', `Climbing ${when}`)}
        ${hard ? `<span class="climb-recent">${hard} hard climbing day${hard === 1 ? '' : 's'} in the last 2 weeks</span>` : ''}
      </div>`;
  }

  function renderClimbArea() { ui.climbArea.innerHTML = climbRow(pickedDate()); }
  function renderSessionClimb() { ui.sessionClimb.innerHTML = active ? climbRow(active.date, { after: true }) : ''; }

  async function setClimb(date, intensity) {
    try { await repo.commitClimbs(setClimbDay(repo.climbs, date, climbChoice(intensity))); }
    catch (err) { flash(active ? ui.status : ui.hint, `Couldn't save: ${err.message}`, { error: true, ms: 0 }); }
  }

  /** Normal | Maintain | Deload, deload week, and the "consider a deload" suggestion. */
  function renderDeloadArea() {
    const date = pickedDate(), s = settings.get(), week = deloadWeekActive(s, date), mode = modePicked(), on = mode === MODE.DELOAD;
    const advice = deloadAdvice(repo.sessions, todayISO(), s, repo.climbs);
    const suggestion = advice.suggest ? `<div class="card deload-suggest">
        <div class="ds-title">Consider a deload week</div>
        <div class="ds-why">${esc(advice.why)}.</div>
        <div class="ds-how">${deloadHow()}, stop 2–3 reps short of failure. Progress picks up where you left off.</div>
        <div class="ds-actions"><button type="button" class="btn-small ds-start" data-action="deload-week">Start deload week</button>
          <button type="button" class="link-btn" data-action="deload-snooze">Not now</button></div>
      </div>` : '';
    const weekText = week
      ? `<span class="deload-week-on">Deload week until ${esc(formatShort(s.deloadUntil))}</span> <button type="button" class="link-btn" data-action="deload-week-end">end</button>`
      : '<button type="button" class="link-btn" data-action="deload-week">Deload week…</button>';
    const freq = on && !week ? deloadFrequency(repo.sessions, date, date) : null;
    const tooOften = freq?.tooMany ? `<div class="deload-often" role="note">
        <b>That's ${freq.stretches} deloads in ${freq.weeks} weeks</b> — more often than the usual every 4–8 weeks.
        Needing them this often usually points to hard climbing, short sleep, or targets rising too fast.
        Deload if you need to, but also consider holding your weights steady for a while (tap ✎ on a target) and leaving 2–3 reps in reserve.
      </div>` : '';
    ui.deloadArea.innerHTML = `${suggestion}<div class="deload-row mode-${mode}">
        ${modeSwitch(mode, 'pick-mode')}
        <span class="deload-week">${weekText}</span>
        ${on ? `<div class="deload-style-row">${deloadStyleSwitch()}<span class="deload-how">${deloadHow()}</span></div>`
          : `<span class="mode-how">${MODE_HOW[mode]}</span>`}
      </div>${tooOften}${mode === MODE.MAINTAIN ? maintainWarning(date) : ''}`;
  }

  function renderPreview() {
    const n = Number(ui.pickSession.value), mode = modePicked();
    ui.startBtn.disabled = !n;
    ui.hint.hidden = !!n;
    if (!n) { ui.preview.innerHTML = ''; return; }
    const date = pickedDate();
    const rows = sessionExercises(n).map(ex => `<div class="preview-ex"><span class="preview-ex-name">${esc(ex.name)}</span>
      <span class="preview-ex-detail">${esc(ex.detail)} · <b>${targetText(ex, suggestedTarget(ex, date, mode))}</b></span></div>`).join('');
    ui.preview.innerHTML = `<div class="card preview">
      <div class="preview-header" style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]} — ${mode === MODE.NORMAL ? "today's targets" : `<span class="${mode}-tag">${mode}</span> targets`}</div>
      <div class="preview-list">${rows}</div></div>`;
  }

  function changeDeloadWeek(patch) {
    settings.update(patch);
    pickMode = null;
    renderPicker();
  }

  function targetText(ex, t) {
    if (!t) return '';
    const weight = !ex.bw && hasValue(t.weight) ? `${t.weight} ${unitOf(ex)} × ` : '';
    return `${weight}${t.reps}${weight ? '' : ' reps'} × ${t.sets} set${t.sets === 1 ? '' : 's'}`;
  }

  function start() {
    const n = Number(ui.pickSession.value);
    if (!n) return;
    active = { sessionNum: n, date: pickedDate(), mode: modePicked() };
    scratch = {};
    showSession();
    persist();
  }

  function showSession() {
    ui.pickerPanel.hidden = true;
    ui.sessionPanel.hidden = false;
    flash(ui.status, '', { ms: 0 });
    renderHeader();
    renderExercises();
    renderSessionClimb();
  }

  /** Back to the picker; the workout in progress is gone (saved to the log first, or discarded). */
  function endSession() {
    active = null;
    scratch = {};
    rest.stop();
    clearDraft(storage);
    ui.sessionPanel.hidden = true;
    ui.pickerPanel.hidden = false;
    resetPicker();
  }

  const loggedAnything = () => sessionExercises(active.sessionNum).some(ex => scratch[ex.id]?.done?.length || scratch[ex.id]?.skipped || scratch[ex.id]?.note);

  /** Pick up a workout that was in progress when the app closed. */
  function resumeDraft() {
    const draft = loadDraft(storage);
    if (!draft) return false;
    active = draft.active;
    scratch = draft.scratch;
    showSession();
    if (draft.rest) rest.resume(draft.rest, findExercise(draft.rest.exId)?.name);
    if (loggedAnything()) {
      const when = active.date === todayISO() ? 'from today' : `from ${formatShort(active.date)}`;
      flash(ui.status, `Picked up your unfinished workout ${when} — Complete to save it, or Discard`, { ms: active.date === todayISO() ? 6000 : 0 });
    }
    return true;
  }

  // ── active session ──────────────────────────────────────
  function renderHeader() {
    const { sessionNum: n, date, mode } = active, restOn = settings.get().restTimer;
    ui.header.innerHTML = `
      <span class="dot" style="background:${SESSION_COLORS[n]}"></span>
      <h2 style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]}</h2>
      <input type="date" class="date-input" id="active-date" value="${date}" data-action="active-date" aria-label="Session date">
      <button type="button" class="link-btn sa-change" data-action="ask-discard">change</button>
      <div class="session-tools">
        ${modeSwitch(mode, 'session-mode')}
        <button type="button" class="rest-toggle" data-action="rest-toggle" aria-pressed="${restOn}">⏱ Rest timer ${restOn ? 'on' : 'off'}</button>
        ${anyDeload() ? `<div class="deload-style-row">${deloadStyleSwitch()}<span class="deload-how">${deloadHow()}</span></div>` : ''}
      </div>`;
  }

  const anyDeload = () => sessionExercises(active.sessionNum).some(liftDeload);

  /** Switch deload style; deloaded lifts pick up the new targets (weights you set are kept). */
  function setDeloadStyle(style) {
    if (style === deloadStyle()) return;
    settings.update({ deloadStyle: style });
    if (!active) return renderPicker();
    for (const ex of sessionExercises(active.sessionNum)) if (liftDeload(ex)) retarget(ex, MODE.DELOAD);
    persist();
    renderHeader();
    renderExercises();
  }

  function askDiscard() {
    if (!loggedAnything()) return endSession();   // nothing to lose
    if (ui.header.querySelector('.discard-bar')) return;
    ui.header.insertAdjacentHTML('beforeend', `<div class="discard-bar"><span>Discard this session?</span>
      <button type="button" class="discard-yes" data-action="discard">Yes, discard</button>
      <button type="button" data-action="keep">Keep going</button></div>`);
  }

  function renderExercises() {
    const climb = recentHardClimb(repo.climbs, active.date);
    const nudge = climb ? `<div class="climb-nudge" role="note">🧗 Hard climb yesterday — if your back, biceps or grip feel beat up, tap <b>↓ Deload</b> on the pulling lifts.</div>` : '';
    ui.exercises.innerHTML = nudge + sessionExercises(active.sessionNum).map(exerciseCard).join('');
    ui.exercises.querySelectorAll('.note-input').forEach(autoResize);
  }

  /** Re-render one card (state lives in `scratch`, so nothing typed is lost). */
  function refreshCard(exId) {
    persist();
    const card = ui.exercises.querySelector(`#card-${exId}`);
    if (!card) return;
    card.outerHTML = exerciseCard(findExercise(exId));
    autoResize(ui.exercises.querySelector(`#note-${exId}`));
  }

  function exerciseCard(ex) {
    const st = stateOf(ex.id), mode = liftMode(ex), deload = mode === MODE.DELOAD, maintain = mode === MODE.MAINTAIN;
    const tags = [deload && '<span class="deload-tag">deload</span>', maintain && '<span class="maintain-tag">maintain</span>', ex.tag && `<span class="ex-tag tag-circuit">${esc(ex.tag)}</span>`, ex.warn && `<span class="ex-tag tag-warn">${esc(ex.warn)}</span>`].filter(Boolean).join('');
    return `
      <div class="card ex-card s${active.sessionNum}${st.skipped ? ' is-skipped' : ''}${deload ? ' is-deload' : ''}${maintain ? ' is-maintain' : ''}" id="card-${ex.id}" data-ex="${ex.id}">
        <div class="ex-header">
          <div>
            <div class="ex-name">${esc(ex.name)}</div>
            <div class="ex-detail">${esc(ex.detail)}</div>
            ${tags ? `<div class="ex-tags">${tags}</div>` : ''}
          </div>
          <div>${ex.bw ? '<span class="weight-bw">bodyweight</span>' : unitSwitch(ex)}</div>
        </div>
        ${targetRow(ex)}
        ${lastRow(ex)}
        ${st.skipped ? '' : setLog(ex)}
        <div class="ex-row status-row">
          <button type="button" class="status-btn" data-action="skip" data-status="skip" aria-pressed="${!!st.skipped}">✕ Skip</button>
          <button type="button" class="status-btn deload-btn" data-action="lift-mode" data-mode="deload" aria-pressed="${deload}">↓ Deload</button>
          <button type="button" class="status-btn maintain-btn" data-action="lift-mode" data-mode="maintain" aria-pressed="${maintain}">= Maintain</button>
        </div>
        <div class="ex-row note-row">
          <span class="note-icon">✎</span>
          <textarea class="note-input" id="note-${ex.id}" rows="1" placeholder="notes (optional)…" data-action="note">${esc(st.note || '')}</textarea>
        </div>
      </div>`;
  }

  // target + last time
  function targetRow(ex) {
    const st = stateOf(ex.id), last = lastFor(ex), target = targetFor(ex);
    if (!target) return '';
    const unit = unitOf(ex), edited = !!st.target;
    let reason = edited ? 'your target for today' : targetReason(ex, target, last, unit);
    const misses = !edited && target.reason === 'repeat' ? missedStreak(repo.sessions, ex, active.date) : 0;
    if (misses >= MISSES_BEFORE_HINT) {
      reason += ` · missed ${misses} times in a row — consider ${ex.bw || !hasValue(target.weight) ? 'an easier variation' : `~10% lighter (${lighterWeight(ex, target.weight, 0.9)} ${unit}, tap ✎)`}`;
    }
    const needsWeight = !ex.bw && !hasValue(target.weight);
    return `<div class="ex-row target-row">
      <span class="row-label">Target</span>
      <button type="button" class="target-btn" data-action="target-open" aria-expanded="${!!st.targetOpen}">
        <b>${targetText(ex, target)}</b>${needsWeight ? ' <span class="last-when">· set a weight</span>' : ''} <span class="target-edit">✎</span>
      </button>
      ${reason ? `<span class="target-reason">${reason}</span>` : ''}
      ${st.targetOpen ? targetPop(ex, target) : ''}
    </div>`;
  }

  /** One-tap lbs | kg, to match the machine's labels. */
  const unitSwitch = ex => `<div class="seg unit-seg" role="group" aria-label="Weight unit for ${esc(ex.name)}">${UNITS.map(u =>
    `<button type="button" data-action="unit" data-unit="${u}" aria-pressed="${unitOf(ex) === u}">${u}</button>`).join('')}</div>`;

  function targetPop(ex, t) {
    const row = (field, label, value, suffix = '') => `<div class="tp-row">
      <span class="row-label">${label}</span>
      <button type="button" class="stepper" data-action="target-step" data-field="${field}" data-dir="-1" aria-label="Lower target ${label}">−</button>
      <span class="tp-val" id="tp-${field}-${ex.id}">${value ?? '–'}</span>
      <button type="button" class="stepper" data-action="target-step" data-field="${field}" data-dir="1" aria-label="Raise target ${label}">+</button>
      <span class="tp-suffix">${suffix}</span></div>`;
    return `<div class="target-pop" role="dialog" aria-label="Adjust today's target">
      ${ex.bw ? '' : row('weight', 'Weight', t.weight, unitOf(ex))}
      ${row('reps', 'Reps', t.reps, `/ ${repRangeText(ex.reps)}`)}
      ${row('sets', 'Sets', t.sets)}
      <div class="tp-actions">
        ${stateOf(ex.id).target ? '<button type="button" class="link-btn" data-action="target-reset">Back to suggested</button>' : '<span></span>'}
        <button type="button" class="btn-small" data-action="target-close">Done</button>
      </div></div>`;
  }

  function lastRow(ex) {
    const last = lastFor(ex);
    if (!last) return `<div class="ex-row last-row"><span class="row-label">Last</span><span class="last-none">no previous log</span>${memoRow(ex)}</div>`;
    const unit = last.unit || unitOf(ex);
    const value = last.sets?.length ? formatSets(last.sets, unit)
      : [!ex.bw && hasValue(last.weight) && `${last.weight} ${unit}`, hasValue(last.reps) && `${last.reps} reps`].filter(Boolean).join(' × ');
    const lastDeload = lastPerformance(repo.sessions, ex, active.date, { includeDeload: true });
    const deloadSince = lastDeload?.deload && lastDeload.date >= last.date ? lastDeload : null;
    return `<div class="ex-row last-row">
      <span class="row-label">Last</span>
      <span class="last-val">${value}${last.status === STATUS.PARTIAL ? ' <span class="badge badge-partial">partial</span>' : ''}
        <span class="last-when">${formatShort(last.date)} · ${agoText(last.date, active.date)}</span></span>
      ${deloadSince ? `<span class="last-note">deload since (${esc(formatShort(deloadSince.date))}) — targets build on this one</span>` : ''}
      ${memoRow(ex)}
    </div>`;
  }

  /** Last session's note for this lift, if it left one. */
  function memoRow(ex) {
    const memo = lastNote(repo.sessions, ex, active.date);
    return memo ? `<span class="last-memo">✎ “${esc(memo.note)}” <span class="last-when">${esc(formatShort(memo.date))}</span></span>` : '';
  }

  // set-by-set panel
  function setLog(ex) {
    if (!ex.reps) return '';
    const st = stateOf(ex.id), target = targetFor(ex), open = openIndex(ex), unit = unitOf(ex);
    const tabCount = Math.max(target.sets, st.done.length, open !== null ? open + 1 : 0);
    const tabs = Array.from({ length: tabCount }, (_, i) => {
      const done = i < st.done.length, current = i === open, reachable = i <= st.done.length;
      const cls = ['set-tab', done && 'is-done', current && 'is-current'].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-action="set-tab" data-i="${i}"${reachable ? '' : ' disabled'}${current ? ' aria-current="step"' : ''} aria-label="Set ${i + 1}${done ? ', logged' : ''}">${done && !current ? '✓' : ''}${i + 1}</button>`;
    }).join('');
    const add = open === null ? '<button type="button" class="set-tab add" data-action="set-add" aria-label="Add a set">+</button>' : '';
    const verdict = exerciseVerdict(st.done, target);
    return `<div class="setlog${open === null ? ' is-collapsed' : ''}" id="setlog-${ex.id}">
      <div class="setlog-head">
        <span class="row-label">Sets</span>
        <span class="setlog-summary">${st.done.length ? esc(formatSets(st.done, ex.bw ? '' : unit)) : 'none logged yet'}</span>
        <div class="set-tabs">${tabs}${add}</div>
      </div>
      ${open !== null ? setBody(ex, open) : ''}
      ${verdict.label ? `<div class="setlog-verdict ${verdict.status === STATUS.COMPLETE ? 'ok' : 'short'}">${verdict.label}</div>` : ''}
    </div>`;
  }

  function setBody(ex, i) {
    const st = stateOf(ex.id), d = draftOf(ex), editing = i < st.done.length;
    const badge = setBadge(d, targetFor(ex));
    return `<div class="setlog-body">
      <div class="set-title">Set ${i + 1}${editing ? ' · editing' : ''}</div>
      ${ex.bw ? '' : `<div class="log-line"><span class="row-label">Weight</span><div class="weight-box" id="wb-${ex.id}">${weightInner(ex, d)}</div></div>`}
      <div class="log-line">
        <span class="row-label">Reps</span>
        <button type="button" class="stepper" data-action="reps-step" data-dir="-1" aria-label="One less rep" id="rm-${ex.id}"${canStepRepsDown(d.reps, ex.reps) ? '' : ' disabled'}>−</button>
        <input class="reps-input" type="number" inputmode="numeric" min="0" id="reps-${ex.id}" value="${d.reps ?? ''}" data-action="reps" aria-label="${esc(ex.name)} reps, set ${i + 1}">
        <button type="button" class="stepper" data-action="reps-step" data-dir="1" aria-label="One more rep" id="rp-${ex.id}"${canStepRepsUp(d.reps, ex.reps) ? '' : ' disabled'}>+</button>
        <span class="reps-target">/ ${repRangeText(ex.reps)}</span>
      </div>
      <div class="set-actions">
        <button type="button" class="btn-log" data-action="log-set">✓ ${editing ? 'Update' : 'Log'} set ${i + 1}</button>
        <span class="prog-badge ${badge.cls}" id="pb-${ex.id}">${badge.label}</span>
        ${editing ? '<button type="button" class="link-btn" data-action="remove-set">remove</button><button type="button" class="link-btn" data-action="cancel-set">cancel</button>' : ''}
      </div>
    </div>`;
  }

  function weightInner(ex, d) {
    const w = d.weight;
    const value = hasValue(w)
      ? `<span class="weight-val" id="wv-${ex.id}" tabindex="0" role="button" data-action="edit-weight">${w}</span>`
      : `<span class="weight-placeholder" id="wp-${ex.id}" tabindex="0" role="button" data-action="edit-weight">–</span>`;
    return `<div class="weight-row">
      <button type="button" class="stepper" data-action="weight-step" data-dir="-1" aria-label="Less weight"${hasValue(w) ? '' : ' disabled'}>−</button>
      ${value}<span class="weight-unit">${unitOf(ex)}</span>
      <button type="button" class="stepper" data-action="weight-step" data-dir="1" aria-label="More weight">+</button></div>`;
  }

  /** Update only the weight box + badge — a full redraw would swallow the tap that caused the blur. */
  function refreshDraft(exId) {
    const ex = findExercise(exId), d = draftOf(ex);
    const box = ui.exercises.querySelector(`#wb-${exId}`);
    if (box) box.innerHTML = weightInner(ex, d);
    const minus = ui.exercises.querySelector(`#rm-${exId}`);
    if (minus) minus.disabled = !canStepRepsDown(d.reps, ex.reps);
    const plus = ui.exercises.querySelector(`#rp-${exId}`);
    if (plus) plus.disabled = !canStepRepsUp(d.reps, ex.reps);
    const badge = setBadge(d, targetFor(ex)), el = ui.exercises.querySelector(`#pb-${exId}`);
    if (el) { el.className = `prog-badge ${badge.cls}`; el.textContent = badge.label; }
  }

  // ── actions ─────────────────────────────────────────────
  function startWeightEdit(exId) {
    const ex = findExercise(exId), box = ui.exercises.querySelector(`#wb-${exId}`);
    if (!ex || !box || box.querySelector('input')) return;
    box.innerHTML = `<div class="weight-row"><input type="number" inputmode="decimal" step="any" class="weight-input" id="inp-${exId}" value="${draftOf(ex).weight ?? ''}" aria-label="${esc(ex.name)} weight"><span class="weight-unit">${unitOf(ex)}</span></div>`;
    const input = box.querySelector('input');
    let cancelled = false;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { cancelled = true; input.blur(); }
    });
    input.addEventListener('blur', () => {
      const weight = parseWeight(input.value);
      if (!cancelled && weight !== null) editDraft(ex, { weight });
      refreshDraft(exId);
    }, { once: true });
    input.focus();
    input.select();
  }

  function stepDraftWeight(exId, direction) {
    const ex = findExercise(exId), w = draftOf(ex).weight;
    if (!hasValue(w) && direction < 0) return;
    editDraft(ex, { weight: stepWeight(ex, w ?? 0, direction) });   // nothing yet → + starts from 0
    refreshDraft(exId);
  }

  function stepDraftReps(exId, direction) {
    const ex = findExercise(exId), d = draftOf(ex);
    editDraft(ex, { reps: stepReps(d.reps ?? targetFor(ex).reps, direction, ex.reps) });
    ui.exercises.querySelector(`#reps-${exId}`).value = draftOf(ex).reps;
    refreshDraft(exId);
  }

  function typeReps(input) {
    const ex = findExercise(input.closest('[data-ex]').dataset.ex), reps = parseReps(input.value);
    editDraft(ex, { reps: reps === null || reps === '' ? null : reps });
    refreshDraft(ex.id);
  }

  function logSet(exId) {
    const ex = findExercise(exId), st = stateOf(exId), i = openIndex(ex), d = draftOf(ex);
    if (i === null || !hasValue(d.reps) || d.reps <= 0) return;
    const set = ex.bw || !hasValue(d.weight) ? { reps: d.reps } : { weight: d.weight, reps: d.reps };
    const isNew = i >= st.done.length;
    if (isNew) st.done.push(set); else st.done[i] = set;
    st.current = undefined;
    st.draft = undefined;
    if (isNew && settings.get().restTimer) rest.start({ exId, label: ex.name, seconds: restOf(ex) });
    refreshCard(exId);
  }

  function openSet(exId, i) {
    const st = stateOf(exId);
    if (i > st.done.length) return;
    st.current = i < st.done.length ? i : undefined;
    st.draft = undefined;
    refreshCard(exId);
  }

  function addSet(exId) {
    const st = stateOf(exId);
    st.current = st.done.length;
    st.draft = undefined;
    refreshCard(exId);
  }

  function removeSet(exId) {
    const ex = findExercise(exId), st = stateOf(exId), i = openIndex(ex);
    if (i !== null && i < st.done.length) st.done.splice(i, 1);
    st.current = undefined;
    st.draft = undefined;
    refreshCard(exId);
  }

  function toggleSkip(exId) {
    const st = stateOf(exId);
    st.skipped = !st.skipped;
    refreshCard(exId);
  }

  function changeTarget(exId, change) {
    const ex = findExercise(exId), st = stateOf(exId);
    if (change === 'reset') { delete st.target; delete st.baseWeight; }
    else st.target = stepTarget(ex, targetFor(ex), change.field, change.dir);
    refreshCard(exId);   // sets not started yet pick up the new numbers
  }

  function changeDate(input) {
    if (!isISODate(input.value)) { input.value = active.date; return; }
    active.date = input.value;
    persist();
    renderExercises();   // targets depend on the date; what you logged lives in `scratch`
  }

  /**
   * Switch a lift between lbs and kg (applies to every session with that lift). Past entries keep the
   * unit they were logged in; targets and anything logged in this workout are converted.
   */
  function setUnit(exId, unit) {
    const ex = findExercise(exId), from = unitOf(ex);
    if (!UNITS.includes(unit) || unit === from) return;
    const units = { ...settings.get().units };
    if (unit === programUnitOf(ex)) delete units[ex.name]; else units[ex.name] = unit;
    settings.update({ units });
    setUnitChoices(units);
    const conv = w => convertWeight(w, from, unit, 0.5);   // logged numbers: fine rounding, so switching back restores them
    for (const other of sessionExercises(active.sessionNum).filter(o => o.name === ex.name)) {
      const st = scratch[other.id];
      if (!st) continue;
      st.done = st.done.map(s => (hasValue(s.weight) ? { ...s, weight: conv(s.weight) } : s));
      if (st.draft && hasValue(st.draft.weight)) st.draft = { ...st.draft, weight: conv(st.draft.weight) };
      if (st.target && hasValue(st.target.weight)) st.target = { ...st.target, weight: convertWeight(st.target.weight, from, unit, incrementOf(ex)) };
      if (hasValue(st.baseWeight)) st.baseWeight = convertWeight(st.baseWeight, from, unit, incrementOf(ex));
    }
    persist();
    renderExercises();
    onUnitsChanged?.();
  }

  /** Switch the whole session's mode mid-workout. Logged sets stay; targets follow (weights you set are kept). */
  function setSessionMode(mode) {
    if (mode === active.mode) return;
    const before = Object.fromEntries(sessionExercises(active.sessionNum).map(ex => [ex.id, liftMode(ex)]));
    active.mode = mode;
    for (const ex of sessionExercises(active.sessionNum)) {
      const st = scratch[ex.id];
      if (!st) continue;
      delete st.mode;
      retarget(ex, before[ex.id]);
    }
    persist();
    renderHeader();
    renderExercises();
  }

  /** Deload or maintain just this lift (tap again to go back to the session's mode). */
  function toggleLiftMode(exId, mode) {
    const ex = findExercise(exId), st = stateOf(exId), was = liftMode(ex);
    const next = was === mode ? (active.mode === mode ? MODE.NORMAL : active.mode) : mode;
    if (next === active.mode) delete st.mode; else st.mode = next;
    retarget(ex, was);
    if (anyDeload() !== !!ui.header.querySelector('.deload-style')) renderHeader();   // show / hide the style switch
    refreshCard(exId);
  }

  /**
   * After a mode switch: targets go back to suggested (so they follow the change) — except a weight
   * you set yourself is kept (as a deload of that weight while deloaded, back to your number after).
   */
  function retarget(ex, wasMode) {
    const st = stateOf(ex.id), suggestedBefore = suggestedTarget(ex, active.date, wasMode);
    // a weight you chose: an edited target, or (when nothing was suggested) the weight you typed
    const yours = st.target?.weight ?? (hasValue(suggestedBefore?.weight) ? null : st.draft?.weight) ?? null;
    if (wasMode !== MODE.DELOAD && hasValue(yours)) st.baseWeight = yours;   // remember your normal weight
    delete st.target;
    st.draft = undefined;
    if (ex.bw || !hasValue(st.baseWeight)) return;
    const normal = suggestedTarget(ex, active.date, MODE.NORMAL);
    st.target = liftDeload(ex) ? deloadTarget(ex, st.baseWeight, normal.sets, deloadStyle()) : { ...suggestedTarget(ex), weight: st.baseWeight };
  }

  function toggleRestTimer() {
    const on = !settings.get().restTimer;
    settings.update({ restTimer: on });
    if (!on) rest.stop();
    renderHeader();
  }

  function discardFromBottom(btn) {
    if (!loggedAnything() || confirmTap(btn, 'Tap again to discard — nothing will be saved')) {
      endSession();
      flash(ui.status, '');
    }
  }

  // ── complete ────────────────────────────────────────────
  async function complete() {
    if (saving || !active) return;
    const btn = ui.completeBtn;
    const anything = sessionExercises(active.sessionNum).some(ex => scratch[ex.id]?.done?.length || scratch[ex.id]?.skipped);
    if (!anything && !btn.dataset.armed) {   // ask before saving a session with nothing logged
      btn.dataset.armed = '1';
      btn.textContent = 'Nothing logged yet — tap again to save anyway';
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; if (!saving) btn.textContent = COMPLETE_LABEL; } }, 4000);
      return;
    }
    delete btn.dataset.armed;
    saving = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const record = buildSessionRecord({ sessionNum: active.sessionNum, date: active.date, scratch, targetOf: ex => targetFor(ex), mode: active.mode });
      await repo.commit(addSession(repo.sessions, record));
      endSession();
      flash(ui.status, 'Session saved ✓');
      onSaved?.(record);
    } catch (err) {
      flash(ui.status, `Save failed — your entries are still here, try again${err?.message ? ` (${err.message})` : ''}`, { error: true, ms: 0 });
      console.error(err);
    } finally {
      saving = false;
      btn.disabled = false;
      btn.textContent = COMPLETE_LABEL;
    }
  }

  // ── wiring ──────────────────────────────────────────────
  ui.prehab.innerHTML = `
    <div class="prehab-header"><span class="dot" style="background:var(--ph)"></span><h3>${esc(PREHAB.title)}</h3><span>${esc(PREHAB.sets)}</span></div>
    <div class="prehab-pills">${PREHAB.exercises.map(x => `<span class="prehab-pill">${esc(x)}</span>`).join('')}</div>`;

  const exIdOf = el => el.closest('[data-ex]').dataset.ex;
  delegate(root, 'click', {
    'start': start,
    'ask-discard': askDiscard,
    'discard': endSession,
    'keep': el => el.closest('.discard-bar').remove(),
    'target-open': el => { const st = stateOf(exIdOf(el)); st.targetOpen = !st.targetOpen; refreshCard(exIdOf(el)); },
    'target-close': el => { stateOf(exIdOf(el)).targetOpen = false; refreshCard(exIdOf(el)); },
    'target-step': el => changeTarget(exIdOf(el), { field: el.dataset.field, dir: Number(el.dataset.dir) }),
    'target-reset': el => changeTarget(exIdOf(el), 'reset'),
    'edit-weight': el => startWeightEdit(exIdOf(el)),
    'weight-step': el => stepDraftWeight(exIdOf(el), Number(el.dataset.dir)),
    'reps-step': el => stepDraftReps(exIdOf(el), Number(el.dataset.dir)),
    'log-set': el => logSet(exIdOf(el)),
    'set-tab': el => openSet(exIdOf(el), Number(el.dataset.i)),
    'set-add': el => addSet(exIdOf(el)),
    'remove-set': el => removeSet(exIdOf(el)),
    'cancel-set': el => openSet(exIdOf(el), stateOf(exIdOf(el)).done.length),
    'skip': el => toggleSkip(exIdOf(el)),
    'complete': complete,
    'discard-bottom': discardFromBottom,
    'rest-toggle': toggleRestTimer,
    'unit': el => setUnit(exIdOf(el), el.dataset.unit),
    'lift-mode': el => toggleLiftMode(exIdOf(el), el.dataset.mode),
    'session-mode': el => setSessionMode(el.dataset.mode),
    'pick-mode': el => { pickMode = el.dataset.mode; renderPicker(); },
    'climb-set': el => setClimb(el.dataset.date, el.dataset.intensity),
    'deload-style': el => setDeloadStyle(el.dataset.style),
    'rest-adjust': el => rest.adjust(Number(el.dataset.dir)),
    'rest-stop': () => rest.stop(),
    'deload-week': () => changeDeloadWeek(startDeloadWeek(pickedDate())),
    'deload-week-end': () => changeDeloadWeek(endDeloadWeek()),
    'deload-snooze': () => changeDeloadWeek(snoozeDeload(todayISO())),
  });
  delegate(root, 'keydown', {
    'edit-weight': (el, e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startWeightEdit(exIdOf(el)); } },
  });
  delegate(root, 'input', {
    'reps': typeReps,
    'note': el => { stateOf(exIdOf(el)).note = el.value; autoResize(el); persist(); },
  });
  delegate(root, 'change', {
    'pick-session': renderPreview,
    'pick-date': () => { pickMode = null; renderPicker(); },
    'active-date': changeDate,
  });

  resetPicker();
  resumeDraft();

  return {
    /** Re-render anything that depends on the saved log (called after History edits). */
    refresh() { if (active) { renderExercises(); renderSessionClimb(); } else renderPicker(); },
  };
}
