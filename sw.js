// Service worker: aplikacija se otvara i bez interneta, a zadnji podaci mogu se čitati offline.
// Promijeni VERSION pri svakoj promjeni ovog popisa datoteka.
const VERSION = 'v1.7';
const SHELL = `delegator-shell-${VERSION}`;
const DATA = 'delegator-data';
const FILES = ['/', '/manifest.webmanifest', '/vendor/cytoscape.min.js', '/icons/icon-192.png', '/icons/icon-512.png',
  '/vendor/fonts/inter-latin-wght-normal.woff2', '/vendor/fonts/inter-latin-ext-wght-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('delegator-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Odgovor iz spremnika uz oznaku da je offline, da aplikacija prikaže „samo čitanje“.
async function offlineCopy(res) {
  const h = new Headers(res.headers); h.set('x-delegator-offline', '1');
  return new Response(await res.blob(), { status: res.status, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Podaci: uvijek prvo s mreže; bez mreže zadnja spremljena kopija.
  if (url.pathname === '/api/data') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put('/api/data', copy)); }
      return res;
    }).catch(async () => {
      const hit = await caches.match('/api/data', { cacheName: DATA });
      return hit ? offlineCopy(hit) : new Response(JSON.stringify({ error: 'Nema veze s internetom' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }));
    return;
  }
  if (url.pathname === '/api/auth') {
    // provjera prijave offline: ako imamo spremljene podatke, korisnik je bio prijavljen
    e.respondWith(fetch(req).catch(async () => {
      const hit = await caches.match('/api/data', { cacheName: DATA });
      const user = hit ? (await hit.clone().json()).user : null;
      return new Response(JSON.stringify({ user, setup: false, offline: true }), { headers: { 'Content-Type': 'application/json', 'x-delegator-offline': '1' } });
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // ostalo samo s mreže

  // Stranica: mreža, a bez nje spremljena ljuska aplikacije.
  if (req.mode === 'navigate') {
    if (url.pathname !== '/') return; // npr. /z/TOKEN (stranica osobe) ide samo s mreže i ne smije zamijeniti aplikaciju
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/', { cacheName: SHELL })));
    return;
  }
  // Statične datoteke: iz spremnika, inače s mreže.
  if (/^\/(vendor|icons)\/|^\/manifest\.webmanifest$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

// Push obavijesti: jutarnji sažetak rokova i javljanja osoba (vidi api/_push.js).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Delegator', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Delegator', {
    body: d.body || '', tag: d.tag, renotify: Boolean(d.tag), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) { open.focus(); return open.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  }));
});
