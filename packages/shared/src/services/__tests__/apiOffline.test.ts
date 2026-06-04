import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the offlineQueue module that api.ts dynamically imports on the native
// path, so we can assert what gets enqueued without touching storage.
const enqueueMutation = vi.fn(async () => {});
const drainQueue = vi.fn(async () => {});
vi.mock('../offlineQueue', () => ({ enqueueMutation, drainQueue }));

import { api, isOfflineEligible } from '../api';
import { useUIStore } from '../../stores/uiStore';

const okResponse = (data: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => data,
  }) as unknown as Response;

describe('api offline interception', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ offlineMode: false });
    // Ensure the web bridge isn't present so eligible offline writes take the
    // native (enqueueMutation) path we can assert on.
    delete (window as unknown as { __festieQueue?: unknown }).__festieQueue;
    fetchSpy = vi.fn(async () => okResponse({ data: { ok: true }, error: null }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isOfflineEligible', () => {
    it('allows profiles and known crew sub-resources', () => {
      expect(isOfflineEligible('/profiles/p1')).toBe(true);
      expect(isOfflineEligible('/crews/c1/meeting-points')).toBe(true);
      expect(isOfflineEligible('/crews/c1/polls')).toBe(true);
      expect(isOfflineEligible('/crews/c1/polls/poll1/vote')).toBe(true);
      expect(isOfflineEligible('/crews/c1/packing')).toBe(true);
      expect(isOfflineEligible('/crews/c1/packing/item1')).toBe(true);
      expect(isOfflineEligible('/crews/c1/rides')).toBe(true);
      expect(isOfflineEligible('/crews/c1/rides/ride1')).toBe(true);
      expect(isOfflineEligible('/crews/c1/expenses')).toBe(true);
      expect(isOfflineEligible('/crews/c1/home-base')).toBe(true);
      expect(isOfflineEligible('/crews/c1/reminders')).toBe(true);
    });

    it('rejects auth/account/admin/session and unknown crew sub-resources', () => {
      expect(isOfflineEligible('/auth/login')).toBe(false);
      expect(isOfflineEligible('/auth/logout')).toBe(false);
      expect(isOfflineEligible('/account')).toBe(false);
      expect(isOfflineEligible('/admin/festivals')).toBe(false);
      expect(isOfflineEligible('/sessions')).toBe(false);
      expect(isOfflineEligible('/crews/c1/members')).toBe(false);
      expect(isOfflineEligible('/crews')).toBe(false);
    });
  });

  describe('offline + eligible → enqueue + synthetic result', () => {
    beforeEach(() => {
      useUIStore.setState({ offlineMode: true });
    });

    it('POST queues with a unique clientId and returns optimistic create', async () => {
      const result = await api.post<{ id: string; _optimistic: boolean; title: string }>('/crews/c1/polls', {
        title: 'Where to meet?',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(enqueueMutation).toHaveBeenCalledTimes(1);
      const arg = enqueueMutation.mock.calls[0]![0] as {
        clientId: string;
        method: string;
        url: string;
      };
      expect(arg.method).toBe('POST');
      expect(arg.url).toBe('/crews/c1/polls');
      expect(arg.clientId.startsWith('POST:/crews/c1/polls:')).toBe(true);
      expect(result._optimistic).toBe(true);
      expect(result.id).toBe(arg.clientId);
      expect(result.title).toBe('Where to meet?');
    });

    it('PUT coalesces with a deterministic per-resource clientId', async () => {
      const result = await api.put<{ _optimistic: boolean; picks: unknown }>('/profiles/p1', {
        picks: { s1: 'must' },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      const arg = enqueueMutation.mock.calls[0]![0] as { clientId: string; method: string };
      expect(arg.method).toBe('PUT');
      expect(arg.clientId).toBe('PUT:/profiles/p1');
      expect(result._optimistic).toBe(true);
    });

    it('honors an explicit clientId + offlineLabel option', async () => {
      await api.put('/profiles/p1', { picks: {} }, { clientId: 'pick-p1-s1', offlineLabel: 'Update picks' });
      const arg = enqueueMutation.mock.calls[0]![0] as { clientId: string; label: string };
      expect(arg.clientId).toBe('pick-p1-s1');
      expect(arg.label).toBe('Update picks');
    });

    it('DELETE returns an optimistic ok result', async () => {
      const result = await api.delete<{ ok: boolean; _optimistic: boolean }>('/crews/c1/polls/x');
      expect(fetchSpy).not.toHaveBeenCalled();
      const arg = enqueueMutation.mock.calls[0]![0] as { clientId: string; method: string };
      expect(arg.method).toBe('DELETE');
      expect(arg.clientId).toBe('DELETE:/crews/c1/polls/x');
      expect(result.ok).toBe(true);
      expect(result._optimistic).toBe(true);
    });

    it('prefers the web bridge when window.__festieQueue is present', async () => {
      const queueMutation = vi.fn(async () => {});
      (window as unknown as { __festieQueue: unknown }).__festieQueue = { queueMutation };
      await api.put('/profiles/p1', { picks: {} });
      expect(queueMutation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'api', url: '/profiles/p1', method: 'PUT' }),
      );
      expect(enqueueMutation).not.toHaveBeenCalled();
      delete (window as unknown as { __festieQueue?: unknown }).__festieQueue;
    });
  });

  describe('does NOT intercept', () => {
    it('offline + ineligible path still fetches (e.g. /auth/login)', async () => {
      useUIStore.setState({ offlineMode: true });
      await api.post('/auth/login', { username: 'a', password: 'b' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(enqueueMutation).not.toHaveBeenCalled();
    });

    it('online + eligible path fetches as normal', async () => {
      useUIStore.setState({ offlineMode: false });
      await api.put('/profiles/p1', { picks: {} });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(enqueueMutation).not.toHaveBeenCalled();
    });

    it('offline + eligible GET is not queued (GET is not a mutation)', async () => {
      useUIStore.setState({ offlineMode: true });
      await api.get('/profiles/p1');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(enqueueMutation).not.toHaveBeenCalled();
    });
  });

  describe('network failure on a not-yet-detected-offline device (festival case)', () => {
    it('queues an eligible mutation + flips store offline when the fetch rejects', async () => {
      useUIStore.setState({ offlineMode: false }); // navigator says online, but...
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch')); // ...network is dead
      const result = await api.post<{ id: string; _optimistic: boolean }>('/crews/c1/meeting-points', {
        label: 'Main gate',
      });
      // fetch was attempted (offline not known up-front) then the write was rescued.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(enqueueMutation).toHaveBeenCalledTimes(1);
      expect(result._optimistic).toBe(true);
      expect(useUIStore.getState().offlineMode).toBe(true);
    });

    it('still throws the network error for an INELIGIBLE mutation (not lost-silently elsewhere)', async () => {
      useUIStore.setState({ offlineMode: false });
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(api.post('/auth/login', { username: 'a', password: 'b' })).rejects.toMatchObject({
        isNetworkError: true,
      });
      expect(enqueueMutation).not.toHaveBeenCalled();
    });
  });

  describe('auto-recovery: a successful response after a false-offline drains the queue', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
    });

    it('flips offline→online and drains on the next successful network request', async () => {
      useUIStore.setState({ offlineMode: true });
      // A GET succeeds (reads still fetch) → reachability proven.
      await api.get('/profiles/p1');
      expect(useUIStore.getState().offlineMode).toBe(false);
      // drain is dispatched via a fire-and-forget dynamic import; let it settle.
      await vi.waitFor(() => expect(drainQueue).toHaveBeenCalledTimes(1));
    });

    it('does NOT flip online when navigator.onLine is false (cold-start offline; cached 200)', async () => {
      Object.defineProperty(navigator, 'onLine', { writable: true, value: false });
      useUIStore.setState({ offlineMode: true });
      await api.get('/profiles/p1'); // a SW-cached 200, but OS says offline
      expect(useUIStore.getState().offlineMode).toBe(true);
      expect(drainQueue).not.toHaveBeenCalled();
    });

    it('does NOT flip online on a /festivals 200 (service-worker StaleWhileRevalidate cache)', async () => {
      useUIStore.setState({ offlineMode: true });
      await api.get('/festivals/forbidden-kingdom-2026'); // can be served from SW cache offline
      expect(useUIStore.getState().offlineMode).toBe(true);
      expect(drainQueue).not.toHaveBeenCalled();
    });
  });
});
