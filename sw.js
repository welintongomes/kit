/* ═══════════════════════════════════════════════
   HUB — SERVICE WORKER
   Estratégia: Cache-first para assets estáticos,
   Network-first para tudo mais.
   Atualize CACHE_NAME ao fazer deploy de mudanças.
═══════════════════════════════════════════════ */

const CACHE_NAME = 'hub-v3';

/* Arquivos essenciais para funcionar offline */
const PRECACHE = [
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=Instrument+Sans:ital,wght@0,400;0,500;1,400&display=swap',
];

/* ── INSTALL: pré-cacheia os assets essenciais ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(() => {
            /* ignora falhas individuais (ex: offline na instalação) */
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: remove caches antigos ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: Cache-first para o app, pass-through para o resto ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Ignora requests que não são GET */
  if (request.method !== 'GET') return;

  /* Ignora extensões do browser (chrome-extension://, etc) */
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        /* Só cacheia responses válidas do mesmo origem ou fonts do Google */
        const sameOrigin = url.origin === self.location.origin;
        const isFont     = url.hostname === 'fonts.googleapis.com' ||
                           url.hostname === 'fonts.gstatic.com';

        if (response.ok && (sameOrigin || isFont)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }

        return response;
      }).catch(() => {
        /* Offline e não está em cache — retorna o index.html para SPAs */
        if (request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
