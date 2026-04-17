// ── Offline Mutation Queue ────────────────────────────────────────
// Justified complexity: Festivals have poor connectivity. Users need picks/notes to sync
// even after app is closed. IndexedDB persistence + Background Sync (via SW) enables this.
// Queues API mutations when offline and replays them on reconnect.
// Uses IndexedDB for persistence (falls back to localStorage).
// Each mutation carries a client-generated ID for deduplication.

const DB_NAME = 'festivalPlannerOffline';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE = 1000;
// SECURITY: Staleness expiry — mutations older than 24 hours are automatically discarded to prevent stale/conflicting updates
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — mutations older than this are discarded

let _db = null;
let _processing = false;
let _onStatusChange = null;

// ── IndexedDB helpers ────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode) {
  return _db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ───────────────────────────────────────────────────

// Initialize the offline queue at app startup: prune stale mutations older than 24 hours
export async function init() {
  try {
    await pruneStaleEntries();
  } catch (err) {
    console.error('Failed to prune stale mutations on init:', err);
  }
}

export function setStatusCallback(fn) { _onStatusChange = fn; }

function notifyStatus(pendingCount) {
  if (typeof _onStatusChange === 'function') _onStatusChange(pendingCount);
}

export function generateClientId() {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

// #35: Request Background Sync registration so SW replays mutations even if app is closed
export async function requestBackgroundSync() {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-mutations');
    }
  } catch (err) {
    // Background Sync not supported or permission denied — fall through to manual replay
  }
}

export async function enqueue(mutation) {
  // mutation: { type: 'api'|'socket', path, method, body, event, data }
  // CRITICAL: Generate clientId at the top BEFORE any storage operations to prevent duplicates on replay
  const clientId = mutation.clientId || generateClientId();
  mutation.clientId = clientId;

  try {
    await openDB();
    const entry = {
      ...mutation,
      clientId,
      status: 'pending',
      retries: 0,
      createdAt: Date.now(),
    };
    await idbRequest(txStore('readwrite').add(entry));
    const count = await getPendingCount();
    notifyStatus(count);
    // #35: Trigger Background Sync so SW can replay if app closes
    requestBackgroundSync();
    return clientId;
  } catch (err) {
    // Fallback to localStorage
    return enqueueFallback(mutation);
  }
}

function enqueueFallback(mutation) {
  try {
    const key = 'festivalPlannerMutationQueue';
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    // clientId is already set on mutation by enqueue() before fallback
    queue.push({ ...mutation, status: 'pending', retries: 0, createdAt: Date.now() });
    localStorage.setItem(key, JSON.stringify(queue));
    return mutation.clientId;
  } catch (err) {
    console.error('Failed to queue mutation (storage full?):', err);
    return mutation.clientId;
  }
}

export async function getPendingCount() {
  try {
    await openDB();
    const index = txStore('readonly').index('status');
    return await idbRequest(index.count(IDBKeyRange.only('pending')));
  } catch {
    const queue = JSON.parse(localStorage.getItem('festivalPlannerMutationQueue') || '[]');
    return queue.filter((m) => m.status === 'pending').length;
  }
}

export async function getAll() {
  try {
    await openDB();
    const all = await idbRequest(txStore('readonly').getAll());
    // Filter out stale mutations (older than 24h)
    return all.filter((m) => Date.now() - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
  } catch {
    const queue = JSON.parse(localStorage.getItem('festivalPlannerMutationQueue') || '[]');
    return queue.filter((m) => Date.now() - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
  }
}

// Clean up stale mutations older than MAX_QUEUE_AGE_MS
export async function pruneStaleEntries() {
  try {
    await openDB();
    const now = Date.now();
    const all = await idbRequest(txStore('readonly').getAll());
    const tx = txStore('readwrite');
    for (const entry of all) {
      if (now - (entry.createdAt || 0) > MAX_QUEUE_AGE_MS) {
        await idbRequest(tx.delete(entry.id));
      }
    }
  } catch {
    const key = 'festivalPlannerMutationQueue';
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    const now = Date.now();
    const fresh = queue.filter((m) => now - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
    localStorage.setItem(key, JSON.stringify(fresh));
  }
}

export async function clear() {
  try {
    await openDB();
    await idbRequest(txStore('readwrite').clear());
    notifyStatus(0);
  } catch {
    localStorage.removeItem('festivalPlannerMutationQueue');
    notifyStatus(0);
  }
}

async function removeMutation(id) {
  try {
    await idbRequest(txStore('readwrite').delete(id));
  } catch { /* ignore */ }
}

async function updateMutation(id, updates) {
  try {
    const store = txStore('readwrite');
    const existing = await idbRequest(store.get(id));
    if (existing) {
      Object.assign(existing, updates);
      await idbRequest(store.put(existing));
    }
  } catch { /* ignore */ }
}

// ── Replay engine ────────────────────────────────────────────────
// apiFn: async (path, options) => result — the api() function
// socketEmitFn: (event, data, ack) => void — socket emit with ack
export async function processQueue(apiFn, socketEmitFn, opts = {}) {
  if (_processing) return;
  _processing = true;
  try {
    // Session pre-check: verify auth is still valid before replaying mutations
    if (typeof opts.checkSession === 'function') {
      try {
        const valid = await opts.checkSession();
        if (!valid) {
          // Session expired while offline — clear queue to avoid 401 loops
          await clear();
          return;
        }
      } catch { /* session check failed — proceed optimistically */ }
    }

    const mutations = await getAll();
    const pending = mutations.filter((m) => m.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);

    for (const mutation of pending) {
      try {
        if (mutation.type === 'api') {
          if (!apiFn || typeof apiFn !== 'function') {
            throw new Error('apiFn not provided or invalid');
          }
          await apiFn(mutation.path, {
            method: mutation.method || 'POST',
            body: mutation.body,
            headers: mutation.headers || {},
          });
        } else if (mutation.type === 'socket') {
          if (!socketEmitFn || typeof socketEmitFn !== 'function') {
            throw new Error('socketEmitFn not provided or invalid');
          }
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Socket ack timeout')), 10000);
            try {
              socketEmitFn(mutation.event, { ...mutation.data, clientId: mutation.clientId }, (response) => {
                clearTimeout(timeout);
                if (response?.ok) resolve(response);
                else reject(new Error(response?.error || 'Socket ack failed'));
              });
            } catch (err) {
              clearTimeout(timeout);
              reject(err);
            }
          });
        }
        await removeMutation(mutation.id);
      } catch (err) {
        const retries = (mutation.retries || 0) + 1;
        // 412 = ETag conflict: fetch fresh profile, merge picks, retry once
        if (err.status === 412 && mutation.type === 'api' && typeof opts.getProfile === 'function' && retries <= 2) {
          try {
            const fresh = await opts.getProfile(mutation.festivalId || mutation.body?.festivalId);
            if (fresh && mutation.body?.picks) {
              const merged = mergePicks(mutation.body.picks, fresh.picks, mutation.body.updatedAt, fresh.updatedAt);
              await updateMutation(mutation.id, { retries, body: { ...mutation.body, picks: merged, etag: fresh.etag } });
              continue; // retry immediately with merged picks
            }
          } catch (mergeErr) {
            console.warn('offline-queue: 412 merge failed', mergeErr.message);
          }
          // merge failed — remove to avoid loop
          await removeMutation(mutation.id);
        } else if (retries >= MAX_RETRIES || (err.status && err.status >= 400 && err.status < 500 && err.status !== 412)) {
          // Permanent failure — remove from queue
          await removeMutation(mutation.id);
        } else {
          await updateMutation(mutation.id, { retries, status: 'pending' });
          // Exponential backoff before next attempt
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_BASE * Math.pow(2, retries - 1)));
        }
      }
    }
  } catch (err) {
    console.error('Queue processing error:', err);
  } finally {
    _processing = false;
    try {
      const count = await getPendingCount();
      notifyStatus(count);
    } catch (err) {
      console.error('Failed to get pending count:', err);
      notifyStatus(0);
    }
  }
}

// ── Conflict resolution helper ───────────────────────────────────
// Last-write-wins with timestamp comparison
export function resolveConflict(local, remote) {
  const localTime = new Date(local.updatedAt || 0).getTime();
  const remoteTime = new Date(remote.updatedAt || 0).getTime();
  // Remote wins on ties (server is authoritative)
  return remoteTime >= localTime ? remote : local;
}

// Merge picks: combine local and remote, preferring whichever has the later timestamp
export function mergePicks(localPicks, remotePicks, localUpdatedAt, remoteUpdatedAt) {
  const localTime = new Date(localUpdatedAt || 0).getTime();
  const remoteTime = new Date(remoteUpdatedAt || 0).getTime();
  // Server-authoritative: remote wins on ties
  if (remoteTime >= localTime) return { ...localPicks, ...remotePicks };
  return { ...remotePicks, ...localPicks };
}

// ── Offline Conflict Resolution UI ─────────────────────────────────
export function showQueueIndicator(count) {
  let el = document.getElementById('offline-queue-indicator');
  if (count <= 0) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline-queue-indicator';
    el.style.cssText = 'position:fixed;bottom:80px;right:16px;background:rgba(255,165,0,0.9);color:#000;padding:8px 14px;border-radius:20px;font-size:13px;z-index:9999;font-family:var(--font-body);backdrop-filter:blur(8px);pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = `${count} pending change${count > 1 ? 's' : ''}`;
}

export function showReplayToast(count) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(46,204,113,0.95);color:#fff;padding:10px 20px;border-radius:12px;font-size:14px;z-index:9999;font-family:var(--font-body);transition:opacity 0.5s;';
  toast.textContent = `✓ ${count} offline change${count > 1 ? 's' : ''} synced`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 600); }, 3000);
}
