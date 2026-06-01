import { api } from './api';
import { getStorage } from '../platform/storage';
import { useUIStore } from '../stores/uiStore';

/**
 * Minimal persistent offline mutation queue for React Native (the web uses its
 * own IndexedDB-backed `window.__festieQueue`). Pick/note PUTs made while
 * offline are persisted to storage and replayed on reconnect, so the
 * optimistic UI change isn't silently lost — matching what the OfflineBanner
 * promises. Mutations are keyed by a deterministic clientId so repeated toggles
 * of the same field collapse to one replayed request.
 */

const QUEUE_KEY = 'festie-offline-queue';

export interface QueuedMutation {
  clientId: string;
  url: string;
  method: 'PUT';
  body: unknown;
}

async function readQueue(): Promise<QueuedMutation[]> {
  try {
    const raw = await Promise.resolve(getStorage().getItem(QUEUE_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

/** Upsert a mutation by clientId (latest write for a field wins on replay). */
export async function enqueueMutation(mutation: QueuedMutation): Promise<void> {
  const queue = await readQueue();
  const idx = queue.findIndex((m) => m.clientId === mutation.clientId);
  if (idx >= 0) queue[idx] = mutation;
  else queue.push(mutation);
  await writeQueue(queue);
}

let _draining = false;

/**
 * Replay queued mutations oldest-first. Stops on the first failure that looks
 * like we're offline again (keeping the rest for a later drain); drops a
 * mutation that fails for a non-offline reason (e.g. a 4xx) so one poison entry
 * can't wedge the queue. Re-entrancy-guarded.
 */
export async function drainQueue(): Promise<void> {
  if (_draining || isOffline()) return;
  _draining = true;
  try {
    let queue = await readQueue();
    while (queue.length > 0) {
      const next = queue[0]!;
      try {
        await api.put(next.url, next.body);
      } catch {
        if (isOffline()) break; // back offline — retry on next reconnect
        // else: non-offline failure, drop it below to avoid a poison loop
      }
      queue = (await readQueue()).filter((m) => m.clientId !== next.clientId);
      await writeQueue(queue);
    }
  } finally {
    _draining = false;
  }
}
