/** App entry point: wires storage, the saved log and the three screens together. */
import { createLocalStorage, requestPersistentStorage } from './data/storage.js';
import { createRepository } from './data/repository.js';
import { createSettings } from './data/settings.js';
import { setUnitChoices } from './core/exercises.js';
import { createTabs } from './ui/tabs.js';
import { createWorkoutView } from './ui/workout.js';
import { createHistoryView } from './ui/history.js';
import { createTrendsView } from './ui/trends.js';

const SWITCH_TO_HISTORY_MS = 600;

const storage = createLocalStorage();
requestPersistentStorage();
const repo = createRepository(storage);
const settings = createSettings(storage);
setUnitChoices(settings.get().units);
repo.load();
document.getElementById('readonly-banner').hidden = !repo.readOnly;

const tabs = createTabs(document, { onShow: name => { if (name === 'trends') trends.render(); } });
const history = createHistoryView({
  root: document.getElementById('tab-history'), repo, storage, settings,
  onSettingsImported: () => { setUnitChoices(settings.get().units); workout.refresh(); },
});
const trends = createTrendsView({ root: document.getElementById('tab-trends'), repo });
const workout = createWorkoutView({
  root: document.getElementById('tab-workout'),
  repo,
  storage,
  settings,
  onUnitsChanged: () => { if (tabs.current === 'trends') trends.render(); },
  onSaved: () => {
    history.showNewest();
    history.render();
    setTimeout(() => tabs.show('history'), SWITCH_TO_HISTORY_MS);
  },
});

// Any saved change refreshes the screens that show the log.
repo.subscribe(() => {
  history.render();
  workout.refresh();
  if (tabs.current === 'trends') trends.render();
});

history.render();

// Offline support: keep a copy of the app on the device (not available when opened as a file).
// When a new version is installed while the app is open, offer a one-tap refresh (a workout in
// progress is saved, so refreshing loses nothing). Coming back to the app checks for a new version.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const banner = document.getElementById('update-banner');
  document.getElementById('update-btn').addEventListener('click', () => location.reload());
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => {
        if (!navigator.serviceWorker.controller) return;   // first install, not an update
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' || next.state === 'activated') banner.hidden = false;
        });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch { /* offline support unavailable */ }
  });
}
