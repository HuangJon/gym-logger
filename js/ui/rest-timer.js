/**
 * Rest timer bar: counts down after a logged set, beeps and vibrates (where the phone allows) at zero.
 * Works from an end time, so it stays right if the app is in the background for a while.
 * Note: a web app can't alert you while the phone is locked — the beep plays if the app is open.
 */
import { esc } from './dom.js';

const TICK_MS = 250;
const DONE_VISIBLE_MS = 20_000;
const ADJUST_SECONDS = 15;

export const formatClock = seconds => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createRestTimer({ el, onChange = () => {}, now = () => Date.now() }) {
  let state = null;   // { endsAt, exId, label, total }
  let tick = null, beep = null, audio = null, doneAt = null;

  function render() {
    if (!state) { el.hidden = true; el.innerHTML = ''; return; }
    const left = (state.endsAt - now()) / 1000;
    el.hidden = false;
    el.classList.toggle('is-done', left <= 0);
    const pct = state.total ? Math.max(0, Math.min(100, (left / state.total) * 100)) : 0;
    el.innerHTML = left > 0
      ? `<div class="rest-progress" style="width:${pct.toFixed(1)}%"></div>
         <span class="rest-label">Rest${state.label ? ` · ${esc(state.label)}` : ''}</span>
         <span class="rest-clock">${formatClock(left)}</span>
         <button type="button" class="rest-btn" data-action="rest-adjust" data-dir="-1" aria-label="${ADJUST_SECONDS} seconds less">−${ADJUST_SECONDS}</button>
         <button type="button" class="rest-btn" data-action="rest-adjust" data-dir="1" aria-label="${ADJUST_SECONDS} seconds more">+${ADJUST_SECONDS}</button>
         <button type="button" class="rest-btn rest-close" data-action="rest-stop" aria-label="Stop rest timer">✕</button>`
      : `<span class="rest-label">Rest's up — next set 💪</span>
         <button type="button" class="rest-btn rest-close" data-action="rest-stop" aria-label="Close">✕</button>`;
  }

  function loop() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!state) return clearInterval(tick);
      const left = state.endsAt - now();
      if (left <= 0 && doneAt === null) { doneAt = now(); try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ } }
      if (doneAt !== null && now() - doneAt > DONE_VISIBLE_MS) return stop();
      render();
    }, TICK_MS);
  }

  /** Must be called from a tap so the phone allows sound later. */
  function unlockAudio() {
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      audio ||= new Ctx();
      if (audio.state === 'suspended') audio.resume();
    } catch { audio = null; }
  }

  /** Schedule the beep in the audio clock, so it fires on time even if timers are throttled. */
  function scheduleBeep() {
    try { beep?.stop(); } catch { /* already stopped */ }
    beep = null;
    if (!audio || !state) return;
    const left = (state.endsAt - now()) / 1000;
    if (left <= 0) return;
    try {
      const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + left;
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, audio.currentTime);
      for (const [start, end] of [[0, 0.15], [0.25, 0.4]]) {
        gain.gain.setValueAtTime(0.25, t + start);
        gain.gain.setValueAtTime(0, t + end);
      }
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.5);
      beep = osc;
    } catch { beep = null; }
  }

  function start({ exId, label, seconds }) {
    unlockAudio();
    state = { endsAt: now() + seconds * 1000, exId, label, total: seconds };
    doneAt = null;
    scheduleBeep();
    render();
    loop();
    onChange(snapshot());
  }

  /** Bring back a timer saved with the workout (no sound unless the user taps again). */
  function resume(saved, label) {
    if (!saved || saved.endsAt - now() < -DONE_VISIBLE_MS) return;
    state = { ...saved, label };
    doneAt = saved.endsAt <= now() ? now() : null;
    render();
    loop();
  }

  function adjust(direction) {
    if (!state) return;
    unlockAudio();
    const left = Math.max(0, state.endsAt - now()) + direction * ADJUST_SECONDS * 1000;
    if (left <= 0) return stop();
    state.endsAt = now() + left;
    state.total = Math.max(state.total, left / 1000);
    scheduleBeep();
    render();
    onChange(snapshot());
  }

  function stop() {
    clearInterval(tick);
    try { beep?.stop(); } catch { /* already stopped */ }
    beep = null;
    state = null;
    doneAt = null;
    render();
    onChange(null);
  }

  const snapshot = () => (state ? { endsAt: state.endsAt, exId: state.exId, total: state.total } : null);

  return { start, resume, adjust, stop, snapshot, get running() { return !!state; } };
}
