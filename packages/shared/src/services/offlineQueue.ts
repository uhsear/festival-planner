import { api, ApiClientError } from './api';
import { getStorage } from '../platform/storage';
import { useUIStore, type FailedSyncItem } from '../stores/uiStore';

/**
 * Persistent offline mutation queue for React Native (the web uses its own
 * IndexedDB-backed `window.__festieQueue`). Any eligible crew/pick mutation made
 * while offline is persisted to storage and replayed oldest-first on reconnect,
 * so an optimistic UI change is never silently lost — matching what the
 * OfflineBanner promises. Mutations are keyed by a deterministic clientId so
 * repeated writes to the same resource collapse to a single replayed request.
 *
 * "No silent drops" contract: on drain, every queued write either (a) succeeds
 * and is removed, (b) stays queued because we're still offline / hit a transient
 * 5xx, or (c) is removed AND surfaced via uiStore.failedSync on a permanent 4xx
 * (incl. 409) so the user can retry or dismiss it.
 */

const QUEUE_KEY = 'festie-offline-queue';
const FAILED_KEY = 'festie-offline-failed';

/** Drop queued mutations older than this on read (mirrors the web queue policy). */
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Cap on transient (5xx/network) replay attempts before surfacing (matches web). */
const MAX_RETRIES = 5;

export type QueuedMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface QueuedMutation {
  clientId: string;
  url: string;
  method: QueuedMethod;
  body?: unknown;
  /** Human-readable label surfaced in failedSync if this write can't be replayed. */
  label?: string;
  createdAt: number;
  /** Transient-failure replay count; at MAX_RETRIES the write is surfaced + dropped. */
  retries?: number;
}

async function readQueueRaw(): Promise<QueuedMutation[]> {
  try {
    const raw = await Promise.resolve(getStorage().getItem(QUEUE_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Read the queue, pruning entries older than MAX_QUEUE_AGE_MS. If anything was
 * pruned the trimmed queue is written back so the prune is idempotent and the
 * pending count reflects reality.
 *
 * No silent drops: an aged-out write isn't just discarded — it's surfaced via
 * uiStore.failedSync (keyed by clientId, so re-reads are idempotent) so the user
 * can still see and retry/dismiss it instead of it vanishing.
 */
async function readQueue(): Promise<QueuedMutation[]> {
  const all = await readQueueRaw();
  const now = Date.now();
  const fresh: QueuedMutation[] = [];
  const stale: QueuedMutation[] = [];
  for (const m of all) {
    if (now - (m.createdAt || 0) < MAX_QUEUE_AGE_MS) fresh.push(m);
    else stale.push(m);
  }
  if (stale.length > 0) {
    for (const m of stale) {
      recordFailed(m, 'Expired before it could sync (offline more than 24h)');
    }
    await writeQueue(fresh);
  }
  return fresh;
}

async function writeQueue(queue: QueuedMutation[]): Promise<void> {
  await Promise.resolve(getStorage().setItem(QUEUE_KEY, JSON.stringify(queue)));
  updatePendingCount(queue.length);
}

/** Mirror the queue depth into uiStore so the OfflineBanner can show a count. */
function updatePendingCount(count: number): void {
  try {
    useUIStore.getState().setPendingSync(count);
  } catch {
    /* store not ready */
  }
}

/** Read the persisted queue, publish its count, and hydrate failed items (call on app start). */
export async function refreshPendingCount(): Promise<void> {
  updatePendingCount((await readQueue()).length);
  await hydrateFailedSync();
}

/** NetInfo-driven (uiStore.offlineMode); false if the store isn't ready. */
export function isOffline(): boolean {
  try {
    return useUIStore.getState().offlineMode === true;
  } catch {
    return false;
  }
}

/** Add a failed item to uiStore.failedSync AND persist it durably. */
function recordFailed(m: QueuedMutation, error: string): void {
  const item: FailedSyncItem = {
    clientId: m.clientId,
    label: m.label ?? `${m.method} ${m.url}`,
    method: m.method,
    url: m.url,
    body: m.body,
    error,
    at: Date.now(),
  };
  try {
    useUIStore.getState().addFailedSync(item);
  } catch {
    /* store not ready */
  }
  void persistFailedSync(item);
}

async function persistFailedSync(item: FailedSyncItem): Promise<void> {
  try {
    const storage = getStorage();
    const raw = await Promise.resolve(storage.getItem(FAILED_KEY));
    const list: FailedSyncItem[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((f) => f.clientId === item.clientId);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    await Promise.resolve(storage.setItem(FAILED_KEY, JSON.stringify(list)));
  } catch {
    /* best-effort */
  }
}

export async function hydrateFailedSync(): Promise<void> {
  try {
    const raw = await Promise.resolve(getStorage().getItem(FAILED_KEY));
    if (!raw) return;
    const list: FailedSyncItem[] = JSON.parse(raw);
    for (const item of list) {
      useUIStore.getState().addFailedSync(item);
    }
  } catch {
    /* store not ready */
  }
}

export async function removePersistedFailed(clientId: string): Promise<void> {
  try {
    const storage = getStorage();
    const raw = await Promise.resolve(storage.getItem(FAILED_KEY));
    if (!raw) return;
    const list: FailedSyncItem[] = JSON.parse(raw);
    const filtered = list.filter((f) => f.clientId !== clientId);
    await Promise.resolve(storage.setItem(FAILED_KEY, JSON.stringify(filtered)));
  } catch {
    /* best-effort */
  }
}

export async function clearPersistedFailed(): Promise<void> {
  try {
    await Promise.resolve(getStorage().removeItem(FAILED_KEY));
  } catch {
    /* best-effort */
  }
}

/**
 * Drop every pending mutation. Called on logout so a previous user's unsynced
 * writes can never replay under the next user's session on a shared device.
 * Goes through the queue lock + writeQueue([]) so an in-flight drain/enqueue
 * can't resurrect a half-cleared queue, and the pending count resets to 0.
 */
export async function clearQueue(): Promise<void> {
  await withQueueLock(async () => {
    await writeQueue([]);
  });
}

// Simple async mutex to serialize read-modify-write cycles on the queue so
// a concurrent enqueueMutation during drainQueue cannot be clobbered.
let _queueMutex: Promise<void> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _queueMutex;
  let resolve!: () => void;
  _queueMutex = new Promise<void>((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(() => resolve());
}

/** Upsert a mutation by clientId (latest write for a resource wins on replay). */
export function enqueueMutation(mutation: Omit<QueuedMutation, 'createdAt'> & { createdAt?: number }): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const entry: QueuedMutation = {
      ...mutation,
      createdAt: mutation.createdAt ?? Date.now(),
    };
    const idx = queue.findIndex((m) => m.clientId === entry.clientId);
    if (idx >= 0) queue[idx] = entry;
    else queue.push(entry);
    await writeQueue(queue);
  });
}

/** True for an ApiClientError-shaped permanent client failure (4xx incl. 409). */
function isPermanentFailure(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** Short user-facing reason from a thrown error. */
function shortError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const status = (err as { status?: number } | null)?.status;
  return status ? `Request failed (${status})` : 'Request failed';
}

/**
 * Reconciler invoked when a queued POST replays successfully on reconnect. It
 * receives the temp clientId (which was used as the optimistic entity's id) and
 * the authoritative server response, so a store can REPLACE the optimistic
 * placeholder with the real entity instead of leaving a duplicate. Registered
 * by the crewStore at module load (so offlineQueue stays decoupled from any
 * store — no import cycle). Only POST replays are reconciled; PUT/PATCH/DELETE
 * are unchanged. Errors in the reconciler are swallowed so they can never break
 * the drain/no-silent-drops contract — the reload-dedup safety net still runs.
 */
export type CreateReconciler = (clientId: string, serverResponse: unknown) => void;

let _createReconciler: CreateReconciler | null = null;

/** Register the post-replay create reconciler (latest registration wins). */
export function registerCreateReconciler(fn: CreateReconciler | null): void {
  _createReconciler = fn;
}

/**
 * Replay one queued mutation via the matching api verb (delete takes no body).
 * Returns the server response for POST so drainQueue can reconcile the temp
 * optimistic entity; other verbs return undefined (nothing to reconcile).
 */
const BYPASS = { _bypassOfflineQueue: true } as const;

async function replay(m: QueuedMutation): Promise<unknown> {
  switch (m.method) {
    case 'POST':
      return api.post(m.url, m.body, BYPASS);
    case 'PUT':
      await api.put(m.url, m.body, BYPASS);
      return undefined;
    case 'PATCH':
      await api.patch(m.url, m.body, BYPASS);
      return undefined;
    case 'DELETE':
      await api.delete(m.url, BYPASS);
      return undefined;
  }
}

/** Extract the real server id from a POST replay response (handles envelopes). */
function extractRealId(serverResponse: unknown): string | null {
  const res = serverResponse as Record<string, unknown> | null | undefined;
  if (typeof res?.id === 'string') return res.id;
  if (res && typeof res === 'object') {
    for (const v of Object.values(res)) {
      if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).id === 'string') {
        return (v as Record<string, unknown>).id as string;
      }
    }
  }
  return null;
}

let _draining = false;

/**
 * Replay queued mutations oldest-first. Re-entrancy-guarded and bounded to one
 * pass per call (each entry is attempted at most once) so a transient 5xx can
 * never spin the loop — transient failures are simply left in place and retried
 * on the next reconnect-triggered drain.
 *
 *  - success            -> remove from queue
 *  - offline again      -> stop; keep the rest for the next reconnect
 *  - permanent 4xx/409  -> remove AND push to uiStore.failedSync (no silent drop)
 *  - transient 0/5xx    -> leave in queue, skip to the next entry
 */
export async function drainQueue(): Promise<void> {
  if (_draining || isOffline()) return;
  _draining = true;
  try {
    const snapshot = (await readQueue()).sort((a, b) => a.createdAt - b.createdAt);
    for (const m of snapshot) {
      try {
        const serverResponse = await replay(m);
        await withQueueLock(async () => {
          const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId);
          await writeQueue(queue);
        });
        if (m.method === 'POST' && _createReconciler) {
          try {
            _createReconciler(m.clientId, serverResponse);
          } catch (reconErr) {
            // Never let a reconciler error break the drain / no-silent-drops
            // contract — the reload-dedup safety net still clears stale
            // _optimistic entities. Warn so the ghost-entity case is observable
            // instead of fully silent.
            console.warn('offlineQueue: create reconciler failed', reconErr);
          }
          const realId = extractRealId(serverResponse);
          if (realId && realId !== m.clientId) {
            await withQueueLock(async () => {
              const remaining = await readQueue();
              let rewritten = false;
              const patched = remaining.map((q) => {
                if (q.url.includes(m.clientId)) {
                  rewritten = true;
                  return { ...q, url: q.url.replace(m.clientId, realId) };
                }
                return q;
              });
              if (rewritten) await writeQueue(patched);
            });
          }
        }
      } catch (err) {
        if (isOffline()) break;
        if (isPermanentFailure(err)) {
          await withQueueLock(async () => {
            const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId);
            await writeQueue(queue);
          });
          recordFailed(m, shortError(err));
        } else {
          const nextRetries = (m.retries ?? 0) + 1;
          if (nextRetries >= MAX_RETRIES) {
            await withQueueLock(async () => {
              const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId);
              await writeQueue(queue);
            });
            recordFailed(m, shortError(err));
          } else {
            await withQueueLock(async () => {
              const queue = await readQueue();
              const idx = queue.findIndex((q) => q.clientId === m.clientId);
              if (idx >= 0) {
                queue[idx] = { ...queue[idx]!, retries: nextRetries };
                await writeQueue(queue);
              }
            });
          }
        }
      }
    }
  } finally {
    _draining = false; // eslint-disable-line require-atomic-updates -- module-level flag, not a real race
  }
}

/**
 * Re-enqueue a previously-failed item (the UI's "retry" button) and clear it
 * from failedSync. The next drain (or reconnect) will replay it.
 */
export async function retryFailed(item: FailedSyncItem): Promise<void> {
  const method = String(item.method).toUpperCase() as QueuedMethod;
  await enqueueMutation({
    clientId: item.clientId,
    url: item.url,
    method,
    body: item.body,
    label: item.label,
  });
  try {
    useUIStore.getState().dismissFailedSync(item.clientId);
  } catch {
    /* store not ready */
  }
  if (!isOffline()) {
    await drainQueue();
  }
}

// Re-export so consumers can detect the permanent-failure shape uniformly.
export { ApiClientError };
