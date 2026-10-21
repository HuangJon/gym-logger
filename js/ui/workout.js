/** Workout tab: pick a date + session, log each exercise against its target, complete the session. */
import { PREHAB, SESSION_LABELS, SESSION_COLORS, STALE_AFTER_DAYS } from '../config/program.js';
import { sessionExercises, findExercise, unitOf, repRangeText } from '../core/exercises.js';
import { todayISO, isISODate, formatShort, agoText, daysBetween } from '../core/dates.js';
import { hasValue, parseWeight } from '../core/numbers.js';
import { STATUS, buildSessionRecord, setsOfEntry } from '../core/records.js';
import { addSession } from '../core/log.js';
import { lastPerformance, computeTarget, targetReason, stepWeight, stepReps, attemptBadge } from '../core/progress.js';
import { esc, delegate, autoResize, flash } from './dom.js';

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
  let scratch = {};    // { [exerciseId]: { status?, note?, weight?, sets?, selected? } } — not saved until Complete
  let saving = false;

  const entryFor = id => (scratch[id] ||= {});
  const lastFor = (ex, date = active.date) => lastPerformance(repo.sessions, ex, date);
  const targetFor = (ex, date) => computeTarget(ex, lastFor(ex, date));
  /** What the card currently shows: your changes, otherwise the target. */
  const currentWeight = ex => ex.bw ? null : (scratch[ex.id]?.weight ?? targetFor(ex)?.weight ?? null);
  const currentSets = ex => scratch[ex.id]?.sets ?? (t => Array(t.sets).fill(t.reps))(targetFor(ex));

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
    const rows = sessionExercises(n).map(ex => `<div class="preview-ex"><span class="preview-ex-name">${esc(ex.name)}</span>
      <span class="preview-ex-detail">${esc(ex.detail)} · <b>${targetText(ex, targetFor(ex, date))}</b></span></div>`).join('');
    ui.preview.innerHTML = `<div class="card preview">
      <div class="preview-header" style="color:${SESSION_COLORS[n]}">${SESSION_LABELS[n]} — today's targets</div>
      <div class="preview-list">${rows}</div></div>`;
  }

  function targetText(ex, t) {
    if (!t) return '';
    const weight = ex.bw ? '' : (hasValue(t.weight) ? `${t.weight} ${unitOf(ex)} × ` : '');
    return `${weight}${t.reps}${ex.bw || !hasValue(t.weight) ? ' reps' : ''} × ${t.sets} sets`;
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
    const tags = [ex.tag && `<span class="ex-tag tag-circuit">${esc(ex.tag)}</span>`, ex.warn && `<span class="ex-tag tag-warn">${esc(ex.warn)}</span>`].filter(Boolean).join('');
    return `
      <div class="card ex-card s${active.sessionNum}${sc.status === STATUS.SKIP ? ' is-skipped' : ''}" id="card-${ex.id}" data-ex="${ex.id}">
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
        <div class="ex-log"${sc.status === STATUS.SKIP ? ' hidden' : ''}>
          ${ex.bw ? '' : `<div class="ex-row log-line"><span class="row-label">Weight</span><div class="weight-box" id="wb-${ex.id}">${weightBoxInner(ex)}</div></div>`}
          ${setsRow(ex)}
        </div>
        <div class="ex-row status-row">
          <button type="button" class="status-btn" data-action="status" data-status="${STATUS.COMPLETE}" aria-pressed="${sc.status === STATUS.COMPLETE}">✓ Done</button>
          <button type="button" class="status-btn" data-action="status" data-status="${STATUS.SKIP}" aria-pressed="${sc.status === STATUS.SKIP}">✕ Skip</button>
        </div>
        <div class="ex-row note-row">
          <span class="note-icon">✎</span>
          <textarea class="note-input" id="note-${ex.id}" rows="1" placeholder="notes (optional)…" data-action="note">${esc(sc.note || '')}</textarea>
        </div>
      </div>`;
  }

  function targetRow(ex) {
    const last = lastFor(ex), target = computeTarget(ex, last);
    if (!target) return '';
    const unit = unitOf(ex), reason = targetReason(ex, target, last, unit);
    const needsWeight = !ex.bw && !hasValue(target.weight);
    return `<div class="ex-row target-row">
      <span class="row-label">Target</span>
      <span class="target-val"><b>${targetText(ex, target)}</b>${needsWeight ? ' <span class="last-when">· set a weight</span>' : ''}</span>
      ${reason ? `<span class="target-reason">${reason}</span>` : ''}
    </div>`;
  }

  function lastRow(ex) {
    const last = lastFor(ex);
    if (!last) return '<div class="ex-row last-row"><span class="row-label">Last</span><span class="last-none">no previous log</span></div>';
    const unit = last.unit || unitOf(ex);
    const sets = setsOfEntry(last, 1).map(r => (r === 0 ? '–' : r)).join(', ');
    const value = [!ex.bw && hasValue(last.weight) && `${last.weight} ${unit}`, sets && `${sets} reps`].filter(Boolean).join(' × ');
    const stale = daysBetween(last.date, active.date) > STALE_AFTER_DAYS;
    return `<div class="ex-row last-row">
      <span class="row-label">Last</span>
      <span class="last-val">${value}${last.status === STATUS.PARTIAL ? ' <span class="badge badge-partial">partial</span>' : ''}
        <span class="last-when">${formatShort(last.date)} · ${agoText(last.date, active.date)}</span></span>
      ${stale ? '<span class="last-stale">⏳ been a while — ease back in</span>' : ''}
    </div>`;
  }

  function weightBoxInner(ex) {
    const w = currentWeight(ex);
    const value = w == null
      ? `<span class="weight-placeholder" id="wp-${ex.id}" tabindex="0" role="button" data-action="edit-weight">–</span>`
      : `<span class="weight-val" id="wv-${ex.id}" tabindex="0" role="button" data-action="edit-weight">${w}</span>`;
    return `<div class="weight-row">
      <button type="button" class="stepper" data-action="weight-step" data-dir="-1" aria-label="Less weight"${w == null ? ' disabled' : ''}>−</button>
      ${value}<span class="weight-unit">${unitOf(ex)}</span>
      <button type="button" class="stepper" data-action="weight-step" data-dir="1" aria-label="More weight">+</button>
    </div>`;
  }

  function setsRow(ex) {
    if (!ex.reps) return '';
    return `<div class="ex-row log-line sets-line">
      <span class="row-label">Sets</span>
      <div class="sets-box" id="sets-${ex.id}">${setsInner(ex)}</div>
    </div>`;
  }

  function setsInner(ex) {
    const sets = currentSets(ex), selected = scratch[ex.id]?.selected ?? sets.length - 1;
    const touched = scratch[ex.id]?.sets || scratch[ex.id]?.weight !== undefined;   // no verdict until you change something
    const badge = touched ? attemptBadge({ weight: currentWeight(ex), sets }, targetFor(ex)) : { label: '' };
    return `
      <div class="set-chips">${sets.map((r, i) => `<button type="button" class="set-chip${r === 0 ? ' not-done' : ''}" data-action="set-select" data-i="${i}" aria-pressed="${i === selected}" aria-label="Set ${i + 1}: ${r} reps">${r === 0 ? '–' : r}</button>`).join('')}</div>
      <div class="set-controls">
        <button type="button" class="stepper" data-action="set-step" data-dir="-1" aria-label="One less rep">−</button>
        <span class="set-label">set ${selected + 1}</span>
        <button type="button" class="stepper" data-action="set-step" data-dir="1" aria-label="One more rep">+</button>
        <span class="reps-target">/ ${repRangeText(ex.reps)}</span>
      </div>
      ${badge.label ? `<span class="prog-badge ${badge.cls}" id="pb-${ex.id}">${badge.label}</span>` : ''}`;
  }

  // ── editing ─────────────────────────────────────────────
  /** Redraw only part of a card — redrawing the list would wipe whatever you tapped next. */
  const refreshWeightBox = exId => { const el = ui.exercises.querySelector(`#wb-${exId}`); if (el) el.innerHTML = weightBoxInner(findExercise(exId)); };
  const refreshSets = exId => { const el = ui.exercises.querySelector(`#sets-${exId}`); if (el) el.innerHTML = setsInner(findExercise(exId)); };

  function startWeightEdit(exId) {
    const ex = findExercise(exId), box = ui.exercises.querySelector(`#wb-${exId}`);
    if (!ex || !box || box.querySelector('input')) return;
    box.innerHTML = `<div class="weight-row"><input type="number" inputmode="decimal" step="any" class="weight-input" id="inp-${exId}" value="${currentWeight(ex) ?? ''}" aria-label="${esc(ex.name)} weight"><span class="weight-unit">${unitOf(ex)}</span></div>`;
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
      refreshSets(exId);
    }, { once: true });
    input.focus();
    input.select();
  }

  function stepWeightBy(exId, direction) {
    const ex = findExercise(exId), current = currentWeight(ex);
    if (current == null && direction < 0) return;
    entryFor(exId).weight = stepWeight(ex, current ?? 0, direction);   // nothing yet → + starts from 0
    refreshWeightBox(exId);
    refreshSets(exId);   // the badge compares weight with the target
  }

  function selectSet(exId, i) {
    entryFor(exId).selected = i;
    refreshSets(exId);
  }

  function stepSet(exId, direction) {
    const ex = findExercise(exId), sc = entryFor(exId), sets = [...currentSets(ex)];
    const i = sc.selected ?? sets.length - 1;
    sets[i] = stepReps(sets[i], direction, ex.reps);
    sc.sets = sets;
    refreshSets(exId);
  }

  function setStatus(card, value) {
    const sc = entryFor(card.dataset.ex);
    sc.status = sc.status === value ? '' : value;   // tap again to clear
    card.classList.toggle('is-skipped', sc.status === STATUS.SKIP);
    card.querySelector('.ex-log').hidden = sc.status === STATUS.SKIP;
    card.querySelectorAll('.status-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === sc.status)));
  }

  function changeDate(input) {
    if (!isISODate(input.value)) { input.value = active.date; return; }
    active.date = input.value;
    renderExercises();   // targets depend on the date; your changes live in `scratch`
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
      const record = buildSessionRecord({ sessionNum: active.sessionNum, date: active.date, scratch, targetOf: ex => targetFor(ex) });
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
    'edit-weight': el => startWeightEdit(exIdOf(el)),
    'weight-step': el => stepWeightBy(exIdOf(el), Number(el.dataset.dir)),
    'set-select': el => selectSet(exIdOf(el), Number(el.dataset.i)),
    'set-step': el => stepSet(exIdOf(el), Number(el.dataset.dir)),
    'status': el => setStatus(el.closest('[data-ex]'), el.dataset.status),
    'complete': complete,
  });
  delegate(root, 'keydown', {
    'edit-weight': (el, e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startWeightEdit(exIdOf(el)); } },
  });
  delegate(root, 'input', {
    'note': el => { entryFor(exIdOf(el)).note = el.value; autoResize(el); },
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
