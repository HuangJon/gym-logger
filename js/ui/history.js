/** History tab: backup card, list of saved sessions, inline editing, date change, delete. */
import { SESSION_LABELS, SESSION_COLORS } from '../config/program.js';
import { exercisesForSession, findExercise, unitOf, repRangeText, setsOf } from '../core/exercises.js';
import { todayISO, formatLong, agoText } from '../core/dates.js';
import { hasValue, parseWeight, parseReps } from '../core/numbers.js';
import { STATUS, normalizeEntry, statusCounts, byNewest, setsOfEntry, meetsTarget, formatSets } from '../core/records.js';
import { updateEntry, setSessionDate, setSessionDeload, deleteSession, mergeSessions } from '../core/log.js';
import { createBackup, parseBackup, backupStatus, markBackedUp, deliverFile } from '../data/backup.js';
import { esc, delegate, autoResize, confirmTap, flash } from './dom.js';

const EDIT_STATUSES = [[STATUS.COMPLETE, '✓ Done'], [STATUS.PARTIAL, '~ Partial'], [STATUS.SKIP, '✕ Skip']];

export function createHistoryView({ root, repo, storage }) {
  const $ = sel => root.querySelector(sel);
  const ui = { list: $('#history-list'), backupCard: $('#backup-card'), backupStatus: $('#backup-status'), backupMsg: $('#backup-msg'), snapshots: $('#snapshot-list') };

  let expanded = null;   // Set of open session ids; null → open the newest
  let editing = null;    // { sessionId, exerciseId, status } while editing one exercise

  // ── rendering ───────────────────────────────────────────
  function render() {
    renderBackupCard();
    const sessions = [...repo.sessions].sort(byNewest);
    if (!sessions.length) {
      ui.list.innerHTML = '<div class="empty-state">No sessions logged yet.<br>Complete a workout to see it here.</div>';
      return;
    }
    if (!expanded) expanded = new Set([sessions[0].id]);
    ui.list.innerHTML = sessions.map(sessionCard).join('');
    ui.list.querySelectorAll('.hedit-note').forEach(autoResize);
  }

  function sessionCard(s) {
    const open = expanded.has(s.id);
    const exercises = exercisesForSession(s);
    const counts = statusCounts(s);
    return `
      <div class="card history-entry" data-session="${esc(s.id)}">
        <div class="history-hdr" data-action="toggle" aria-expanded="${open}">
          <span class="history-title">${formatLong(s.date)} ${s.program === 'old' ? '<span class="pill-muted">old program</span>' : ''}${s.deload ? '<span class="deload-tag">deload</span>' : ''}</span>
          <span class="history-meta"><span class="history-dot" style="background:${SESSION_COLORS[s.session]}"></span>
            <b style="color:${SESSION_COLORS[s.session]}">${SESSION_LABELS[s.session]}</b> · ${counts.complete + counts.partial}/${exercises.length} done</span>
          <span class="history-chevron">▾</span>
        </div>
        <div class="history-body"${open ? '' : ' hidden'}>
          ${s.note ? `<div class="session-note">↳ ${esc(s.note)}</div>` : ''}
          ${exercises.map(ex => exerciseRow(s, ex)).join('')}
          <div class="entry-date-row">
            <span class="hedit-label">Date</span>
            <input type="date" class="date-input entry-date" value="${s.date}" data-action="entry-date" aria-label="Session date">
            <span class="entry-date-msg"></span>
          </div>
          <div class="entry-date-row">
            <span class="hedit-label">Deload</span>
            <label class="switch"><input type="checkbox" class="entry-deload" data-action="entry-deload"${s.deload ? ' checked' : ''}><span class="switch-track" aria-hidden="true"></span>
              <span class="switch-label entry-deload-text">${s.deload ? 'yes — not counted for progression' : 'no'}</span></label>
          </div>
          <button type="button" class="delete-entry" data-action="delete">Delete this entry</button>
        </div>
      </div>`;
  }

  function exerciseRow(s, ex) {
    const e = normalizeEntry(s.entries?.[ex.id]);
    const isEditing = editing?.sessionId === s.id && editing.exerciseId === ex.id;
    const unit = e.unit || unitOf(ex);
    const parts = e.sets?.length ? [formatSets(e.sets, ex.bw ? '' : unit)]
      : [!ex.bw && hasValue(e.weight) && `${e.weight} ${unit}`, hasValue(e.reps) && `${e.reps} reps`].filter(Boolean);
    if (ex.bw && !parts.length && (e.status === STATUS.COMPLETE || e.status === STATUS.PARTIAL)) parts.push('bodyweight');
    const right = e.status === STATUS.SKIP
      ? '<span class="badge badge-skip">skipped</span>'
      : (parts.length ? `<span class="history-wt">${parts.join(' · ')}</span>` : '') +
        (e.status === STATUS.PARTIAL ? '<span class="badge badge-partial">partial</span>' : '') +
        (e.status === STATUS.UNRECORDED ? '<span class="badge badge-unrec">not recorded</span>' : '') +
        (e.deload === true && !s.deload ? '<span class="deload-tag">deload</span>' : '');
    const dim = e.status === STATUS.SKIP || e.status === STATUS.UNRECORDED;
    return `
      <div class="history-row${dim ? ' dim' : ''}${isEditing ? ' editing' : ''}" data-action="edit" data-ex="${ex.id}">
        <span class="history-ex">${esc(ex.name)}</span>
        <span class="history-right">${right}<span class="edit-icon">✎</span></span>
        ${e.target && e.status !== STATUS.SKIP ? `<div class="history-target">target ${targetText(ex, e.target, unit)}</div>` : ''}
        ${e.note ? `<div class="history-note">↳ ${esc(e.note)}</div>` : ''}
      </div>
      ${isEditing ? editor(ex, e) : ''}`;
  }

  function targetText(ex, t, unit) {
    const weight = !ex.bw && hasValue(t.weight) ? `${t.weight} ${unit} × ` : '';
    return `${weight}${t.reps}${weight ? '' : ' reps'} × ${t.sets} sets`;
  }

  function editor(ex, e) {
    const status = editing.status;
    return `
      <div class="hedit" id="hedit-panel">
        <div class="status-row">${EDIT_STATUSES.map(([value, label]) =>
          `<button type="button" class="status-btn" data-action="edit-status" data-status="${value}" aria-pressed="${status === value}">${label}</button>`).join('')}</div>
        <div class="hedit-fields${status === STATUS.SKIP ? ' is-skip' : ''}">
          ${editorSets(ex, e).map((set, i) => `<div class="hedit-row hedit-setrow">
            <span class="hedit-label">Set ${i + 1}</span>
            ${ex.bw ? '' : `<input class="hedit-input hedit-w" id="hedit-w-${i}" type="number" inputmode="decimal" step="any" value="${hasValue(set.weight) ? set.weight : ''}" placeholder="—" aria-label="Set ${i + 1} weight"><span class="hedit-unit">${e.unit || unitOf(ex)} ×</span>`}
            <input class="hedit-input hedit-r" id="hedit-r-${i}" type="number" inputmode="numeric" min="0" value="${hasValue(set.reps) ? set.reps : ''}" placeholder="—" aria-label="Set ${i + 1} reps">
            <span class="hedit-unit">reps</span></div>`).join('')}
          ${ex.reps ? `<div class="hedit-hint">Rep range ${repRangeText(ex.reps)}.</div>` : ''}
        </div>
        <div class="hedit-row" style="align-items:flex-start"><span class="hedit-label" style="padding-top:5px">Note</span>
          <textarea class="hedit-note" id="hedit-note" rows="1" data-action="autosize">${esc(e.note)}</textarea></div>
        <div class="hedit-hint">Nothing selected = saved as “not recorded”. Blank reps = set not done.${e.target ? ' Done below the target saves as partial.' : ''}</div>
        <div class="hedit-actions">
          <button type="button" class="hedit-save" data-action="edit-save">Save</button>
          <button type="button" class="hedit-cancel" data-action="edit-cancel">Cancel</button>
        </div>
        <div class="hedit-msg" id="hedit-msg"></div>
      </div>`;
  }

  /** Rows for the editor: what was logged (older logs: weight × reps repeated per set), plus blanks up to the target. */
  function editorSets(ex, e) {
    const count = Math.max(e.sets?.length || 0, e.target?.sets || 0, setsOf(ex));
    const sets = setsOfEntry(e, e.sets?.length ? e.sets.length : count);
    return Array.from({ length: count }, (_, i) => sets[i] ?? { weight: e.weight });
  }

  function renderBackupCard() {
    const { last, stale } = backupStatus(storage, repo.sessions.length, todayISO());
    ui.backupStatus.textContent = `· your log is saved on this phone · last backup: ${last ? agoText(last, todayISO()) : 'never'}`;
    ui.backupCard.classList.toggle('stale', stale);
    const snaps = repo.snapshots();
    ui.snapshots.innerHTML = snaps.length
      ? snaps.map((snap, i) => `<div class="snap-row"><span>${esc(formatSaved(snap.savedAt))} · ${snap.count} session${snap.count === 1 ? '' : 's'}</span>
          <button type="button" class="btn-small" data-action="restore" data-i="${i}">Restore</button></div>`).join('')
      : '<p class="bk-hint">No earlier copies yet — one is kept each time you save.</p>';
  }

  const formatSaved = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  async function restore(btn) {
    if (!confirmTap(btn, 'Tap again')) return;
    const when = formatSaved(repo.snapshots()[Number(btn.dataset.i)]?.savedAt);
    try {
      await repo.restoreSnapshot(Number(btn.dataset.i));
      expanded = null;
      editing = null;
      render();
      flash(ui.backupMsg, `Restored the copy from ${when}. Your previous log was kept as a copy.`, { ms: 0 });
    } catch (err) {
      flash(ui.backupMsg, err.message || 'Restore failed.', { error: true, ms: 0 });
    }
  }

  // ── actions ─────────────────────────────────────────────
  const sessionIdOf = el => el.closest('[data-session]').dataset.session;

  function toggle(el) {
    const id = sessionIdOf(el);
    if (expanded.has(id)) { expanded.delete(id); if (editing?.sessionId === id) editing = null; }
    else expanded.add(id);
    render();
  }

  function openEditor(el) {
    const sessionId = sessionIdOf(el), exerciseId = el.dataset.ex;
    if (editing?.sessionId === sessionId && editing.exerciseId === exerciseId) { editing = null; render(); return; }
    const record = repo.sessions.find(s => s.id === sessionId);
    const status = normalizeEntry(record?.entries?.[exerciseId]).status;
    editing = { sessionId, exerciseId, status: status === STATUS.UNRECORDED ? '' : status };
    render();
  }

  function setEditStatus(el) {
    editing.status = editing.status === el.dataset.status ? '' : el.dataset.status;
    const panel = $('#hedit-panel');
    panel.querySelectorAll('.status-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === editing.status)));
    panel.querySelector('.hedit-fields').classList.toggle('is-skip', editing.status === STATUS.SKIP);
  }

  async function saveEdit() {
    const ex = findExercise(editing.exerciseId);
    const record = repo.sessions.find(s => s.id === editing.sessionId);
    const previous = normalizeEntry(record?.entries?.[editing.exerciseId]);
    const panel = $('#hedit-panel');
    const sets = [...panel.querySelectorAll('.hedit-setrow')].map(row => {
      const reps = parseReps(row.querySelector('.hedit-r').value), weight = ex.bw ? null : parseWeight(row.querySelector('.hedit-w')?.value ?? '');
      return hasValue(reps) && reps > 0 ? (weight !== null ? { weight, reps } : { reps }) : null;   // blank reps = set not done
    }).filter(Boolean);
    const entry = { status: editing.status || STATUS.UNRECORDED, note: $('#hedit-note').value.trim() };
    if (entry.status !== STATUS.SKIP && sets.length) { entry.sets = sets; entry.unit = previous.unit || unitOf(ex); }   // weights are edited in the unit they were logged in
    if (previous.target) entry.target = previous.target;
    if (typeof previous.deload === 'boolean') entry.deload = previous.deload;
    // "Done" that falls short of the target is a partial — keeps next time's target honest
    if (entry.status === STATUS.COMPLETE && previous.target && !meetsTarget(sets, previous.target)) entry.status = STATUS.PARTIAL;
    try {
      await repo.commit(updateEntry(repo.sessions, editing.sessionId, editing.exerciseId, entry));
    } catch (err) {
      $('#hedit-msg').textContent = `Save failed: ${err?.message || err}`;
      return;
    }
    editing = null;
    render();
  }

  async function changeDate(input) {
    const id = sessionIdOf(input), previous = repo.sessions.find(s => s.id === id)?.date;
    try {
      await repo.commit(setSessionDate(repo.sessions, id, input.value));
    } catch {
      input.value = previous;
      input.parentElement.querySelector('.entry-date-msg').textContent = 'Save failed';
    }
  }

  async function changeDeload(input) {
    try {
      await repo.commit(setSessionDeload(repo.sessions, sessionIdOf(input), input.checked));
    } catch {
      input.checked = !input.checked;
      input.closest('.entry-date-row').querySelector('.entry-deload-text').textContent = 'Save failed';
    }
  }

  async function remove(btn) {
    if (!confirmTap(btn, 'Tap again to confirm delete')) return;
    const id = sessionIdOf(btn);
    try {
      await repo.commit(deleteSession(repo.sessions, id));
    } catch {
      btn.textContent = 'Delete failed — try again';
    }
  }

  async function exportBackup() {
    const today = todayISO();
    const delivered = await deliverFile(createBackup(repo.sessions, today));
    if (!delivered) return;
    markBackedUp(storage, today);
    renderBackupCard();
    flash(ui.backupMsg, `Exported ${repo.sessions.length} sessions. Save it to Files / iCloud Drive.`, { ms: 0 });
  }

  async function importBackup(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { sessions, skipped } = parseBackup(await file.text());
      const merged = mergeSessions(repo.sessions, sessions);
      await repo.commit(merged.sessions);
      expanded = null;
      editing = null;
      render();
      flash(ui.backupMsg, `Imported ${sessions.length} session${sessions.length === 1 ? '' : 's'}: ${merged.added} new, ${merged.updated} updated${skipped ? `, ${skipped} skipped (unreadable)` : ''}.`, { ms: 0 });
    } catch (err) {
      flash(ui.backupMsg, err.message || 'Import failed.', { error: true, ms: 0 });
    }
  }

  // ── wiring ──────────────────────────────────────────────
  delegate(root, 'click', {
    'toggle': toggle,
    'edit': openEditor,
    'edit-status': setEditStatus,
    'edit-save': saveEdit,
    'edit-cancel': () => { editing = null; render(); },
    'delete': remove,
    'export': exportBackup,
    'restore': restore,
  });
  delegate(root, 'input', { 'autosize': autoResize });
  delegate(root, 'change', { 'entry-date': changeDate, 'entry-deload': changeDeload, 'import': importBackup });

  return {
    render,
    /** Open the newest session next time (after completing a workout). */
    showNewest() { expanded = null; editing = null; },
  };
}
