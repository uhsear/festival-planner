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

/** Read the persisted queue and publish its count (call on app start). */
export async function refreshPendingCount(): Promise<void> {
  updatePendingCount((await readQueue()).length);
}

/** NetInfo-driven (uiStore.offlineMode); false if the store isn't ready. */
export function isOffline(): boolean {
  try {
    return useUIStore.getState().offlineMode === true;
  } catch {
    return false;
  }
}

/** Add a failed item to uiStore.failedSync (no silent drops). */
function recordFailed(m: QueuedMutation, error: string): void {
  try {
    useUIStore.getState().addFailedSync({
      clientId: m.clientId,
      label: m.label ?? `${m.method} ${m.url}`,
      method: m.method,
      url: m.url,
      body: m.body,
      error,
      at: Date.now(),
    });
  } catch {
    /* store not ready */
  }
}

/** Upsert a mutation by clientId (latest write for a resource wins on replay). */
export async function enqueueMutation(
  mutation: Omit<QueuedMutation, 'createdAt'> & { createdAt?: number },
): Promise<void> {
  const queue = await readQueue();
  const entry: QueuedMutation = {
    ...mutation,
    createdAt: mutation.createdAt ?? Date.now(),
  };
  const idx = queue.findIndex((m) => m.clientId === entry.clientId);
  if (idx >= 0) queue[idx] = entry;
  else queue.push(entry);
  await writeQueue(queue);
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
async function replay(m: QueuedMutation): Promise<unknown> {
  switch (m.method) {
    case 'POST':
      return api.post(m.url, m.body);
    case 'PUT':
      await api.put(m.url, m.body);
      return undefined;
    case 'PATCH':
      await api.patch(m.url, m.body);
      return undefined;
    case 'DELETE':
      await api.delete(m.url);
      return undefined;
  }
}

let _draining = false;

/**
 * Replay queued mutations oldest-first. Re-entrancy-guarded and bounded to one
 * pass per call (each entry is attempted at most once) so a transient 5xx can
 * never spin the loop — transient failures are simply left in place and retried
 * on the next reconnect-triggered drain.
 *
 *  - success            → remove from queue
 *  - offline again      → stop; keep the rest for the next reconnect
 *  - permanent 4xx/409  → remove AND push to uiStore.failedSync (no silent drop)
 *  - transient 0/5xx    → leave in queue, skip to the next entry
 */
export async function drainQueue(): Promise<void> {
  if (_draining || isOffline()) return;
  _draining = true;
  try {
    // Snapshot oldest-first; attempt each entry at most once this pass.
    const snapshot = (await readQueue()).sort((a, b) => a.createdAt - b.createdAt);
    for (const m of snapshot) {
      try {
        const serverResponse = await replay(m);
        // Success — drop just this entry (re-read so a concurrent enqueue of a
        // different clientId isn't clobbered).
        const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId);
        await writeQueue(queue);
        // Reconcile the optimistic placeholder (POST only) with the real
        // server entity so no duplicate lingers. Best-effort: a throwing
        // reconciler must not abort the drain or strand other entries.
        if (m.method === 'POST' && _createReconciler) {
          try {
            _createReconciler(m.clientId, serverResponse);
          } catch {
            /* reload-dedup safety net still removes stale _optimistic entities */
          }
        }
      } catch (err) {
        if (isOffline()) break; // back offline — keep the rest, retry next time
        if (isPermanentFailure(err)) {
          // Permanent: remove from queue AND surface so it's never silently lost.
          const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId);
          await writeQueue(queue);
          recordFailed(m, shortError(err));
        } else {
          // Transient (status 0 / >=500): bump the retry counter so a write that
          // keeps 5xx-ing can't stay queued forever. At MAX_RETRIES remove it AND
          // surface it (no silent drop) — matching the web queue's cap.
          const nextRetries = (m.retries ?? 0) + 1;
          if (nextRetries >= MAX_RETRIES) {
            const queue = (await readQueue()).filter((q) => q.clientId !== m.clientId);
            await writeQueue(queue);
            recordFailed(m, shortError(err));
          } else {
            // Persist the incremented count and leave it queued for the next pass.
            const queue = await readQueue();
            const idx = queue.findIndex((q) => q.clientId === m.clientId);
            if (idx >= 0) {
              queue[idx] = { ...queue[idx]!, retries: nextRetries };
              await writeQueue(queue);
            }
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
  // Best-effort immediate drain if we're back online.
  if (!isOffline()) {
    await drainQueue();
  }
}

// Re-export so consumers can detect the permanent-failure shape uniformly.
export { ApiClientError };
