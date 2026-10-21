/** Workout tab: pick a date + session, log each exercise, complete the session. */
import { PREHAB, SESSION_LABELS, SESSION_COLORS, STALE_AFTER_DAYS } from '../config/program.js';
import { sessionExercises, findExercise, unitOf, repRangeText } from '../core/exercises.js';
import { todayISO, isISODate, formatShort, agoText, daysBetween } from '../core/dates.js';
import { hasValue, parseWeight, parseReps } from '../core/numbers.js';
import { STATUS, buildSessionRecord } from '../core/records.js';
import { addSession } from '../core/log.js';
import { lastPerformance, plannedWeight, repsBadge, nextStepHint } from '../core/progress.js';
import { esc, delegate, autoResize, flash } from './dom.js';

const STATUS_BUTTONS = [[STATUS.COMPLETE, '✓ Done'], [STATUS.PARTIAL, '~ Partial'], [STATUS.SKIP, '✕ Skip']];
const COMPLETE_LABEL = 'Complete Session';

export function createWorkoutView({ root, repo, onSaved }) {
  const $ = sel => root.querySelector(sel);
  const ui = {
    pickerPanel: $('#picker-panel'), sessionPanel: $('#session-panel'),
    pickDate: $('#pick-date'), pickSession: $('#pick-session'), startBtn: $('#start-btn'),
    preview: $('#session-preview-area'), hint: $('#picker-hint'),
    header: $('#session-header'), prehab: $('#prehab'), exercises: $('#exercise-area'),
    completeBtn: $('#complete-btn'), status: $('#status'),
  };

  let active = null;   // { sessionNum, date } while logging
  let scratch = {};    // { [exerciseId]: { status?, note?, weight?, reps? } } — not saved until Complete
  let saving = false;

  const entryFor = id => (scratch[id] ||= {});
  const planned = (ex, date = active?.date) => plannedWeight(repo.sessions, ex, { typed: scratch[ex.id]?.weight, beforeDate: date });

  // ── picker ──────────────────────────────────────────────
  function resetPicker() {
    ui.pickDate.value = todayISO();
    ui.pickSession.value = '';
    renderPreview();
  }

  function renderPreview() {
    const n = Number(ui.pickSession.value);
    ui.startBtn.disabled = !n;
    ui.hint.hidden = !!n;
    if (!n) { ui.preview.innerHTML = ''; return; }
    const date = isISODate(ui.pickDate.value) ? ui.pickDate.value : todayISO();
    const rows = sessionExercises(n).map(ex => {
      const w = planned(ex, date);
      const weight = ex.bw ? 'bodyweight' : (w != null ? `${w} ${unitOf(ex)}` : '—');
      return `<div class="preview-ex"><span class="preview-ex-name">${esc(ex.name)}</span><span class="preview-ex-detail">${esc(ex.detail)} · <b>${weight}</b></span></div>`;
    }).join('');
    ui.preview.innerHTML = `<div class="card preview">
      <div class="preview-header" style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]} — exercise preview</div>
      <div class="preview-list">${rows}</div></div>`;
  }

  function start() {
    const n = Number(ui.pickSession.value);
    if (!n) return;
    active = { sessionNum: n, date: isISODate(ui.pickDate.value) ? ui.pickDate.value : todayISO() };
    scratch = {};
    ui.pickerPanel.hidden = true;
    ui.sessionPanel.hidden = false;
    flash(ui.status, '', { ms: 0 });
    renderHeader();
    renderExercises();
  }

  function endSession() {
    active = null;
    scratch = {};
    ui.sessionPanel.hidden = true;
    ui.pickerPanel.hidden = false;
    resetPicker();
  }

  // ── active session ──────────────────────────────────────
  function renderHeader() {
    const { sessionNum: n, date } = active;
    ui.header.innerHTML = `
      <span class="dot" style="background:${SESSION_COLORS[n]}"></span>
      <h2 style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]}</h2>
      <input type="date" class="date-input" id="active-date" value="${date}" data-action="active-date" aria-label="Session date">
      <button type="button" class="link-btn sa-change" data-action="ask-discard">change</button>`;
  }

  function askDiscard() {
    if (ui.header.querySelector('.discard-bar')) return;
    ui.header.insertAdjacentHTML('beforeend', `<div class="discard-bar"><span>Discard this session?</span>
      <button type="button" class="discard-yes" data-action="discard">Yes, discard</button>
      <button type="button" data-action="keep">Keep going</button></div>`);
  }

  function renderExercises() {
    ui.exercises.innerHTML = sessionExercises(active.sessionNum).map(exerciseCard).join('');
    ui.exercises.querySelectorAll('.note-input').forEach(autoResize);
  }

  function exerciseCard(ex) {
    const sc = scratch[ex.id] || {};
    const status = sc.status || '';
    const tags = [ex.tag && `<span class="ex-tag tag-circuit">${esc(ex.tag)}</span>`, ex.warn && `<span class="ex-tag tag-warn">${esc(ex.warn)}</span>`].filter(Boolean).join('');
    return `
      <div class="card ex-card s${active.sessionNum}${status === STATUS.SKIP ? ' is-skipped' : ''}" id="card-${ex.id}" data-ex="${ex.id}">
        <div class="ex-header">
          <div>
            <div class="ex-name">${esc(ex.name)}</div>
            <div class="ex-detail">${esc(ex.detail)}</div>
            ${tags ? `<div class="ex-tags">${tags}</div>` : ''}
          </div>
          <div>${ex.bw ? '<span class="weight-bw">bodyweight</span>' : `<div class="weight-box" id="wb-${ex.id}">${weightBoxInner(ex)}</div>`}</div>
        </div>
        ${lastTimeRow(ex)}
        ${repsRow(ex, sc)}
        <div class="ex-row status-row">
          <span class="status-label">Mark:</span>
          ${STATUS_BUTTONS.map(([value, label]) => `<button type="button" class="status-btn" data-action="status" data-status="${value}" aria-pressed="${status === value}">${label}</button>`).join('')}
        </div>
        <div class="ex-row note-row">
          <span class="note-icon">✎</span>
          <textarea class="note-input" id="note-${ex.id}" rows="1" placeholder="notes (optional)…" data-action="note">${esc(sc.note || '')}</textarea>
        </div>
      </div>`;
  }

  function weightBoxInner(ex) {
    const w = planned(ex);
    return w != null
      ? `<div class="weight-row"><span class="weight-val" id="wv-${ex.id}" tabindex="0" role="button" data-action="edit-weight">${w}</span><span class="weight-unit">${unitOf(ex)}</span></div>`
      : `<div class="weight-row"><span class="weight-placeholder" id="wp-${ex.id}" tabindex="0" role="button" data-action="edit-weight">log weight</span></div>`;
  }

  function lastTimeRow(ex) {
    const last = lastPerformance(repo.sessions, ex, active.date);
    if (!last) return '<div class="ex-row last-row"><span class="last-label">Last time</span><span class="last-none">no previous log</span></div>';
    const unit = last.unit || unitOf(ex);
    const value = [!ex.bw && hasValue(last.weight) && `${last.weight} ${unit}`, hasValue(last.reps) && `${last.reps} reps`].filter(Boolean).join(' × ');
    const hint = nextStepHint(ex, last);
    const stale = daysBetween(last.date, active.date) > STALE_AFTER_DAYS;
    return `<div class="ex-row last-row">
      <span class="last-label">Last time</span>
      <span class="last-val"><b>${value}</b>${last.status === STATUS.PARTIAL ? ' <span class="badge badge-partial">partial</span>' : ''}
        <span class="last-when">${formatShort(last.date)} · ${agoText(last.date, active.date)}</span></span>
      ${hint ? `<span class="last-hint">${hint}</span>` : ''}
      ${stale ? '<span class="last-stale">⏳ been a while — ease back in</span>' : ''}
    </div>`;
  }

  function repsRow(ex, sc) {
    if (!ex.reps) return '';
    const reps = sc.reps ?? '';
    const badge = repsBadge(reps, ex.reps);
    return `<div class="ex-row reps-row"${sc.status === STATUS.SKIP ? ' hidden' : ''}>
      <div class="reps-left">
        <span class="reps-label">Reps hit:</span>
        <input class="reps-input" type="number" inputmode="numeric" min="0" max="99" placeholder="–" id="reps-${ex.id}" value="${esc(reps)}" data-action="reps">
        <span class="reps-target">/ ${repRangeText(ex.reps)} reps</span>
      </div>
      <span class="prog-badge ${badge.cls}" id="pb-${ex.id}">${badge.label}</span>
    </div>`;
  }

  // ── editing ─────────────────────────────────────────────
  /** Redraw only this weight box — redrawing the list would wipe whatever you tapped next. */
  function refreshWeightBox(exId) {
    const box = ui.exercises.querySelector(`#wb-${exId}`);
    if (box) box.innerHTML = weightBoxInner(findExercise(exId));
  }

  function startWeightEdit(exId) {
    const ex = findExercise(exId), box = ui.exercises.querySelector(`#wb-${exId}`);
    if (!ex || !box || box.querySelector('input')) return;
    box.innerHTML = `<div class="weight-row"><input type="number" inputmode="decimal" step="any" class="weight-input" id="inp-${exId}" value="${planned(ex) ?? ''}" aria-label="${esc(ex.name)} weight"><span class="weight-unit">${unitOf(ex)}</span></div>`;
    const input = box.querySelector('input');
    let cancelled = false;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { cancelled = true; input.blur(); }
    });
    input.addEventListener('blur', () => {
      const weight = parseWeight(input.value);
      if (!cancelled && weight !== null) entryFor(exId).weight = weight;
      refreshWeightBox(exId);
    }, { once: true });
    input.focus();
    input.select();
  }

  function setStatus(card, value) {
    const exId = card.dataset.ex, sc = entryFor(exId);
    sc.status = sc.status === value ? '' : value;   // tap again to clear
    card.classList.toggle('is-skipped', sc.status === STATUS.SKIP);
    card.querySelectorAll('.status-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === sc.status)));
    const reps = card.querySelector('.reps-row');
    if (reps) reps.hidden = sc.status === STATUS.SKIP;
  }

  function setReps(input) {
    const exId = input.closest('[data-ex]').dataset.ex, reps = parseReps(input.value);
    entryFor(exId).reps = reps === null ? '' : reps;
    const badge = repsBadge(entryFor(exId).reps, findExercise(exId).reps);
    const el = ui.exercises.querySelector(`#pb-${exId}`);
    el.className = `prog-badge ${badge.cls}`;
    el.textContent = badge.label;
  }

  function changeDate(input) {
    if (!isISODate(input.value)) { input.value = active.date; return; }
    active.date = input.value;
    renderExercises();   // "last time" depends on the date; typed values live in `scratch`
  }

  // ── complete ────────────────────────────────────────────
  async function complete() {
    if (saving || !active) return;
    const btn = ui.completeBtn;
    const marked = sessionExercises(active.sessionNum).some(ex => scratch[ex.id]?.status);
    if (!marked && !btn.dataset.armed) {   // ask before saving a session where nothing is marked
      btn.dataset.armed = '1';
      btn.textContent = 'Nothing marked yet — tap again to save anyway';
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; if (!saving) btn.textContent = COMPLETE_LABEL; } }, 4000);
      return;
    }
    delete btn.dataset.armed;
    saving = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const record = buildSessionRecord({ sessionNum: active.sessionNum, date: active.date, scratch, plannedWeight: ex => planned(ex) });
      await repo.commit(addSession(repo.sessions, record));
      endSession();
      flash(ui.status, 'Session saved ✓');
      onSaved?.(record);
    } catch (err) {
      flash(ui.status, 'Save failed — your entries are still here, try again', { error: true, ms: 0 });
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

  delegate(root, 'click', {
    'start': start,
    'ask-discard': askDiscard,
    'discard': endSession,
    'keep': el => el.closest('.discard-bar').remove(),
    'edit-weight': el => startWeightEdit(el.closest('[data-ex]').dataset.ex),
    'status': el => setStatus(el.closest('[data-ex]'), el.dataset.status),
    'complete': complete,
  });
  delegate(root, 'keydown', {
    'edit-weight': (el, e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startWeightEdit(el.closest('[data-ex]').dataset.ex); } },
  });
  delegate(root, 'input', {
    'reps': setReps,
    'note': el => { entryFor(el.closest('[data-ex]').dataset.ex).note = el.value; autoResize(el); },
  });
  delegate(root, 'change', {
    'pick-session': renderPreview,
    'pick-date': renderPreview,
    'active-date': changeDate,
  });

  resetPicker();

  return {
    /** Re-render anything that depends on the saved log (called after History edits). */
    refresh() { if (active) renderExercises(); else renderPreview(); },
  };
}
