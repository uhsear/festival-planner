/**
 * OFFLINE PHASE 2 — optimistic rendering of offline-CREATED crew entities +
 * temp-id → real-id reconciliation.
 *
 * Unlike crewStore.test.ts (which mocks the api layer), this suite exercises
 * the REAL api.ts + offlineQueue.ts + crewStore.ts together against a mocked
 * `fetch` and the jsdom localStorage-backed queue, so the full offline→online
 * round-trip (optimistic insert → queue → drain → reconcile) is proven.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCrewStore } from './crewStore';
import { drainQueue, type QueuedMutation } from '../services/offlineQueue';
import { useUIStore } from '../stores/uiStore';
import { getStorage } from '../platform/storage';

const QUEUE_KEY = 'festie-offline-queue';

function readQueue(): QueuedMutation[] {
  const raw = getStorage().getItem(QUEUE_KEY) as string | null;
  return raw ? JSON.parse(raw) : [];
}

function resetStore() {
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    crewOverlap: {},
    polls: [],
    meetingPoints: [],
    expenses: [],
    expenseBalances: [],
    activity: [],
    crewLoading: false,
    error: null,
    _cachedAt: null,
    _cachedCrewId: null,
  });
}

/** A fetch Response stub returning the data envelope api.ts unwraps. */
const envelope = (data: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data, error: null }),
  }) as unknown as Response;

describe('crewStore offline optimistic create + reconciliation (Phase 2)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStore();
    getStorage().removeItem(QUEUE_KEY);
    vi.clearAllMocks();
    useUIStore.setState({ offlineMode: false, pendingSync: 0, failedSync: [] });
    // Native queue path (no web bridge) so offlineQueue handles enqueue/drain.
    delete (window as unknown as { __festieQueue?: unknown }).__festieQueue;
    Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Optimistic insert renders immediately offline ────────────────────────
  describe('optimistic insert (offline)', () => {
    it('createPoll inserts an optimistic poll without fetching', async () => {
      useUIStore.setState({ offlineMode: true });
      const poll = await useCrewStore.getState().createPoll('crew-1', {
        question: 'Where to meet?',
        options: ['Gate A', 'Gate B'],
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(poll._optimistic).toBe(true);
      expect(poll.question).toBe('Where to meet?');
      expect(poll.id.startsWith('POST:/crews/crew-1/polls:')).toBe(true);

      const polls = useCrewStore.getState().polls;
      expect(polls).toHaveLength(1);
      expect(polls[0]!._optimistic).toBe(true);
      expect(polls[0]!.id).toBe(poll.id);

      // The write is durably queued for replay.
      const q = readQueue();
      expect(q).toHaveLength(1);
      expect(q[0]!.method).toBe('POST');
      expect(q[0]!.url).toBe('/crews/crew-1/polls');
      expect(q[0]!.clientId).toBe(poll.id);
    });

    it('createMeetingPoint inserts an optimistic meeting point offline', async () => {
      useUIStore.setState({ offlineMode: true });
      const mp = await useCrewStore.getState().createMeetingPoint('crew-1', {
        label: 'Main gate',
        location: 'North',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mp._optimistic).toBe(true);
      expect(mp.label).toBe('Main gate');
      const list = useCrewStore.getState().meetingPoints;
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(mp.id);
    });

    it('updateMeetingPoint MERGES the request body into the existing point offline (not undefined)', async () => {
      useUIStore.setState({ offlineMode: true });
      useCrewStore.setState({
        meetingPoints: [
          {
            id: 'mp-1',
            crew_id: 'crew-1',
            created_by: 'u1',
            label: 'Old gate',
            location: 'North',
            type: 'custom',
            meet_at: null,
            stage_reference: null,
            active: true,
            created_at: '2026-06-03T00:00:00Z',
          },
        ],
      });

      const result = await useCrewStore.getState().updateMeetingPoint('crew-1', 'mp-1', {
        label: 'New gate',
        meetAt: '2026-06-03T20:00:00Z',
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      const list = useCrewStore.getState().meetingPoints;
      // Exactly one entity, and it's a real merged point — never undefined.
      expect(list).toHaveLength(1);
      expect(list[0]).toBeDefined();
      expect(list[0]!.label).toBe('New gate');
      // Field NOT in the request keeps its prior value (no clobber to undefined).
      expect(list[0]!.location).toBe('North');
      // camelCase request → snake_case stored field mapping.
      expect(list[0]!.meet_at).toBe('2026-06-03T20:00:00Z');
      // The returned value is the merged entity, not undefined.
      expect(result).toBeDefined();
      expect(result.label).toBe('New gate');
      expect(result.location).toBe('North');
    });

    it('addExpense inserts an optimistic expense offline WITHOUT recomputing balances or refetching', async () => {
      useUIStore.setState({ offlineMode: true });
      useCrewStore.setState({ expenseBalances: [{ userId: 'u1', username: 'A', balance: 5 }] });

      await useCrewStore.getState().addExpense('crew-1', {
        description: 'Beer',
        amount: 12,
        splitWith: ['u1', 'u2'],
        category: 'drinks',
      });

      // No GET refetch fired (would have failed offline anyway).
      expect(fetchSpy).not.toHaveBeenCalled();
      const expenses = useCrewStore.getState().expenses;
      expect(expenses).toHaveLength(1);
      expect(expenses[0]!._optimistic).toBe(true);
      expect(expenses[0]!.description).toBe('Beer');
      expect(expenses[0]!.split_with).toEqual(['u1', 'u2']);
      // Balances are NOT optimistically faked — left as-is for the next sync.
      expect(useCrewStore.getState().expenseBalances).toEqual([{ userId: 'u1', username: 'A', balance: 5 }]);
    });
  });

  // ── Reconciliation: exactly ONE entity after replay (the no-dupe proof) ───
  describe('reconciliation on reconnect (no duplicate)', () => {
    it('replaces the optimistic poll with the real server poll — exactly one remains', async () => {
      useUIStore.setState({ offlineMode: true });
      const optimistic = await useCrewStore.getState().createPoll('crew-1', {
        question: 'Q?',
        options: ['a', 'b'],
      });
      expect(useCrewStore.getState().polls).toHaveLength(1);

      // Reconnect: the queued POST replays and the server returns the real poll.
      useUIStore.setState({ offlineMode: false });
      const realPoll = {
        id: 'real-poll-id',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Q?',
        options: ['a', 'b'],
        votes: [],
        closes_at: null,
        closed: false,
        created_at: '2026-06-03T00:00:00Z',
      };
      fetchSpy.mockResolvedValue(envelope({ poll: realPoll }));

      await drainQueue();

      const polls = useCrewStore.getState().polls;
      // THE PROOF: exactly one poll, it's the REAL one, no lingering _optimistic.
      expect(polls).toHaveLength(1);
      expect(polls[0]!.id).toBe('real-poll-id');
      expect(polls[0]!._optimistic).toBe(false);
      expect(polls.some((p) => p.id === optimistic.id)).toBe(false);
      // Queue fully drained.
      expect(readQueue()).toHaveLength(0);
    });

    it('replaces the optimistic meeting point with the real server entity — exactly one remains', async () => {
      useUIStore.setState({ offlineMode: true });
      const optimistic = await useCrewStore.getState().createMeetingPoint('crew-1', {
        label: 'Gate',
        location: 'N',
      });
      useUIStore.setState({ offlineMode: false });
      const realMp = {
        id: 'real-mp-id',
        crew_id: 'crew-1',
        created_by: 'user-1',
        label: 'Gate',
        location: 'N',
        type: 'custom',
        meet_at: null,
        stage_reference: null,
        active: true,
        created_at: '2026-06-03T00:00:00Z',
      };
      fetchSpy.mockResolvedValue(envelope({ meetingPoint: realMp }));

      await drainQueue();

      const list = useCrewStore.getState().meetingPoints;
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('real-mp-id');
      expect(list[0]!._optimistic).toBe(false);
      expect(list.some((m) => m.id === optimistic.id)).toBe(false);
      expect(readQueue()).toHaveLength(0);
    });

    it('removes the optimistic expense on replay (balances reconcile on next sync)', async () => {
      useUIStore.setState({ offlineMode: true });
      await useCrewStore.getState().addExpense('crew-1', {
        description: 'Beer',
        amount: 12,
        splitWith: ['u1'],
        category: 'drinks',
      });
      expect(useCrewStore.getState().expenses).toHaveLength(1);

      useUIStore.setState({ offlineMode: false });
      fetchSpy.mockResolvedValue(envelope({ id: 'real-exp-id' }));

      await drainQueue();

      // Placeholder removed; no duplicate, no lingering _optimistic.
      const expenses = useCrewStore.getState().expenses;
      expect(expenses.some((e) => e._optimistic)).toBe(false);
      expect(expenses).toHaveLength(0);
      expect(readQueue()).toHaveLength(0);
    });

    it('does not double-insert if the real entity already arrived (e.g. via socket) before replay', async () => {
      useUIStore.setState({ offlineMode: true });
      const optimistic = await useCrewStore.getState().createPoll('crew-1', {
        question: 'Q?',
        options: ['a', 'b'],
      });
      // Simulate the realtime socket delivering the real poll first.
      const realPoll = {
        id: 'real-poll-id',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Q?',
        options: ['a', 'b'],
        votes: [],
        closes_at: null,
        closed: false,
        created_at: '2026-06-03T00:00:00Z',
      };
      useCrewStore.getState().applyPollCreated(realPoll);
      // Now state has [real, optimistic].
      expect(useCrewStore.getState().polls).toHaveLength(2);

      useUIStore.setState({ offlineMode: false });
      fetchSpy.mockResolvedValue(envelope({ poll: realPoll }));
      await drainQueue();

      const polls = useCrewStore.getState().polls;
      // Optimistic dropped; real kept once — no duplicate.
      expect(polls).toHaveLength(1);
      expect(polls[0]!.id).toBe('real-poll-id');
      expect(polls.some((p) => p.id === optimistic.id)).toBe(false);
    });
  });

  // ── Reload-dedup safety net ───────────────────────────────────────────────
  describe('reload-dedup: load* drops lingering _optimistic placeholders', () => {
    it('loadPolls discards an optimistic poll when the server list arrives', async () => {
      useCrewStore.setState({
        polls: [
          {
            id: 'POST:/crews/crew-1/polls:temp',
            crew_id: 'crew-1',
            created_by: '',
            question: 'temp',
            options: ['a'],
            votes: [],
            closes_at: null,
            closed: false,
            created_at: '2026-06-03T00:00:00Z',
            _optimistic: true,
          },
        ],
      });
      const serverPoll = {
        id: 'real-id',
        crew_id: 'crew-1',
        created_by: 'u1',
        question: 'real',
        options: ['a'],
        votes: [],
        closes_at: null,
        closed: false,
        created_at: '2026-06-03T00:00:00Z',
      };
      fetchSpy.mockResolvedValue(envelope({ polls: [serverPoll] }));

      await useCrewStore.getState().loadPolls('crew-1');

      const polls = useCrewStore.getState().polls;
      expect(polls).toHaveLength(1);
      expect(polls[0]!.id).toBe('real-id');
      expect(polls.some((p) => p._optimistic)).toBe(false);
    });

    it('loadMeetingPoints discards lingering optimistic placeholders', async () => {
      useCrewStore.setState({
        meetingPoints: [
          {
            id: 'temp',
            crew_id: 'crew-1',
            created_by: '',
            label: 't',
            location: 'l',
            type: 'custom',
            meet_at: null,
            stage_reference: null,
            active: true,
            created_at: '2026-06-03T00:00:00Z',
            _optimistic: true,
          },
        ],
      });
      fetchSpy.mockResolvedValue(envelope({ meetingPoints: [] }));
      await useCrewStore.getState().loadMeetingPoints('crew-1');
      expect(useCrewStore.getState().meetingPoints).toHaveLength(0);
    });

    it('loadExpenses discards lingering optimistic placeholders', async () => {
      useCrewStore.setState({
        expenses: [
          {
            id: 'temp',
            crew_id: 'crew-1',
            paid_by: '',
            paid_by_name: '',
            description: 't',
            amount: 1,
            split_with: ['u1'],
            category: 'x',
            created_at: '2026-06-03T00:00:00Z',
            _optimistic: true,
          },
        ],
      });
      // First GET = expenses list, second GET = balances.
      fetchSpy
        .mockResolvedValueOnce(envelope([]))
        .mockResolvedValueOnce(envelope([{ userId: 'u1', username: 'A', balance: 0 }]));
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenses).toHaveLength(0);
    });
  });

  // ── Online path + PUT/DELETE are unaffected ──────────────────────────────
  describe('online + non-POST paths are unaffected (guardrail)', () => {
    it('online createPoll fetches and inserts the real poll (no _optimistic)', async () => {
      useUIStore.setState({ offlineMode: false });
      const realPoll = {
        id: 'real-poll-id',
        crew_id: 'crew-1',
        created_by: 'u1',
        question: 'Q?',
        options: ['a', 'b'],
        votes: [],
        closes_at: null,
        closed: false,
        created_at: '2026-06-03T00:00:00Z',
      };
      fetchSpy.mockResolvedValue(envelope({ poll: realPoll }));

      const poll = await useCrewStore.getState().createPoll('crew-1', { question: 'Q?', options: ['a', 'b'] });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(poll.id).toBe('real-poll-id');
      expect(poll._optimistic).toBeUndefined();
      const polls = useCrewStore.getState().polls;
      expect(polls).toHaveLength(1);
      expect(polls[0]!.id).toBe('real-poll-id');
      // Nothing queued.
      expect(readQueue()).toHaveLength(0);
    });

    it('offline updateMeetingPoint (PUT) queues a coalesced per-resource write (no POST optimistic placeholder, no reconciler)', async () => {
      useUIStore.setState({ offlineMode: true });

      await useCrewStore.getState().updateMeetingPoint('crew-1', 'mp-1', { label: 'New' });

      expect(fetchSpy).not.toHaveBeenCalled();
      const q = readQueue();
      expect(q).toHaveLength(1);
      expect(q[0]!.method).toBe('PUT');
      // PUT clientId is deterministic per-resource (coalescing), NOT a POST id —
      // so the POST-only reconciler never touches it.
      expect(q[0]!.clientId).toBe('PUT:/crews/crew-1/meeting-points/mp-1');
    });

    it('offline deleteMeetingPoint (DELETE) removes locally + queues, no reconciler interference', async () => {
      useUIStore.setState({ offlineMode: true });
      useCrewStore.setState({
        meetingPoints: [
          {
            id: 'mp-1',
            crew_id: 'crew-1',
            created_by: 'u1',
            label: 'X',
            location: 'N',
            type: 'custom',
            meet_at: null,
            stage_reference: null,
            active: true,
            created_at: '2026-06-03T00:00:00Z',
          },
        ],
      });
      await useCrewStore.getState().deleteMeetingPoint('crew-1', 'mp-1');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(useCrewStore.getState().meetingPoints).toHaveLength(0);
      const q = readQueue();
      expect(q).toHaveLength(1);
      expect(q[0]!.method).toBe('DELETE');
    });
  });
});
