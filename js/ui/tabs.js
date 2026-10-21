/** Tab bar: switches panes and keeps the pinned Trends controls sitting just under the tab bar. */
export function createTabs(doc, { onShow } = {}) {
  const bar = doc.querySelector('.tab-bar');
  const buttons = [...bar.querySelectorAll('[data-tab]')];
  let current = buttons.find(b => b.classList.contains('active'))?.dataset.tab;

  function show(name) {
    current = name;
    for (const b of buttons) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      doc.getElementById(`tab-${b.dataset.tab}`).classList.toggle('active', on);
    }
    onShow?.(name);
  }

  const syncHeight = () => doc.documentElement.style.setProperty('--tabbar-h', `${bar.getBoundingClientRect().height}px`);
  bar.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  window.addEventListener('resize', syncHeight);
  syncHeight();

  return { show, get current() { return current; } };
}
