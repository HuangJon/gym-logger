/**
 * Offline support. Keeps a copy of the app's files on the device; your workout data is NOT here
 * (it's in the app's storage). Strategy: network first so updates arrive, saved copy when offline
 * or when the site errors (e.g. 404 while the repo is private).
 *
 * When you add a file under css/ or js/, add it to APP_FILES (a unit test checks this).
 */
const CACHE = 'liftlog-v2';
const APP_FILES = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './css/tokens.css', './css/base.css', './css/workout.css', './css/history.css', './css/trends.css',
  './js/main.js',
  './js/config/program.js',
  './js/core/dates.js', './js/core/numbers.js', './js/core/exercises.js', './js/core/records.js',
  './js/core/log.js', './js/core/migrate.js', './js/core/progress.js', './js/core/trends.js',
  './js/data/storage.js', './js/data/repository.js', './js/data/backup.js',
  './js/ui/dom.js', './js/ui/charts.js', './js/ui/tabs.js', './js/ui/workout.js', './js/ui/history.js', './js/ui/trends.js',
  './js/dev/demo.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const saved = () => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'));
  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response.ok) return saved().then(hit => hit || response);
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(saved),
  );
});
