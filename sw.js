/* Garten Flo · Büro — Offline-Speicher
   Netz zuerst (Updates kommen sofort an), ohne Netz die zuletzt geladene Version. */
const CACHE = 'buero-v20';
const CORE = ['buero.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // GitHub-API, Anthropic, Karten: nie cachen
  /* Seiten und Skripte immer beim Server nachfragen (ETag), sonst liefert der
     Browser bis zu 10 Minuten die alte Fassung aus seinem HTTP-Cache (seit 5.6.1) */
  const frisch = req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  e.respondWith(
    fetch(req, frisch ? { cache: 'no-cache' } : undefined).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('buero.html') : undefined))
        .then(hit => hit || new Response('Offline', { status: 503 }))
    )
  );
});
