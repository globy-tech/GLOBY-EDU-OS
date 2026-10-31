const CACHE_NAME = 'globyedu-pwa-v17';
const DB_NAME = 'globyedu_pwa_db';
const DB_VERSION = 1;
const STORE_NAME = 'offlineQueue';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/config/firebase.js?v=20261022-attendance-history',
  '/src/main.js?v=20261022-neutral-upload-copy',
  '/src/styles.generated.css?v=20260926-teacher-student-fix',
  '/src/assets/images/ui/globyedu-favicon-32.png',
  '/src/assets/images/ui/globyedu-touch-180.png',
  '/src/assets/images/ui/globyedu-icon-192.png',
  '/src/assets/images/ui/globyedu-icon-512.png'
];

function openOfflineQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getOfflineQueueEntries() {
  return openOfflineQueueDb().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    })
  );
}

function removeOfflineQueueEntry(id) {
  return openOfflineQueueDb().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })
  );
}

function broadcastToClients(message) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}

async function replayQueuedRequests() {
  const entries = await getOfflineQueueEntries();
  if (!Array.isArray(entries) || entries.length === 0) {
    return broadcastToClients({ type: 'offline-sync-empty' });
  }

  let processed = 0;
  for (const entry of entries) {
    try {
      const body = entry.body && typeof entry.body === 'object' ? JSON.stringify(entry.body) : entry.body;
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response && response.ok) {
        await removeOfflineQueueEntry(entry.id);
        processed += 1;
      }
    } catch (error) {
      // Keep the queued request for a future retry.
    }
  }

  return broadcastToClients({ type: 'offline-sync-complete', processed });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'globyedu-offline-sync') {
    event.waitUntil(replayQueuedRequests());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    return cached || caches.match('index.html');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return caches.match('index.html');
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (!isSameOrigin) return;

  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      networkFirst(event.request).catch(() => caches.match('/offline.html') || caches.match('/index.html'))
    );
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (/\.(?:css|js)$/.test(requestUrl.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
