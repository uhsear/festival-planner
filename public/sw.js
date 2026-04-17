const SHELL_CACHE = 'shell-1776342458439';
const DATA_CACHE = 'data-1776342458439';
// Single grep-able version string derived from SHELL_CACHE. Kept in sync
// manually with the cache names (the auto-deploy script rotates all three).
const SW_VERSION = '1776342458439';
const SHELL_URLS = [
  '/',
  '/offline.html',
  '/app.js',
  '/app.css',
  '/app/api.js',
  '/app/dom.js',
  '/app/state.js',
  '/app/helpers.js',
  '/app/push.js',
  '/app/offline-queue.js',
  '/app/ratings.js',
  '/app/weather.js',
  '/app/expenses.js',
  '/app/activity.js',
  '/app/festival-mode.js',
  '/app/conflicts.js',
  '/app/auth.js',
  '/app/crews.js',
  '/app/socket.js',
  '/app/router.js',
  '/app/focus.js',
  '/app/events.js',
  '/app/lifecycle.js',
  '/app/polls-ui.js',
  '/app/schedule-share.js',
  '/app/spotify.js',
  '/app/identity.js',
  '/app/metrics.js',
  '/app/ios-install-prompt.js',
  '/app/offline.js',
  '/app/components/toasts.js',
  '/views/timeline.js',
  '/views/auth.js',
  '/views/header.js',
  '/views/cards.js',
  '/views/picks.js',
  '/views/crew.js',
  '/views/crew/home-base.js',
  '/views/crew/overlap.js',
  '/views/crew/list.js',
  '/views/grid.js',
  '/views/detail-panel.js',
  '/views/admin/index.js',
  '/views/admin/dashboard.js',
  '/views/admin/users.js',
  '/views/admin/festivals.js',
  '/views/admin/crews.js',
  '/views/admin/audit.js',
  '/views/admin/analytics.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Public, cacheable GET endpoints. The client uses /api/v1/* (see
// public/app/api.js const API_BASE = '/api/v1'); earlier rounds wrongly
// had a timestamped prefix here (/api/v1775229194970/...) that never
// matched any real request, so DATA_CACHE stayed effectively empty and
// offline guests saw a shell with no data. Matching these prefixes
// enables the festivals list + per-festival detail to be served offline.
const CACHEABLE_DATA_PATHS = [
  '/api/v1/festivals',
];

// Auth-scoped paths that MUST NOT be cached: per-user responses would
// otherwise leak across sessions in a shared browser. Crews/profiles
// carry membership-specific data; auth/account/admin carry credentials.
const PRIVATE_API_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/account',
  '/api/v1/admin',
  '/api/v1/profiles',
  '/api/v1/crews',
  '/api/v1/messages',
  '/api/v1/export',
  '/api/v1/presence',
  '/api/v1/notifications',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(async (cache) => {
        // Use allSettled so a single 404 (e.g. a renamed module) doesn't
        // abort the whole install and leave the user without a SW. We log
        // the failures so CI/ops can spot drift in SHELL_URLS.
        const results = await Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)));
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.warn('[sw] precache failed for', SHELL_URLS[i], r.reason);
          }
        });
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter((key) => ![SHELL_CACHE, DATA_CACHE].includes(key));
    await Promise.all(oldKeys.map((key) => caches.delete(key)));
    await self.clients.claim();
    // Notify all clients that a new version is active
    if (oldKeys.length > 0) {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'sw:updated', version: SW_VERSION });
      }
    }
  })());
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Skip `no-store` (which truly means "never store"). `no-cache` only
      // means "revalidate before serving" — and networkFirst does that by
      // going to network first on every request, falling back to cache only
      // on failure. So caching `no-cache` responses is correct for offline
      // support without violating freshness. The earlier skip on both was
      // why DATA_CACHE stayed empty even after the API-prefix fix: the
      // festivals endpoint sends `Cache-Control: no-cache`.
      const cacheControl = response.headers.get('Cache-Control') || '';
      if (!cacheControl.includes('no-store')) {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      // Dedicated offline page — precached at install. Better UX than the
      // bare shell because first-time-offline visitors have no JS state
      // to hydrate yet, so the shell would render an empty app skeleton.
      const offline = await cache.match('/offline.html');
      if (offline) return offline;
      return cache.match('/');
    }
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        // SWR inherently revalidates, so `no-cache` is fine to store — we
        // always kick a network fetch. Only `no-store` means "never store".
        const cacheControl = response.headers.get('Cache-Control') || '';
        if (!cacheControl.includes('no-store')) {
          cache.put(request, response.clone());
        }
      }
      return response;
    })
    .catch(() => null);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (PRIVATE_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  // Static HTML pages — serve directly from network, skip SPA shell caching
  const STATIC_PAGES = ['/privacy', '/privacy.html', '/terms', '/terms.html', '/security-whitepaper', '/security-whitepaper.html'];
  if (STATIC_PAGES.includes(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Match exact paths or paths with a single ID segment to prevent over-caching
  if (CACHEABLE_DATA_PATHS.some((prefix) => url.pathname === prefix || (url.pathname.startsWith(`${prefix}/`) && !url.pathname.slice(prefix.length + 1).includes('/')))) {
    // Stale-while-revalidate: cached copy renders instantly (fixes the
    // "blank list for 500ms on every nav" wart) while we background-fetch
    // fresh data. The cache write in the .then() updates DATA_CACHE for
    // the next visit. Previously networkFirst — fine offline, but gated
    // the first paint on a round-trip even on a warm cache.
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // Only cache manifest, icon assets, and avatar images (exact path patterns)
  if (
    url.pathname === '/manifest.webmanifest'
    || (url.pathname.startsWith('/icons/') && /^\/icons\/icon-\d+\.png$/.test(url.pathname))
    || (url.pathname.startsWith('/uploads/avatars/') && /^\/uploads\/avatars\/[a-f0-9]+\.webp$/.test(url.pathname))
  ) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
  }
});

// ── Firebase Cloud Messaging (background push notifications) ──────────
// Merged here so a single SW controls scope "/" for both caching and push.
// Firebase compat SDK is loaded dynamically only when a push event arrives,
// avoiding extra network requests on every SW install.

let _firebaseInitialized = false;

function ensureFirebase() {
  if (_firebaseInitialized) return;
  try {
    importScripts(
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js',
    );
    firebase.initializeApp({
      apiKey: 'AIzaSyC1erbrclaoaYEnkcN3IPIwUNGBLyMa7y4',
      authDomain: 'festival-planner-a191b.firebaseapp.com',
      projectId: 'festival-planner-a191b',
      storageBucket: 'festival-planner-a191b.firebasestorage.app',
      messagingSenderId: '742304531990',
      appId: '1:742304531990:web:628d6d3b16ea4e834f1737',
    });
    _firebaseInitialized = true;
  } catch (e) {
    // importScripts may fail offline — push simply won't show
  }
}

self.addEventListener('push', (event) => {
  ensureFirebase();

  // #30: Handle silent/data-only push for background sync
  if (event.data) {
    try {
      const payload = event.data.json();
      const data = payload.data || {};
      if (data.type === 'set_reminder') {
        // Phase 1A: Set reminder notification — high priority, distinct tag
        event.waitUntil(
          self.registration.showNotification(payload.notification?.title || data.title || 'Set Reminder', {
            body: payload.notification?.body || data.body || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'reminder-' + (data.setId || 'unknown'),
            requireInteraction: true,
            data: { type: 'set_reminder', festivalId: data.festivalId, setId: data.setId },
          })
        );
        return;
      }
      if (data.type === 'silent_sync') {
        // Notify open clients to refresh data — no visible notification
        event.waitUntil(
          self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            for (const client of clients) {
              client.postMessage({ type: 'silent:sync', syncType: data.syncType, festivalId: data.festivalId });
            }
          }),
        );
        return;
      }
    } catch (e) { /* continue to normal push handling */ }
  }

  // Let Firebase SDK handle the push event internally.
  // If Firebase isn't loaded (offline), show a generic notification.
  if (!_firebaseInitialized && event.data) {
    try {
      const payload = event.data.json();
      const title = payload.notification?.title || 'Festie';
      const body = payload.notification?.body || '';
      event.waitUntil(
        self.registration.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'festie',
          data: payload.data || {},
        }),
      );
    } catch (e) { /* malformed push payload */ }
  }
});

// Firebase onBackgroundMessage — only triggers when SDK loaded successfully
// (bound inside the push handler on first real push; no top-level init).

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ndata = event.notification.data || {};
  const festivalId = ndata.festivalId;
  const setId = ndata.setId;
  const url = setId ? '/?festival=' + festivalId + '&set=' + setId : (festivalId ? '/?festival=' + festivalId : '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          // Navigate existing client to the relevant festival
          client.postMessage({ type: 'notification:click', festivalId });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// ── #35: Background Sync API — replay offline mutations when network returns ──
// The offline-queue.js stores mutations in IndexedDB. When network returns,
// the browser fires 'sync' event even if the app is closed, allowing us to
// replay queued mutations automatically.

const SYNC_TAG = 'sync-mutations';
// Must match offline-queue.js constants exactly
const MUTATION_DB_NAME = 'festivalPlannerOffline';
const MUTATION_DB_VERSION = 1;
const MUTATION_STORE_NAME = 'mutations';

async function replayOfflineMutations() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(MUTATION_DB_NAME, MUTATION_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const theDb = e.target.result;
        if (!theDb.objectStoreNames.contains(MUTATION_STORE_NAME)) {
          const store = theDb.createObjectStore(MUTATION_STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const tx = db.transaction(MUTATION_STORE_NAME, 'readonly');
    const store = tx.objectStore(MUTATION_STORE_NAME);
    const mutations = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (mutations.length === 0) { db.close(); return; }

    const pending = mutations.filter((m) => m.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    for (const mutation of pending) {
      try {
        // Build fetch options based on mutation type — validate same-origin
        const fetchUrl = mutation.path ? `/api/v1${mutation.path}` : mutation.url;
        if (!fetchUrl) continue;
        // Prevent cross-origin mutation replay
        try {
          const resolved = new URL(fetchUrl, self.location.origin);
          if (resolved.origin !== self.location.origin) continue;
        } catch { continue; }
        const response = await fetch(fetchUrl, {
          method: mutation.method || 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Festie-Request': '1' },
          body: mutation.body ? JSON.stringify(mutation.body) : undefined,
          credentials: 'include',
        });
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          // Success or permanent failure — remove from queue by id
          await new Promise((resolve, reject) => {
            const delTx = db.transaction(MUTATION_STORE_NAME, 'readwrite');
            const delReq = delTx.objectStore(MUTATION_STORE_NAME).delete(mutation.id);
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => reject(delReq.error);
          });
        }
        // 5xx errors: leave in queue for next sync attempt
      } catch (e) {
        // Network still down — leave in queue
        break;
      }
    }
    db.close();
  } catch (e) {
    // IndexedDB not available or empty — nothing to replay
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    // Client requested immediate activation of a waiting SW — no
    // "close all tabs" dance. Pairs with the sw:updated toast: tapping
    // the toast reloads the page, which sends SKIP_WAITING first.
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'CACHE_FESTIVAL') {
    const { endpoints } = event.data;
    if (!endpoints || !Array.isArray(endpoints)) return;
    event.waitUntil(
      caches.open(DATA_CACHE).then((cache) =>
        Promise.allSettled(endpoints.map((url) =>
          fetch(url, { credentials: 'same-origin' })
            .then((resp) => {
              if (resp.ok) return cache.put(url, resp);
            })
            .catch(() => {})
        ))
      )
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayOfflineMutations());
  }
});
