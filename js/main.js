/** App entry point: wires storage, the saved log and the three screens together. */
import { createLocalStorage, requestPersistentStorage } from './data/storage.js';
import { createRepository } from './data/repository.js';
import { createTabs } from './ui/tabs.js';
import { createWorkoutView } from './ui/workout.js';
import { createHistoryView } from './ui/history.js';
import { createTrendsView } from './ui/trends.js';

const SWITCH_TO_HISTORY_MS = 600;

const storage = createLocalStorage();
requestPersistentStorage();
const repo = createRepository(storage);
repo.load();
document.getElementById('readonly-banner').hidden = !repo.readOnly;

const tabs = createTabs(document, { onShow: name => { if (name === 'trends') trends.render(); } });
const history = createHistoryView({ root: document.getElementById('tab-history'), repo, storage });
const trends = createTrendsView({ root: document.getElementById('tab-trends'), repo });
const workout = createWorkoutView({
  root: document.getElementById('tab-workout'),
  repo,
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
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
