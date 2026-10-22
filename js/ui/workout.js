/**
 * Workout tab: pick a date + session (normal or deload), log each set against the target,
 * complete the session. The workout in progress is saved on every change and picked up again
 * if the app is closed mid-workout.
 */
import { PREHAB, SESSION_LABELS, SESSION_COLORS } from '../config/program.js';
import { sessionExercises, findExercise, unitOf, repRangeText, restOf } from '../core/exercises.js';
import { todayISO, isISODate, formatShort, agoText } from '../core/dates.js';
import { hasValue, parseWeight, parseReps } from '../core/numbers.js';
import { STATUS, buildSessionRecord, formatSets } from '../core/records.js';
import { addSession } from '../core/log.js';
import { lastPerformance, computeTarget, targetReason, stepWeight, stepReps, stepTarget, setBadge, exerciseVerdict } from '../core/progress.js';
import { deloadAdvice, deloadWeekActive, startDeloadWeek, endDeloadWeek, snoozeDeload } from '../core/deload.js';
import { saveDraft, loadDraft, clearDraft } from '../data/draft.js';
import { esc, delegate, autoResize, flash, confirmTap } from './dom.js';
import { createRestTimer } from './rest-timer.js';

const COMPLETE_LABEL = 'Complete Session';

export function createWorkoutView({ root, repo, storage, settings, onSaved }) {
  const $ = sel => root.querySelector(sel);
  const ui = {
    pickerPanel: $('#picker-panel'), sessionPanel: $('#session-panel'),
    pickDate: $('#pick-date'), pickSession: $('#pick-session'), startBtn: $('#start-btn'),
    preview: $('#session-preview-area'), hint: $('#picker-hint'),
    header: $('#session-header'), prehab: $('#prehab'), exercises: $('#exercise-area'),
    completeBtn: $('#complete-btn'), status: $('#status'), deloadArea: $('#deload-area'),
  };

  let active = null;   // { sessionNum, date, deload } while logging
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
  const suggestedTarget = (ex, date = active.date, deload = active.deload) => computeTarget(ex, lastFor(ex, date), {
    date, deload, lastActive: lastPerformance(repo.sessions, ex, date, { includeDeload: true })?.date,
  });
  const targetFor = ex => scratch[ex.id]?.target ?? suggestedTarget(ex);

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
  let pickDeload = null;   // your choice for the next session; null = follow the deload week

  function resetPicker() {
    ui.pickDate.value = todayISO();
    ui.pickSession.value = '';
    pickDeload = null;
    renderPicker();
  }

  const pickedDate = () => (isISODate(ui.pickDate.value) ? ui.pickDate.value : todayISO());
  const deloadPicked = () => pickDeload ?? deloadWeekActive(settings.get(), pickedDate());

  function renderPicker() {
    renderDeloadArea();
    renderPreview();
  }

  /** Deload switch, deload week, and the "consider a deload" suggestion. */
  function renderDeloadArea() {
    const date = pickedDate(), s = settings.get(), week = deloadWeekActive(s, date), on = deloadPicked();
    const advice = deloadAdvice(repo.sessions, todayISO(), s);
    const suggestion = advice.suggest ? `<div class="card deload-suggest">
        <div class="ds-title">Consider a deload week</div>
        <div class="ds-why">${esc(advice.why)}.</div>
        <div class="ds-how">~10% lighter, half the sets, stop 2–3 reps short of failure. Progress picks up where you left off.</div>
        <div class="ds-actions"><button type="button" class="btn-small ds-start" data-action="deload-week">Start deload week</button>
          <button type="button" class="link-btn" data-action="deload-snooze">Not now</button></div>
      </div>` : '';
    const weekText = week
      ? `<span class="deload-week-on">Deload week until ${esc(formatShort(s.deloadUntil))}</span> <button type="button" class="link-btn" data-action="deload-week-end">end</button>`
      : '<button type="button" class="link-btn" data-action="deload-week">Deload week…</button>';
    ui.deloadArea.innerHTML = `${suggestion}<div class="deload-row${on ? ' is-on' : ''}">
        <label class="switch"><input type="checkbox" id="pick-deload" data-action="pick-deload"${on ? ' checked' : ''}><span class="switch-track" aria-hidden="true"></span>
          <span class="switch-label">Deload session</span></label>
        <span class="deload-week">${weekText}</span>
      </div>`;
  }

  function renderPreview() {
    const n = Number(ui.pickSession.value), deload = deloadPicked();
    ui.startBtn.disabled = !n;
    ui.hint.hidden = !!n;
    if (!n) { ui.preview.innerHTML = ''; return; }
    const date = pickedDate();
    const rows = sessionExercises(n).map(ex => `<div class="preview-ex"><span class="preview-ex-name">${esc(ex.name)}</span>
      <span class="preview-ex-detail">${esc(ex.detail)} · <b>${targetText(ex, suggestedTarget(ex, date, deload))}</b></span></div>`).join('');
    ui.preview.innerHTML = `<div class="card preview">
      <div class="preview-header" style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]} — ${deload ? '<span class="deload-tag">deload</span> targets' : "today's targets"}</div>
      <div class="preview-list">${rows}</div></div>`;
  }

  function changeDeloadWeek(patch) {
    settings.update(patch);
    pickDeload = null;
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
    active = { sessionNum: n, date: pickedDate(), deload: deloadPicked() };
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
    if (loggedAnything()) flash(ui.status, 'Picked up your unfinished workout — Complete to save it, or Discard', { ms: 6000 });
    return true;
  }

  // ── active session ──────────────────────────────────────
  function renderHeader() {
    const { sessionNum: n, date, deload } = active, restOn = settings.get().restTimer;
    ui.header.innerHTML = `
      <span class="dot" style="background:${SESSION_COLORS[n]}"></span>
      <h2 style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]}${deload ? ' <span class="deload-tag">deload</span>' : ''}</h2>
      <input type="date" class="date-input" id="active-date" value="${date}" data-action="active-date" aria-label="Session date">
      <button type="button" class="link-btn sa-change" data-action="ask-discard">change</button>
      <div class="session-tools">
        <button type="button" class="rest-toggle" data-action="rest-toggle" aria-pressed="${restOn}">⏱ Rest timer ${restOn ? 'on' : 'off'}</button>
      </div>`;
  }

  function askDiscard() {
    if (!loggedAnything()) return endSession();   // nothing to lose
    if (ui.header.querySelector('.discard-bar')) return;
    ui.header.insertAdjacentHTML('beforeend', `<div class="discard-bar"><span>Discard this session?</span>
      <button type="button" class="discard-yes" data-action="discard">Yes, discard</button>
      <button type="button" data-action="keep">Keep going</button></div>`);
  }

  function renderExercises() {
    ui.exercises.innerHTML = sessionExercises(active.sessionNum).map(exerciseCard).join('');
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
    const st = stateOf(ex.id);
    const tags = [ex.tag && `<span class="ex-tag tag-circuit">${esc(ex.tag)}</span>`, ex.warn && `<span class="ex-tag tag-warn">${esc(ex.warn)}</span>`].filter(Boolean).join('');
    return `
      <div class="card ex-card s${active.sessionNum}${st.skipped ? ' is-skipped' : ''}" id="card-${ex.id}" data-ex="${ex.id}">
        <div class="ex-header">
          <div>
            <div class="ex-name">${esc(ex.name)}</div>
            <div class="ex-detail">${esc(ex.detail)}</div>
            ${tags ? `<div class="ex-tags">${tags}</div>` : ''}
          </div>
          <div>${ex.bw ? '<span class="weight-bw">bodyweight</span>' : ''}</div>
        </div>
        ${targetRow(ex)}
        ${lastRow(ex)}
        ${st.skipped ? '' : setLog(ex)}
        <div class="ex-row status-row">
          <button type="button" class="status-btn" data-action="skip" data-status="skip" aria-pressed="${!!st.skipped}">✕ Skip</button>
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
    const reason = edited ? 'your target for today' : targetReason(ex, target, last, unit);
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
    if (!last) return '<div class="ex-row last-row"><span class="row-label">Last</span><span class="last-none">no previous log</span></div>';
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
    </div>`;
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
        <button type="button" class="stepper" data-action="reps-step" data-dir="-1" aria-label="One less rep">−</button>
        <input class="reps-input" type="number" inputmode="numeric" min="0" id="reps-${ex.id}" value="${d.reps ?? ''}" data-action="reps" aria-label="${esc(ex.name)} reps, set ${i + 1}">
        <button type="button" class="stepper" data-action="reps-step" data-dir="1" aria-label="One more rep">+</button>
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
    if (change === 'reset') delete st.target;
    else st.target = stepTarget(ex, targetFor(ex), change.field, change.dir);
    refreshCard(exId);   // sets not started yet pick up the new numbers
  }

  function changeDate(input) {
    if (!isISODate(input.value)) { input.value = active.date; return; }
    active.date = input.value;
    persist();
    renderExercises();   // targets depend on the date; what you logged lives in `scratch`
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
      const record = buildSessionRecord({ sessionNum: active.sessionNum, date: active.date, scratch, targetOf: ex => targetFor(ex), deload: active.deload });
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
    'pick-date': () => { pickDeload = null; renderPicker(); },
    'pick-deload': el => { pickDeload = el.checked; renderPicker(); },
    'active-date': changeDate,
  });

  resetPicker();
  resumeDraft();

  return {
    /** Re-render anything that depends on the saved log (called after History edits). */
    refresh() { if (active) renderExercises(); else renderPicker(); },
  };
}
