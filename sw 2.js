/* Büro · Service Worker
   Legt die App beim ersten Aufruf ab und liefert sie danach auch ohne Netz aus.
   Neue Version: CACHE hochzählen, dann lädt der Browser beim nächsten Start neu. */
const CACHE = 'buero-v1';
const ASSETS = ['./', './buero.html', './index.html'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // einzeln, damit eine fehlende Datei nicht die ganze Installation kippt
      Promise.all(ASSETS.map(u => c.add(u).catch(() => {})))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Karten- und Routendienst nie zwischenspeichern — veraltete Strecken wären schlimmer als keine
  if (/nominatim|project-osrm/.test(url.hostname)) return;

  // Erst Netz, sonst Cache: so bekommst du beim nächsten Online-Start immer die neue Fassung
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./buero.html')))
  );
});
