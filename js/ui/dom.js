/** DOM helpers shared by the screens. */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for safe insertion into HTML (notes can contain anything). */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);

/**
 * Event delegation: one listener on `root` for `type`, dispatching to handlers[el.dataset.action]
 * for the closest element with a data-action attribute. Screens never use inline onclick.
 */
export function delegate(root, type, handlers) {
  root.addEventListener(type, event => {
    const el = event.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    handlers[el.dataset.action]?.(el, event);
  });
}

/** Grow a textarea to fit its content. */
export function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * Two-tap confirm for destructive buttons (the browser's confirm() isn't reliable everywhere).
 * Returns true on the second tap within `ms`; the first tap arms the button and shows `armedText`.
 */
export function confirmTap(button, armedText, ms = 3000) {
  if (button.dataset.armed) return true;
  const original = button.textContent;
  button.dataset.armed = '1';
  button.textContent = armedText;
  button.classList.add('btn-confirm');
  setTimeout(() => {
    if (!button.isConnected || !button.dataset.armed) return;
    delete button.dataset.armed;
    button.textContent = original;
    button.classList.remove('btn-confirm');
  }, ms);
  return false;
}

/** Show a message in `el` for `ms` (0 = until replaced). */
export function flash(el, text, { error = false, ms = 3000 } = {}) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (ms) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, ms);
}
