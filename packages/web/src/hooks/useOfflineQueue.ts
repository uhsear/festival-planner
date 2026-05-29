import { useEffect, useCallback, useState } from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';

const DB_NAME = 'festie-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE = 1000;
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface QueuedMutation {
  id?: number;
  clientId: string;
  type: 'api' | 'socket';
  url?: string;
  method?: string;
  body?: Record<string, unknown>;
  event?: string;
  data?: Record<string, unknown>;
  status: 'pending' | 'failed' | 'completed';
  retries: number;
  createdAt: number;
}

export interface UseOfflineQueueReturn {
  queueMutation: (mutation: Omit<QueuedMutation, 'status' | 'retries' | 'createdAt'>) => Promise<string>;
  pendingCount: number;
  processQueue: (
    apiFn: (url: string, opts: { method: string; body?: Record<string, unknown> }) => Promise<unknown>,
    socketEmitFn?: (event: string, data: Record<string, unknown>, ack: (response: { ok: boolean; error?: string }) => void) => void,
  ) => Promise<void>;
  clearQueue: () => Promise<void>;
}

let _db: IDBDatabase | null = null;
let _processing = false;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Open a transaction and return both the tx and the store so callers can
 * explicitly abort the tx if a request rejects. IDB transactions auto-close
 * when the microtask queue drains, but an unhandled rejection between two
 * awaits can leak the tx until GC. Explicitly aborting makes the contract
 * clear and frees the tx immediately.
 */
function openTx(mode: IDBTransactionMode): { tx: IDBTransaction; store: IDBObjectStore } {
  if (!_db) throw new Error('Database not initialized');
  const tx = _db.transaction(STORE_NAME, mode);
  return { tx, store: tx.objectStore(STORE_NAME) };
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function generateClientId(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getPendingCount(): Promise<number> {
  try {
    await openDB();
    const { tx, store } = openTx('readonly');
    try {
      const index = store.index('status');
      return await idbRequest(index.count(IDBKeyRange.only('pending')));
    } catch (err) {
      try { tx.abort(); } catch { /* tx may already be finished */ }
      throw err;
    }
  } catch {
    // Fallback to localStorage
    const queue = JSON.parse(localStorage.getItem('festie-offline-queue') || '[]');
    return queue.filter((m: QueuedMutation) => m.status === 'pending').length;
  }
}

async function getAll(): Promise<QueuedMutation[]> {
  try {
    await openDB();
    const { tx, store } = openTx('readonly');
    try {
      const all = await idbRequest<QueuedMutation[]>(store.getAll());
      // Filter out stale mutations (older than 24h)
      return all.filter((m) => Date.now() - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
    } catch (err) {
      try { tx.abort(); } catch { /* tx may already be finished */ }
      throw err;
    }
  } catch {
    const queue = JSON.parse(localStorage.getItem('festie-offline-queue') || '[]');
    return queue.filter((m: QueuedMutation) => Date.now() - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
  }
}

async function removeMutation(id: number): Promise<void> {
  try {
    const { tx, store } = openTx('readwrite');
    try {
      await idbRequest(store.delete(id));
    } catch (err) {
      try { tx.abort(); } catch { /* tx may already be finished */ }
      throw err;
    }
  } catch {
    // Ignore
  }
}

async function updateMutation(id: number, updates: Partial<QueuedMutation>): Promise<void> {
  try {
    const { tx, store } = openTx('readwrite');
    try {
      const existing = await idbRequest(store.get(id));
      if (existing) {
        Object.assign(existing, updates);
        await idbRequest(store.put(existing));
      }
    } catch (err) {
      try { tx.abort(); } catch { /* tx may already be finished */ }
      throw err;
    }
  } catch {
    // Ignore
  }
}

async function pruneStaleEntries(): Promise<void> {
  try {
    await openDB();
    const now = Date.now();

    // Read phase: snapshot existing entries in a readonly tx.
    const readHandle = openTx('readonly');
    let all: QueuedMutation[];
    try {
      all = await idbRequest<QueuedMutation[]>(readHandle.store.getAll());
    } catch (err) {
      try { readHandle.tx.abort(); } catch { /* tx may already be finished */ }
      throw err;
    }

    // Write phase: delete stale entries in a single readwrite tx so if any
    // delete rejects we can abort and unwind the whole batch.
    const writeHandle = openTx('readwrite');
    try {
      for (const entry of all) {
        if (now - (entry.createdAt || 0) > MAX_QUEUE_AGE_MS) {
          await idbRequest(writeHandle.store.delete(entry.id!));
        }
      }
    } catch (err) {
      try { writeHandle.tx.abort(); } catch { /* tx may already be finished */ }
      throw err;
    }
  } catch {
    const queue = JSON.parse(localStorage.getItem('festie-offline-queue') || '[]');
    const now = Date.now();
    const fresh = queue.filter((m: QueuedMutation) => now - (m.createdAt || 0) < MAX_QUEUE_AGE_MS);
    localStorage.setItem('festie-offline-queue', JSON.stringify(fresh));
  }
}

/**
 * Hook for managing offline mutation queue with IndexedDB persistence
 */
export function useOfflineQueue(): UseOfflineQueueReturn {
  const [pendingCount, setPendingCount] = useState(0);
  const setPendingSync = useUIStore((state) => state.setPendingSync);

  // Initialize on mount
  useEffect(() => {
    pruneStaleEntries().catch(console.error);
    getPendingCount().then(setPendingCount).catch(console.error);
  }, []);

  // Update pending count whenever it changes
  const updatePendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
    setPendingSync(count);
  }, [setPendingSync]);

  const queueMutation = useCallback(
    async (mutation: Omit<QueuedMutation, 'status' | 'retries' | 'createdAt'>): Promise<string> => {
      const clientId = mutation.clientId || generateClientId();

      try {
        await openDB();
        const entry: QueuedMutation = {
          ...mutation,
          clientId,
          status: 'pending',
          retries: 0,
          createdAt: Date.now(),
        };

        // Upsert semantics: if a pending entry with the same clientId already
        // exists, replace it. This is what lets the caller use deterministic
        // client IDs like `pick-${profileId}-${setId}` to collapse N offline
        // toggles of the same set into exactly one replayed mutation.
        const existing = await getAll();
        const match = existing.find((m) => m.clientId === clientId && m.status === 'pending' && m.id != null);
        if (match?.id != null) await removeMutation(match.id);

        const { tx, store } = openTx('readwrite');
        try {
          await idbRequest(store.add(entry));
        } catch (err) {
          try { tx.abort(); } catch { /* tx may already be finished */ }
          throw err;
        }
        await updatePendingCount();
        return clientId;
      } catch (err) {
        // Fallback to localStorage
        try {
          const queue = JSON.parse(localStorage.getItem('festie-offline-queue') || '[]');
          queue.push({
            ...mutation,
            clientId,
            status: 'pending',
            retries: 0,
            createdAt: Date.now(),
          });
          localStorage.setItem('festie-offline-queue', JSON.stringify(queue));
          await updatePendingCount();
          return clientId;
        } catch {
          console.error('Failed to queue mutation:', err);
          return clientId;
        }
      }
    },
    [updatePendingCount],
  );

  const processQueue = useCallback(
    async (
      apiFn: (url: string, opts: { method: string; body?: Record<string, unknown> }) => Promise<unknown>,
      socketEmitFn?: (event: string, data: Record<string, unknown>, ack: (response: { ok: boolean; error?: string }) => void) => void,
    ): Promise<void> => {
      if (_processing) return;
      _processing = true;

      try {
        const mutations = await getAll();
        const pending = mutations
          .filter((m) => m.status === 'pending')
          .sort((a, b) => a.createdAt - b.createdAt);

        for (const mutation of pending) {
          try {
            if (mutation.type === 'api' && mutation.url) {
              if (!apiFn || typeof apiFn !== 'function') {
                throw new Error('apiFn not provided');
              }
              await apiFn(mutation.url, {
                method: mutation.method || 'POST',
                body: mutation.body,
              });
              // Remove on success
              if (mutation.id) {
                await removeMutation(mutation.id);
              }
            } else if (mutation.type === 'socket' && mutation.event) {
              if (!socketEmitFn || typeof socketEmitFn !== 'function') {
                throw new Error('socketEmitFn not provided');
              }

              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Socket ack timeout')), 10000);
                try {
                  socketEmitFn(mutation.event!, { ...mutation.data, clientId: mutation.clientId }, (response: { ok: boolean; error?: string }) => {
                    clearTimeout(timeout);
                    if (response?.ok) resolve();
                    else reject(new Error(response?.error || 'Socket ack failed'));
                  });
                } catch (err) {
                  clearTimeout(timeout);
                  reject(err);
                }
              });

              // Remove on success
              if (mutation.id) {
                await removeMutation(mutation.id);
              }
            }
          } catch (err: unknown) {
            const retries = (mutation.retries || 0) + 1;
            const status = err instanceof Error && 'status' in err ? (err as Error & { status: number }).status : undefined;
            const isClientError = status !== undefined && status >= 400 && status < 500;
            const isConflict = status === 409;

            if (isConflict) {
              // Conflict: mark for manual review (remove from queue)
              if (mutation.id) {
                await removeMutation(mutation.id);
              }
            } else if (retries >= MAX_RETRIES || isClientError) {
              // Permanent failure: remove from queue
              if (mutation.id) {
                await removeMutation(mutation.id);
              }
            } else {
              // Temporary failure: retry with backoff
              if (mutation.id) {
                await updateMutation(mutation.id, { retries, status: 'pending' });
              }
              // Wait before next attempt
              await new Promise((r) => setTimeout(r, RETRY_BACKOFF_BASE * Math.pow(2, retries - 1)));
            }
          }
        }
      } catch (err) {
        console.error('Queue processing error:', err);
      } finally {
        _processing = false; // eslint-disable-line require-atomic-updates -- module-level flag, not a real race
        await updatePendingCount();
      }
    },
    [updatePendingCount],
  );

  const clearQueue = useCallback(async (): Promise<void> => {
    try {
      await openDB();
      const { tx, store } = openTx('readwrite');
      try {
        await idbRequest(store.clear());
      } catch (err) {
        try { tx.abort(); } catch { /* tx may already be finished */ }
        throw err;
      }
    } catch {
      localStorage.removeItem('festie-offline-queue');
    }
    setPendingCount(0);
    setPendingSync(0);
  }, [setPendingSync]);

  return {
    queueMutation,
    pendingCount,
    processQueue,
    clearQueue,
  };
}
