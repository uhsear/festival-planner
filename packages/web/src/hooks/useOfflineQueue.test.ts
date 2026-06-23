/**
 * Tests for the localStorage fallback path in useOfflineQueue.
 *
 * When IndexedDB is unavailable (private browsing, storage quota errors, etc.)
 * the hook falls back to localStorage. The critical invariant is that a
 * successfully replayed entry is REMOVED from localStorage — not re-sent on
 * every subsequent drain — and that permanently-failed entries are also removed
 * rather than retried forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock @festie/shared/stores/uiStore — useOfflineQueue calls addFailedSync/setPendingSync
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({
      setPendingSync: vi.fn(),
      addFailedSync: vi.fn(),
    }),
}));

// Import AFTER mocks are set up
import { useOfflineQueue } from './useOfflineQueue';

const LS_KEY = 'festie-offline-queue';

/**
 * Make indexedDB.open always fire onerror so openDB() rejects and every
 * IDB-path call falls through to the localStorage fallback.
 */
function makeIDBUnavailable() {
  const fakeOpen = () => {
    const req = {
      result: null,
      error: new DOMException('IDB unavailable', 'UnknownError'),
      onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
      onsuccess: null as ((e: Event) => void) | null,
      onerror: null as ((e: Event) => void) | null,
    };
    // Fire onerror asynchronously so the Promise rejection is handled
    Promise.resolve().then(() => {
      if (req.onerror) req.onerror(new Event('error'));
    });
    return req;
  };
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    writable: true,
    value: { open: fakeOpen },
  });
}

beforeEach(() => {
  // Clear localStorage before every test
  localStorage.removeItem(LS_KEY);
  makeIDBUnavailable();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.removeItem(LS_KEY);
});

describe('useOfflineQueue — localStorage fallback', () => {
  it('queues a mutation in localStorage when IDB is unavailable', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-1',
        type: 'api',
        url: '/api/crews/abc/polls',
        method: 'POST',
        body: { question: 'Pizza?' },
      });
    });

    const queue = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queue).toHaveLength(1);
    expect(queue[0].clientId).toBe('test-client-1');
    expect(queue[0].status).toBe('pending');
  });

  it('removes a successfully replayed entry from localStorage (no re-send)', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    // Enqueue
    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-success',
        type: 'api',
        url: '/api/crews/abc/members',
        method: 'POST',
        body: { userId: 'u1' },
      });
    });

    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toHaveLength(1);

    // Drain with a succeeding apiFn
    const apiFn = vi.fn().mockResolvedValue({ ok: true });
    await act(async () => {
      await result.current.processQueue(apiFn);
    });

    // apiFn must have been called exactly once
    expect(apiFn).toHaveBeenCalledTimes(1);
    expect(apiFn).toHaveBeenCalledWith('/api/crews/abc/members', {
      method: 'POST',
      body: { userId: 'u1' },
      idempotencyKey: 'test-client-success',
    });

    // Entry must be gone — not re-queued for the next drain
    const queueAfter = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queueAfter).toHaveLength(0);
  });

  it('draining twice does NOT re-send a successfully replayed entry', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-no-dup',
        type: 'api',
        url: '/api/crews/abc/expenses',
        method: 'POST',
        body: { amount: 50 },
      });
    });

    const apiFn = vi.fn().mockResolvedValue({ ok: true });

    // First drain — should replay and remove
    await act(async () => {
      await result.current.processQueue(apiFn);
    });
    expect(apiFn).toHaveBeenCalledTimes(1);

    // Second drain — queue is empty, apiFn must NOT be called again
    await act(async () => {
      await result.current.processQueue(apiFn);
    });
    expect(apiFn).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('removes a permanently-failed entry from localStorage (no infinite retry)', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'test-client-perm-fail',
        type: 'api',
        url: '/api/crews/abc/polls',
        method: 'POST',
        body: { question: 'Tacos?' },
      });
    });

    // Simulate a 409 Conflict — permanent failure, no retry
    const conflictErr = Object.assign(new Error('Conflict'), { status: 409 });
    const apiFn = vi.fn().mockRejectedValue(conflictErr);

    await act(async () => {
      await result.current.processQueue(apiFn);
    });

    // Entry must be removed even though it failed permanently
    const queueAfter = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queueAfter).toHaveLength(0);
  });

  it('upserts by clientId — repeated queues of the same clientId collapse to one entry', async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await act(async () => {
      await result.current.queueMutation({
        clientId: 'stable-pick-id',
        type: 'api',
        url: '/api/picks',
        method: 'POST',
        body: { priority: 'must' },
      });
      await result.current.queueMutation({
        clientId: 'stable-pick-id',
        type: 'api',
        url: '/api/picks',
        method: 'POST',
        body: { priority: 'want-to-see' },
      });
    });

    const queue = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    expect(queue).toHaveLength(1);
    // Latest body wins
    expect(queue[0].body?.priority).toBe('want-to-see');
  });
});
