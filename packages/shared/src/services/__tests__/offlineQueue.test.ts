import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock the api layer so drain replays hit our stubs, not the network ──────
vi.mock('../api', () => {
  class ApiClientError extends Error {
    status: number;
    isNetworkError?: boolean;
    constructor(message: string, status: number, isNetworkError?: boolean) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
      this.isNetworkError = isNetworkError;
    }
  }
  return {
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    ApiClientError,
  };
});

import { api, ApiClientError } from '../api';
import { enqueueMutation, drainQueue, refreshPendingCount, retryFailed, clearQueue, type QueuedMutation } from '../offlineQueue';
import { useUIStore } from '../../stores/uiStore';
import { getStorage, configureStorage } from '../../platform/storage';

const QUEUE_KEY = 'festie-offline-queue';

function readPersisted(): QueuedMutation[] {
  const raw = getStorage().getItem(QUEUE_KEY) as string | null;
  return raw ? JSON.parse(raw) : [];
}

function seed(queue: QueuedMutation[]): void {
  getStorage().setItem(QUEUE_KEY, JSON.stringify(queue));
}

function makeMutation(over: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    clientId: 'PUT:/profiles/p1',
    url: '/profiles/p1',
    method: 'PUT',
    body: { picks: { s1: 'must' } },
    createdAt: Date.now(),
    ...over,
  };
}

describe('offlineQueue', () => {
  beforeEach(() => {
    getStorage().removeItem(QUEUE_KEY);
    vi.clearAllMocks();
    useUIStore.setState({ offlineMode: false, pendingSync: 0, failedSync: [] });
  });

  describe('clearQueue', () => {
    it('drops all pending mutations and zeroes the pending count (logout safety)', async () => {
      await enqueueMutation({ clientId: 'a', url: '/crews/c1/expenses', method: 'POST', body: { amount: 10 } });
      await enqueueMutation({ clientId: 'b', url: '/profiles/p1', method: 'PUT', body: { picks: {} } });
      expect(readPersisted()).toHaveLength(2);

      await clearQueue();

      expect(readPersisted()).toEqual([]);
      expect(useUIStore.getState().pendingSync).toBe(0);
    });
  });

  describe('idempotency on replay', () => {
    it('sends the clientId as an Idempotency-Key header so duplicate replays dedup server-side', async () => {
      vi.mocked(api.post).mockResolvedValue({ id: 'srv1' });
      await enqueueMutation({ clientId: 'POST:/crews/c1/expenses:k', url: '/crews/c1/expenses', method: 'POST', body: { amount: 5 } });
      await drainQueue();
      expect(api.post).toHaveBeenCalledWith(
        '/crews/c1/expenses',
        { amount: 5 },
        expect.objectContaining({ headers: { 'Idempotency-Key': 'POST:/crews/c1/expenses:k' } }),
      );
    });
  });

  describe('enqueueMutation', () => {
    it('enqueues all methods and stamps createdAt when absent', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        await enqueueMutation({ clientId: `${method}:/x`, url: '/crews/c1/polls', method });
      }
      const q = readPersisted();
      expect(q).toHaveLength(4);
      expect(q.every((m) => typeof m.createdAt === 'number')).toBe(true);
      expect(q.map((m) => m.method)).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
    });

    it('coalesces by clientId (latest write wins)', async () => {
      await enqueueMutation({ clientId: 'k', url: '/profiles/p1', method: 'PUT', body: { v: 1 } });
      await enqueueMutation({ clientId: 'k', url: '/profiles/p1', method: 'PUT', body: { v: 2 } });
      const q = readPersisted();
      expect(q).toHaveLength(1);
      expect((q[0]!.body as { v: number }).v).toBe(2);
    });

    it('publishes the pending count to uiStore', async () => {
      await enqueueMutation({ clientId: 'a', url: '/profiles/p1', method: 'PUT' });
      expect(useUIStore.getState().pendingSync).toBe(1);
    });
  });

  describe('drainQueue', () => {
    it('replays oldest-first and removes on success', async () => {
      const t = Date.now();
      seed([
        makeMutation({ clientId: 'a', method: 'PUT', url: '/profiles/p1', createdAt: t + 1 }),
        makeMutation({ clientId: 'b', method: 'POST', url: '/crews/c1/polls', createdAt: t + 2 }),
        makeMutation({ clientId: 'c', method: 'DELETE', url: '/crews/c1/polls/x', createdAt: t + 3 }),
      ]);
      vi.mocked(api.put).mockResolvedValue(undefined);
      vi.mocked(api.post).mockResolvedValue(undefined);
      vi.mocked(api.delete).mockResolvedValue(undefined);

      await drainQueue();

      expect(api.put).toHaveBeenCalledWith(
        '/profiles/p1',
        expect.anything(),
        expect.objectContaining({ _bypassOfflineQueue: true }),
      );
      expect(api.post).toHaveBeenCalledWith(
        '/crews/c1/polls',
        expect.anything(),
        expect.objectContaining({ _bypassOfflineQueue: true }),
      );
      expect(api.delete).toHaveBeenCalledWith(
        '/crews/c1/polls/x',
        expect.objectContaining({ _bypassOfflineQueue: true }),
      );
      expect(readPersisted()).toHaveLength(0);
      expect(useUIStore.getState().pendingSync).toBe(0);
    });

    it('removes AND records a permanent 4xx failure (no silent drop)', async () => {
      seed([makeMutation({ clientId: 'a', label: 'Update picks' })]);
      vi.mocked(api.put).mockRejectedValue(new ApiClientError('Bad request', 400));

      await drainQueue();

      expect(readPersisted()).toHaveLength(0);
      const failed = useUIStore.getState().failedSync;
      expect(failed).toHaveLength(1);
      expect(failed[0]!.clientId).toBe('a');
      expect(failed[0]!.label).toBe('Update picks');
      expect(failed[0]!.error).toBe('Bad request');
    });

    it('treats a 409 conflict as a permanent failure', async () => {
      seed([makeMutation({ clientId: 'a' })]);
      vi.mocked(api.put).mockRejectedValue(new ApiClientError('Conflict', 409));

      await drainQueue();

      expect(readPersisted()).toHaveLength(0);
      expect(useUIStore.getState().failedSync).toHaveLength(1);
    });

    it('keeps the queue intact when we go offline mid-drain', async () => {
      const t = Date.now();
      seed([makeMutation({ clientId: 'a', createdAt: t + 1 }), makeMutation({ clientId: 'b', createdAt: t + 2 })]);
      vi.mocked(api.put).mockImplementation(async () => {
        // Simulate dropping signal: the very first replay fails offline.
        useUIStore.setState({ offlineMode: true });
        throw new ApiClientError('Network request failed', 0, true);
      });

      await drainQueue();

      // Nothing removed, nothing surfaced as failed.
      expect(readPersisted()).toHaveLength(2);
      expect(useUIStore.getState().failedSync).toHaveLength(0);
    });

    it('leaves a transient 5xx queued for the next reconnect', async () => {
      seed([makeMutation({ clientId: 'a' })]);
      vi.mocked(api.put).mockRejectedValue(new ApiClientError('Server error', 500));

      await drainQueue();

      expect(readPersisted()).toHaveLength(1); // still queued
      expect(useUIStore.getState().failedSync).toHaveLength(0); // not a permanent fail
    });

    it('does nothing while offline', async () => {
      useUIStore.setState({ offlineMode: true });
      seed([makeMutation({ clientId: 'a' })]);

      await drainQueue();

      expect(api.put).not.toHaveBeenCalled();
      expect(readPersisted()).toHaveLength(1);
    });
  });

  describe('24h prune', () => {
    it('drops entries older than 24h on read and updates the count', async () => {
      const old = Date.now() - 25 * 60 * 60 * 1000;
      seed([
        makeMutation({ clientId: 'stale', createdAt: old }),
        makeMutation({ clientId: 'fresh', createdAt: Date.now() }),
      ]);

      await refreshPendingCount();

      const q = readPersisted();
      expect(q).toHaveLength(1);
      expect(q[0]!.clientId).toBe('fresh');
      expect(useUIStore.getState().pendingSync).toBe(1);
    });
  });

  // Finding #13: readQueue's internal stale-prune writeQueue must run under the
  // queue lock, or it clobbers a concurrent enqueue that commits between the
  // snapshot read and the prune-write. Needs a pausable ASYNC adapter (mimics
  // AsyncStorage) — sync localStorage can't deterministically lose the write
  // because enqueue's extra awaits always land its write last.
  describe('mutex / lost-write race', () => {
    function pausable(initial: Record<string, string>) {
      const data = new Map(Object.entries(initial));
      let release: (() => void) | null = null;
      let pauseQueueSet = false;
      const adapter = {
        getItem: (k: string) => Promise.resolve(data.get(k) ?? null),
        setItem: (k: string, v: string) => {
          if (pauseQueueSet && k === QUEUE_KEY) {
            pauseQueueSet = false;
            return new Promise<void>((res) => {
              release = () => {
                data.set(k, v);
                res();
              };
            });
          }
          data.set(k, v);
          return Promise.resolve();
        },
        removeItem: (k: string) => {
          data.delete(k);
          return Promise.resolve();
        },
      };
      return {
        adapter,
        pauseNextQueueSet() {
          pauseQueueSet = true;
        },
        releasePausedSet() {
          release?.();
          release = null;
        },
        peek(k: string) {
          return data.get(k);
        },
      };
    }

    const tick = () => new Promise((r) => setTimeout(r, 0));

    it('unlocked prune-write must not clobber a concurrent enqueue', async () => {
      const original = getStorage();
      const s = pausable({
        [QUEUE_KEY]: JSON.stringify([
          { clientId: 'stale', url: '/x', method: 'PUT', body: {}, createdAt: Date.now() - 25 * 3600 * 1000 },
        ]),
      });
      configureStorage(s.adapter);
      useUIStore.setState({ offlineMode: false, pendingSync: 0, failedSync: [] });
      try {
        // A: reads [stale], computes fresh=[], and PAUSES at the prune-write
        // (holding the queue lock only after the fix).
        s.pauseNextQueueSet();
        const pRefresh = refreshPendingCount();
        await tick();
        // B: a concurrent enqueue of a FRESH mutation, committed under the lock.
        const pEnq = enqueueMutation({ clientId: 'fresh', url: '/x', method: 'PUT', body: { v: 1 } });
        await tick();
        // Let A's paused prune-write land, then settle both.
        s.releasePausedSet();
        await Promise.all([pRefresh, pEnq]);

        const persisted: QueuedMutation[] = JSON.parse(s.peek(QUEUE_KEY) ?? '[]');
        // Current code: A's stale prune-write [] lands after B's [fresh] → 'fresh' lost.
        // After fix: B blocks on the mutex until A's prune completes, then appends → [fresh].
        expect(persisted.map((m) => m.clientId)).toContain('fresh');
      } finally {
        configureStorage(original);
      }
    });
  });

  describe('retryFailed', () => {
    it('re-enqueues a failed item, dismisses it, and drains when online', async () => {
      useUIStore.setState({
        failedSync: [
          {
            clientId: 'a',
            label: 'Update picks',
            method: 'PUT',
            url: '/profiles/p1',
            body: { picks: {} },
            error: 'Bad request',
            at: Date.now(),
          },
        ],
      });
      vi.mocked(api.put).mockResolvedValue(undefined);

      await retryFailed(useUIStore.getState().failedSync[0]!);

      // Dismissed from failedSync, replayed (drained) since we're online.
      expect(useUIStore.getState().failedSync).toHaveLength(0);
      expect(api.put).toHaveBeenCalledWith(
        '/profiles/p1',
        { picks: {} },
        expect.objectContaining({ _bypassOfflineQueue: true }),
      );
      expect(readPersisted()).toHaveLength(0);
    });

    it('re-enqueues but does not drain while offline', async () => {
      useUIStore.setState({
        offlineMode: true,
        failedSync: [
          {
            clientId: 'a',
            label: 'Update picks',
            method: 'PUT',
            url: '/profiles/p1',
            body: { picks: {} },
            error: 'Bad request',
            at: Date.now(),
          },
        ],
      });

      await retryFailed(useUIStore.getState().failedSync[0]!);

      expect(api.put).not.toHaveBeenCalled();
      expect(readPersisted()).toHaveLength(1);
      expect(useUIStore.getState().failedSync).toHaveLength(0);
    });
  });
});
