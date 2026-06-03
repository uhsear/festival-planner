import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCrewStore } from './crewStore';
import { api } from '../services/api';
import type {
  Crew,
  CrewMember,
  CrewPoll,
  CrewMeetingPoint,
  CrewExpense,
  CrewExpenseBalance,
  CrewActivityEntry,
} from '../types/domain';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const PERSIST_KEY = 'festie-crew';

const mockCrew: Crew = {
  id: 'crew-1',
  name: 'Test Crew',
  owner: 'user-1',
  members: [],
  inviteCode: 'ABC123',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockMembers: CrewMember[] = [
  { id: 'cm-1', userId: 'user-1', name: 'Alice', role: 'owner' },
  { id: 'cm-2', userId: 'user-2', name: 'Bob', role: 'member' },
];

function makePolls(n: number): CrewPoll[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `poll-${i}`,
    crew_id: 'crew-1',
    created_by: 'user-1',
    question: `Q${i}`,
    options: ['a', 'b'],
    votes: [],
    closes_at: null,
    closed: false,
    created_at: '2026-01-01T00:00:00Z',
  }));
}

function makeExpenses(n: number): CrewExpense[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `exp-${i}`,
    crew_id: 'crew-1',
    paid_by: 'user-1',
    paid_by_name: 'Alice',
    description: `Item ${i}`,
    amount: 10,
    split_with: ['user-1', 'user-2'],
    category: 'food',
    created_at: '2026-01-01T00:00:00Z',
  }));
}

function makeActivity(n: number): CrewActivityEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `act-${i}`,
    crew_id: 'crew-1',
    user_id: 'user-1',
    username: 'Alice',
    type: 'join',
    detail: null,
    created_at: '2026-01-01T00:00:00Z',
  }));
}

const mockMeetingPoints: CrewMeetingPoint[] = [
  {
    id: 'mp-1',
    crew_id: 'crew-1',
    created_by: 'user-1',
    label: 'Main Gate',
    location: 'North entrance',
    type: 'fixed',
    meet_at: null,
    stage_reference: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const mockBalances: CrewExpenseBalance[] = [{ userId: 'user-1', username: 'Alice', balance: 5 }];

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

function readPersistedState(): Record<string, unknown> {
  const raw = localStorage.getItem(PERSIST_KEY);
  expect(raw).toBeTruthy();
  return JSON.parse(raw!).state as Record<string, unknown>;
}

describe('crewStore persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('partialize: which fields are persisted', () => {
    it('persists only the bounded active-crew read-cache fields', () => {
      // Mutate via setState so persist writes through.
      useCrewStore.setState({
        crews: [mockCrew],
        activeCrew: mockCrew,
        crewMembers: mockMembers,
        meetingPoints: mockMeetingPoints,
        polls: makePolls(3),
        expenses: makeExpenses(3),
        expenseBalances: mockBalances,
        activity: makeActivity(3),
        crewOverlap: { 'user-2': { sets: [] } as never },
        crewLoading: true,
        error: 'boom',
        _cachedAt: 1234,
        _cachedCrewId: 'crew-1',
      });

      const state = readPersistedState();

      // Read-cache + bookkeeping fields ARE persisted.
      expect(state).toHaveProperty('crews');
      expect(state).toHaveProperty('activeCrew');
      expect(state).toHaveProperty('crewMembers');
      expect(state).toHaveProperty('meetingPoints');
      expect(state).toHaveProperty('polls');
      expect(state).toHaveProperty('expenses');
      expect(state).toHaveProperty('expenseBalances');
      expect(state).toHaveProperty('activity');
      expect(state._cachedAt).toBe(1234);
      expect(state._cachedCrewId).toBe('crew-1');

      // Transient fields are NOT persisted.
      expect(state).not.toHaveProperty('crewOverlap');
      expect(state).not.toHaveProperty('crewLoading');
      expect(state).not.toHaveProperty('error');
    });
  });

  describe('size bounds', () => {
    it('caps activity to 50, polls and expenses to 100', () => {
      useCrewStore.setState({
        polls: makePolls(150),
        expenses: makeExpenses(150),
        activity: makeActivity(120),
      });

      const state = readPersistedState();
      expect((state.polls as unknown[]).length).toBe(100);
      expect((state.expenses as unknown[]).length).toBe(100);
      expect((state.activity as unknown[]).length).toBe(50);
    });

    it('keeps the most-recent (head) items when capping', () => {
      useCrewStore.setState({ activity: makeActivity(60) });
      const state = readPersistedState();
      const ids = (state.activity as CrewActivityEntry[]).map((a) => a.id);
      expect(ids[0]).toBe('act-0');
      expect(ids[ids.length - 1]).toBe('act-49');
    });

    it('does not pad lists shorter than the cap', () => {
      useCrewStore.setState({ polls: makePolls(5) });
      const state = readPersistedState();
      expect((state.polls as unknown[]).length).toBe(5);
    });
  });

  describe('staleness guard (_cachedCrewId) in selectCrew', () => {
    it('drops cached sub-data when opening a DIFFERENT crew than the cached one', async () => {
      // Simulate a rehydrated cache for crew-1's data.
      useCrewStore.setState({
        crewMembers: mockMembers,
        meetingPoints: mockMeetingPoints,
        polls: makePolls(2),
        expenses: makeExpenses(2),
        expenseBalances: mockBalances,
        activity: makeActivity(2),
        _cachedCrewId: 'crew-1',
        _cachedAt: 1000,
      });

      // Make the fetch hang so we can observe the synchronous pre-fetch clear.
      let resolveGet: (v: Crew & { members: CrewMember[] }) => void = () => {};
      (api.get as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((res) => {
          resolveGet = res;
        }),
      );

      const promise = useCrewStore.getState().selectCrew('crew-2');

      // Different crew → stale sub-data is wiped immediately, no cross-leak.
      const mid = useCrewStore.getState();
      expect(mid.crewMembers).toEqual([]);
      expect(mid.meetingPoints).toEqual([]);
      expect(mid.polls).toEqual([]);
      expect(mid.expenses).toEqual([]);
      expect(mid.expenseBalances).toEqual([]);
      expect(mid.activity).toEqual([]);

      resolveGet({ ...mockCrew, id: 'crew-2', members: mockMembers });
      await promise;

      const after = useCrewStore.getState();
      expect(after._cachedCrewId).toBe('crew-2');
      expect(typeof after._cachedAt).toBe('number');
    });

    it('keeps cached sub-data when re-opening the SAME crew (offline render)', async () => {
      useCrewStore.setState({
        meetingPoints: mockMeetingPoints,
        polls: makePolls(2),
        _cachedCrewId: 'crew-1',
        _cachedAt: 1000,
      });

      let resolveGet: (v: Crew & { members: CrewMember[] }) => void = () => {};
      (api.get as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((res) => {
          resolveGet = res;
        }),
      );

      const promise = useCrewStore.getState().selectCrew('crew-1');

      // Same crew → sub-data preserved so it renders instantly while loading.
      const mid = useCrewStore.getState();
      expect(mid.meetingPoints).toEqual(mockMeetingPoints);
      expect(mid.polls.length).toBe(2);

      resolveGet({ ...mockCrew, members: mockMembers });
      await promise;
    });

    it('sets _cachedAt and _cachedCrewId on successful selectCrew', async () => {
      (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockCrew,
        members: mockMembers,
      });

      const before = Date.now();
      await useCrewStore.getState().selectCrew('crew-1');
      const state = useCrewStore.getState();

      expect(state._cachedCrewId).toBe('crew-1');
      expect(state._cachedAt).toBeGreaterThanOrEqual(before);
      expect(state.activeCrew?.id).toBe('crew-1');
    });
  });

  describe('_cachedAt exposure for offline indicator', () => {
    it('is readable on state and persisted for a "synced N ago" UI', () => {
      useCrewStore.setState({ _cachedAt: 42, _cachedCrewId: 'crew-1' });
      expect(useCrewStore.getState()._cachedAt).toBe(42);
      const state = readPersistedState();
      expect(state._cachedAt).toBe(42);
    });
  });
});
