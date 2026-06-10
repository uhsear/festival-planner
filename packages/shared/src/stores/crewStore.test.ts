import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCrewStore } from './crewStore';
import { api } from '../services/api';
import type { Crew, CrewMember, CrewPoll, PollSetRef } from '../types/domain';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

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
  { userId: 'user-1', name: 'Alice', role: 'owner' },
  { userId: 'user-2', name: 'Bob', role: 'member' },
];

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
  });
}

describe('crewStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty crews', () => {
      expect(useCrewStore.getState().crews).toEqual([]);
    });

    it('starts with null activeCrew', () => {
      expect(useCrewStore.getState().activeCrew).toBeNull();
    });

    it('starts with empty crewMembers', () => {
      expect(useCrewStore.getState().crewMembers).toEqual([]);
    });

    it('starts with empty crewOverlap', () => {
      expect(useCrewStore.getState().crewOverlap).toEqual({});
    });

    it('starts not loading', () => {
      expect(useCrewStore.getState().crewLoading).toBe(false);
    });

    it('starts with null error', () => {
      expect(useCrewStore.getState().error).toBeNull();
    });
  });

  describe('loadCrews', () => {
    it('sets crewLoading true then false on success', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([mockCrew]);
      await useCrewStore.getState().loadCrews();
      expect(useCrewStore.getState().crewLoading).toBe(false);
      expect(useCrewStore.getState().crews).toEqual([mockCrew]);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));
      await expect(useCrewStore.getState().loadCrews()).rejects.toThrow('Network error');
      expect(useCrewStore.getState().error).toBe('Network error');
      expect(useCrewStore.getState().crewLoading).toBe(false);
    });

    it('clears previous error on load', async () => {
      useCrewStore.setState({ error: 'old error' });
      vi.mocked(api.get).mockResolvedValueOnce([]);
      await useCrewStore.getState().loadCrews();
      expect(useCrewStore.getState().error).toBeNull();
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().loadCrews()).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to load crews');
    });
  });

  describe('selectCrew', () => {
    it('clears previous crew data before fetching', async () => {
      useCrewStore.setState({
        activeCrew: mockCrew,
        crewMembers: mockMembers,
      });
      vi.mocked(api.get).mockResolvedValueOnce({ ...mockCrew, members: mockMembers });
      const promise = useCrewStore.getState().selectCrew('crew-1');
      // During the fetch, activeCrew should be null
      expect(useCrewStore.getState().activeCrew).toBeNull();
      expect(useCrewStore.getState().crewMembers).toEqual([]);
      await promise;
    });

    it('sets activeCrew and members on success', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ ...mockCrew, members: mockMembers });
      await useCrewStore.getState().selectCrew('crew-1');
      expect(useCrewStore.getState().activeCrew).toEqual({ ...mockCrew, members: mockMembers });
      expect(useCrewStore.getState().crewMembers).toEqual(mockMembers);
      expect(useCrewStore.getState().crewLoading).toBe(false);
    });

    it('handles missing members gracefully', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ ...mockCrew });
      await useCrewStore.getState().selectCrew('crew-1');
      expect(useCrewStore.getState().crewMembers).toEqual([]);
    });

    it('sets error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'));
      await expect(useCrewStore.getState().selectCrew('crew-1')).rejects.toThrow();
      expect(useCrewStore.getState().error).toBe('Not found');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().selectCrew('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to load crew');
    });
  });

  describe('createCrew', () => {
    it('adds crew to list and sets as active', async () => {
      const crewWithMembers = {
        ...mockCrew,
        members: [{ id: 'cm-1', userId: 'user-1', name: 'Alice', role: 'owner' as const }],
      };
      vi.mocked(api.post).mockResolvedValueOnce(crewWithMembers);
      const result = await useCrewStore.getState().createCrew({ name: 'Test Crew' });
      expect(result).toEqual(crewWithMembers);
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(crewWithMembers);
      expect(useCrewStore.getState().crewMembers[0]!.role).toBe('owner');
    });

    it('throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Create failed'));
      await expect(useCrewStore.getState().createCrew({ name: 'Fail' })).rejects.toThrow();
      expect(useCrewStore.getState().error).toBe('Create failed');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().createCrew({ name: 'Fail' })).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to create crew');
    });
  });

  describe('joinByCode', () => {
    it('adds crew to list on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(mockCrew);
      await useCrewStore.getState().joinByCode({ inviteCode: 'ABC123' });
      expect(useCrewStore.getState().crews).toHaveLength(1);
    });

    it('throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Invalid code'));
      await expect(useCrewStore.getState().joinByCode({ inviteCode: 'BAD' })).rejects.toThrow();
      expect(useCrewStore.getState().error).toBe('Invalid code');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().joinByCode({ inviteCode: 'BAD' })).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to join crew');
    });
  });

  describe('leaveCrew', () => {
    it('removes crew from list and clears activeCrew if matching', async () => {
      useCrewStore.setState({
        crews: [mockCrew],
        activeCrew: mockCrew,
        crewMembers: mockMembers,
      });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().leaveCrew('crew-1');
      expect(useCrewStore.getState().crews).toHaveLength(0);
      expect(useCrewStore.getState().activeCrew).toBeNull();
      expect(useCrewStore.getState().crewMembers).toEqual([]);
    });

    it('keeps activeCrew if leaving a different crew', async () => {
      const otherCrew = { ...mockCrew, id: 'crew-2', name: 'Other' };
      useCrewStore.setState({
        crews: [mockCrew, otherCrew],
        activeCrew: mockCrew,
        crewMembers: mockMembers,
      });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().leaveCrew('crew-2');
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Cannot leave'));
      await expect(useCrewStore.getState().leaveCrew('crew-1')).rejects.toThrow('Cannot leave');
      expect(useCrewStore.getState().error).toBe('Cannot leave');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().leaveCrew('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to leave crew');
    });
  });

  describe('kickMember', () => {
    it('removes member from crewMembers list', async () => {
      useCrewStore.setState({ crewMembers: mockMembers });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().kickMember('crew-1', 'user-2');
      expect(useCrewStore.getState().crewMembers).toHaveLength(1);
      expect(useCrewStore.getState().crewMembers[0]!.userId).toBe('user-1');
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Not allowed'));
      await expect(useCrewStore.getState().kickMember('crew-1', 'cm-2')).rejects.toThrow('Not allowed');
      expect(useCrewStore.getState().error).toBe('Not allowed');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().kickMember('crew-1', 'cm-2')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to kick member');
    });
  });

  describe('transferOwnership', () => {
    it('updates roles after transfer', async () => {
      useCrewStore.setState({ crewMembers: mockMembers });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().transferOwnership('crew-1', 'user-2');
      const members = useCrewStore.getState().crewMembers;
      expect(members.find((m) => m.userId === 'user-2')!.role).toBe('owner');
      expect(members.find((m) => m.userId === 'user-1')!.role).toBe('member');
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Transfer denied'));
      await expect(useCrewStore.getState().transferOwnership('crew-1', 'cm-2')).rejects.toThrow('Transfer denied');
      expect(useCrewStore.getState().error).toBe('Transfer denied');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().transferOwnership('crew-1', 'cm-2')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to transfer ownership');
    });
  });

  describe('regenerateInvite', () => {
    it('updates activeCrew inviteCode', async () => {
      useCrewStore.setState({ activeCrew: mockCrew });
      vi.mocked(api.post).mockResolvedValueOnce({ inviteCode: 'NEW456' });
      const code = await useCrewStore.getState().regenerateInvite('crew-1');
      expect(code).toBe('NEW456');
      expect(useCrewStore.getState().activeCrew!.inviteCode).toBe('NEW456');
    });

    it('leaves activeCrew null if no active crew', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ inviteCode: 'NEW456' });
      await useCrewStore.getState().regenerateInvite('crew-1');
      expect(useCrewStore.getState().activeCrew).toBeNull();
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Forbidden'));
      await expect(useCrewStore.getState().regenerateInvite('crew-1')).rejects.toThrow('Forbidden');
      expect(useCrewStore.getState().error).toBe('Forbidden');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().regenerateInvite('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to regenerate invite');
    });
  });

  describe('deleteCrew', () => {
    it('removes crew from list and clears activeCrew if matching', async () => {
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().deleteCrew('crew-1');
      expect(useCrewStore.getState().crews).toHaveLength(0);
      expect(useCrewStore.getState().activeCrew).toBeNull();
    });

    it('keeps activeCrew when deleting a different crew', async () => {
      const otherCrew = { ...mockCrew, id: 'crew-2', name: 'Other' };
      useCrewStore.setState({ crews: [mockCrew, otherCrew], activeCrew: mockCrew });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useCrewStore.getState().deleteCrew('crew-2');
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Cannot delete'));
      await expect(useCrewStore.getState().deleteCrew('crew-1')).rejects.toThrow('Cannot delete');
      expect(useCrewStore.getState().error).toBe('Cannot delete');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().deleteCrew('crew-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to delete crew');
    });
  });

  describe('loadOverlap', () => {
    it('sets crewOverlap on success', async () => {
      const overlap = { 'set-1': { setId: 'set-1', memberCount: 2, members: [] } };
      vi.mocked(api.get).mockResolvedValueOnce(overlap);
      await useCrewStore.getState().loadOverlap('crew-1', 'fest-1');
      expect(useCrewStore.getState().crewOverlap).toEqual(overlap);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Not found'));
      await expect(useCrewStore.getState().loadOverlap('crew-1', 'fest-1')).rejects.toThrow('Not found');
      expect(useCrewStore.getState().error).toBe('Not found');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().loadOverlap('crew-1', 'fest-1')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to load overlap');
    });
  });

  describe('forceAddMember', () => {
    it('updates activeCrew and crews list on success', async () => {
      const updatedCrew = { ...mockCrew, members: mockMembers };
      useCrewStore.setState({ crews: [mockCrew], activeCrew: mockCrew });
      vi.mocked(api.post).mockResolvedValueOnce(updatedCrew);
      await useCrewStore.getState().forceAddMember('crew-1', 'user-2');
      expect(useCrewStore.getState().activeCrew).toEqual(updatedCrew);
      expect(useCrewStore.getState().crewMembers).toEqual(mockMembers);
    });

    it('does not update activeCrew when it does not match crewId', async () => {
      const otherCrew = { ...mockCrew, id: 'crew-other' };
      const updatedCrew = { ...mockCrew, members: mockMembers };
      useCrewStore.setState({ crews: [mockCrew], activeCrew: otherCrew });
      vi.mocked(api.post).mockResolvedValueOnce(updatedCrew);
      await useCrewStore.getState().forceAddMember('crew-1', 'user-2');
      expect(useCrewStore.getState().activeCrew).toEqual(otherCrew);
    });

    it('updates crews list when crewId matches an entry', async () => {
      const crew2 = { ...mockCrew, id: 'crew-2', name: 'Crew 2' };
      const updatedCrew = { ...mockCrew, members: mockMembers };
      useCrewStore.setState({ crews: [mockCrew, crew2], activeCrew: mockCrew });
      vi.mocked(api.post).mockResolvedValueOnce(updatedCrew);
      await useCrewStore.getState().forceAddMember('crew-1', 'user-2');
      const crews = useCrewStore.getState().crews;
      expect(crews).toHaveLength(2);
      expect(crews[0]).toEqual(updatedCrew);
      expect(crews[1]).toEqual(crew2);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Already a member'));
      await expect(useCrewStore.getState().forceAddMember('crew-1', 'user-2')).rejects.toThrow('Already a member');
      expect(useCrewStore.getState().error).toBe('Already a member');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useCrewStore.getState().forceAddMember('crew-1', 'user-2')).rejects.toBe('string error');
      expect(useCrewStore.getState().error).toBe('Failed to add member');
    });
  });

  describe('setError', () => {
    it('sets error string', () => {
      useCrewStore.getState().setError('Something broke');
      expect(useCrewStore.getState().error).toBe('Something broke');
    });

    it('clears error with null', () => {
      useCrewStore.getState().setError('err');
      useCrewStore.getState().setError(null);
      expect(useCrewStore.getState().error).toBeNull();
    });
  });

  describe('loadExpenses', () => {
    it('loads expenses and balances together', async () => {
      const expenses = [
        {
          id: 'e1',
          crew_id: 'crew-1',
          paid_by: 'user-1',
          paid_by_name: 'Alice',
          description: 'Dinner',
          amount: '40.00',
          split_with: ['user-1', 'user-2'],
          category: 'food',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      const balances = [{ userId: 'user-1', username: 'Alice', balance: 20 }];
      // The settlement-plan endpoint returns BOTH balances and the netted plan.
      const settlements = [
        {
          fromUserId: 'user-2',
          fromName: 'Bob',
          toUserId: 'user-1',
          toName: 'Alice',
          amountCents: 2000,
          amount: 20,
          payeeHandles: { venmo: null, cashapp: null, paypal: null },
        },
      ];
      vi.mocked(api.get).mockResolvedValueOnce(expenses).mockResolvedValueOnce({ balances, settlements });
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenses).toEqual(expenses);
      expect(useCrewStore.getState().expenseBalances).toEqual(balances);
      expect(useCrewStore.getState().settlements).toEqual(settlements);
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/expenses');
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/expenses/settlement-plan');
    });

    it('defaults balances and settlements to empty when the plan is empty', async () => {
      vi.mocked(api.get)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ balances: [{ userId: 'u', username: 'U', balance: 5 }], settlements: [] });
      await useCrewStore.getState().loadExpenses('crew-1');
      expect(useCrewStore.getState().expenseBalances).toHaveLength(1);
      expect(useCrewStore.getState().settlements).toHaveLength(0);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'));
      await expect(useCrewStore.getState().loadExpenses('crew-1')).rejects.toThrow('boom');
      expect(useCrewStore.getState().error).toBe('boom');
    });
  });

  describe('addExpense', () => {
    it('posts then refetches expenses + balances', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});
      vi.mocked(api.get)
        .mockResolvedValueOnce([{ id: 'e1' }])
        .mockResolvedValueOnce([]);
      await useCrewStore.getState().addExpense('crew-1', {
        description: 'Beer',
        amount: 12,
        splitWith: ['user-1'],
        category: 'drinks',
      });
      // Phase-2 offline optimism passes an onOptimisticCreate option (only
      // invoked on the offline-queue path); the body is unchanged.
      expect(api.post).toHaveBeenCalledWith(
        '/crews/crew-1/expenses',
        { description: 'Beer', amount: 12, splitWith: ['user-1'], category: 'drinks' },
        expect.objectContaining({ onOptimisticCreate: expect.any(Function) }),
      );
      expect(useCrewStore.getState().expenses).toEqual([{ id: 'e1' }]);
    });
  });

  describe('removeExpense', () => {
    it('deletes then refetches', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({});
      vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await useCrewStore.getState().removeExpense('crew-1', 'e1');
      expect(api.delete).toHaveBeenCalledWith('/crews/crew-1/expenses/e1');
    });
  });

  describe('settleExpense', () => {
    it('posts settle then refetches', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({});
      vi.mocked(api.get).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await useCrewStore.getState().settleExpense('crew-1', { toUserId: 'user-2', amount: 10 });
      expect(api.post).toHaveBeenCalledWith('/crews/crew-1/expenses/settle', {
        toUserId: 'user-2',
        amount: 10,
      });
    });
  });

  describe('closePoll — schedule-aware (M2)', () => {
    const setRef: PollSetRef = {
      setId: 'set-9pm',
      label: 'Fisher',
      stageReference: 'Main Stage',
      meetAt: '2026-07-01T21:00:00Z',
    };

    function makeSchedulePoll(overrides: Partial<CrewPoll> = {}): CrewPoll {
      return {
        id: 'poll-1',
        crew_id: 'crew-1',
        created_by: 'user-1',
        question: 'Which set at 9pm?',
        options: ['Fisher', 'Chris Lake'],
        votes: [
          { option: 0, user_id: 'user-1' },
          { option: 0, user_id: 'user-2' },
          { option: 1, user_id: 'user-3' },
        ],
        closes_at: null,
        closed: false,
        created_at: '2026-01-01T00:00:00Z',
        _setRefs: [
          setRef,
          { setId: 'set-cl', label: 'Chris Lake', stageReference: 'Stage 2', meetAt: '2026-07-01T21:00:00Z' },
        ],
        ...overrides,
      };
    }

    it('creates a meeting point at the winning set and seeds a reminder on close', async () => {
      useCrewStore.setState({ polls: [makeSchedulePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      // createMeetingPoint posts and returns the server { meetingPoint } envelope.
      vi.mocked(api.post).mockResolvedValueOnce({
        meetingPoint: {
          id: 'mp-1',
          crew_id: 'crew-1',
          created_by: 'user-1',
          label: 'Fisher',
          location: 'Main Stage',
          type: 'set',
          meet_at: setRef.meetAt,
          stage_reference: 'Main Stage',
          active: true,
          created_at: '2026-01-01T00:00:00Z',
        },
      });
      const seedReminder = vi.fn().mockResolvedValue(undefined);

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', {
        festivalId: 'fest-1',
        seedReminder,
      });

      // Poll dropped from local state.
      expect(useCrewStore.getState().polls).toHaveLength(0);
      // Meeting point created for the WINNING option (Fisher, 2 votes).
      expect(api.post).toHaveBeenCalledWith(
        '/crews/crew-1/meeting-points',
        expect.objectContaining({
          label: 'Fisher',
          stageReference: 'Main Stage',
          meetAt: setRef.meetAt,
          type: 'set',
        }),
        expect.objectContaining({ onOptimisticCreate: expect.any(Function) }),
      );
      expect(useCrewStore.getState().meetingPoints[0]!.label).toBe('Fisher');
      // Reminder seeded for the winning set in the active festival.
      expect(seedReminder).toHaveBeenCalledWith('set-9pm', 'fest-1');
    });

    it('does not create a meeting point or reminder for a plain (non-schedule) poll', async () => {
      useCrewStore.setState({
        polls: [makeSchedulePoll({ _setRefs: undefined })],
        meetingPoints: [],
      });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      const seedReminder = vi.fn();

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder });

      expect(api.post).not.toHaveBeenCalled();
      expect(seedReminder).not.toHaveBeenCalled();
      expect(useCrewStore.getState().meetingPoints).toHaveLength(0);
    });

    it('skips side effects when the winning option has no linked set (free-text)', async () => {
      useCrewStore.setState({
        polls: [makeSchedulePoll({ _setRefs: [null, null] })],
        meetingPoints: [],
      });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      const seedReminder = vi.fn();

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder });

      expect(api.post).not.toHaveBeenCalled();
      expect(seedReminder).not.toHaveBeenCalled();
    });

    it('still closes (drops the poll) when the meeting-point create fails', async () => {
      useCrewStore.setState({ polls: [makeSchedulePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      vi.mocked(api.post).mockRejectedValueOnce(new Error('mp failed'));
      const seedReminder = vi.fn().mockResolvedValue(undefined);

      await expect(
        useCrewStore.getState().closePoll('crew-1', 'poll-1', { festivalId: 'fest-1', seedReminder }),
      ).resolves.toBeUndefined();
      expect(useCrewStore.getState().polls).toHaveLength(0);
    });

    it('seeds no reminder without a festivalId, but still creates the meeting point', async () => {
      useCrewStore.setState({ polls: [makeSchedulePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      vi.mocked(api.post).mockResolvedValueOnce({
        meetingPoint: {
          id: 'mp-1',
          crew_id: 'crew-1',
          created_by: 'user-1',
          label: 'Fisher',
          location: 'Main Stage',
          type: 'set',
          meet_at: setRef.meetAt,
          stage_reference: 'Main Stage',
          active: true,
          created_at: '2026-01-01T00:00:00Z',
        },
      });
      const seedReminder = vi.fn();

      await useCrewStore.getState().closePoll('crew-1', 'poll-1', { seedReminder });

      expect(api.post).toHaveBeenCalledTimes(1);
      expect(seedReminder).not.toHaveBeenCalled();
    });

    it('legacy close (no opts) drops the poll without side effects', async () => {
      useCrewStore.setState({ polls: [makeSchedulePoll()], meetingPoints: [] });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);

      await useCrewStore.getState().closePoll('crew-1', 'poll-1');

      // No opts.seedReminder, but the poll IS schedule-aware, so the meeting
      // point is still created from the carried linkage; only the reminder is
      // skipped (no seeder/festivalId).
      expect(useCrewStore.getState().polls).toHaveLength(0);
    });
  });

  describe('createPoll — schedule-aware linkage (M2)', () => {
    it('attaches _setRefs to the created poll but keeps them out of the POST body', async () => {
      const setRefs: (PollSetRef | null)[] = [
        { setId: 's1', label: 'A', stageReference: 'Stage 1', meetAt: null },
        null,
      ];
      vi.mocked(api.post).mockResolvedValueOnce({
        poll: {
          id: 'srv-poll',
          crew_id: 'crew-1',
          created_by: 'user-1',
          question: 'Q',
          options: ['A', 'B'],
          votes: [],
          closes_at: null,
          closed: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      });

      const poll = await useCrewStore.getState().createPoll('crew-1', { question: 'Q', options: ['A', 'B'] }, setRefs);

      expect(poll._setRefs).toEqual(setRefs);
      // The POST body must NOT include _setRefs (client-only, no migration).
      const body = vi.mocked(api.post).mock.calls[0]![1] as Record<string, unknown>;
      expect(body).toEqual({ question: 'Q', options: ['A', 'B'] });
      expect(useCrewStore.getState().polls[0]!._setRefs).toEqual(setRefs);
    });

    it('omits _setRefs when no option links to a set', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        poll: {
          id: 'srv-poll',
          crew_id: 'crew-1',
          created_by: 'user-1',
          question: 'Q',
          options: ['A', 'B'],
          votes: [],
          closes_at: null,
          closed: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      });
      const poll = await useCrewStore
        .getState()
        .createPoll('crew-1', { question: 'Q', options: ['A', 'B'] }, [null, null]);
      expect(poll._setRefs).toBeUndefined();
    });
  });

  describe('loadActivity', () => {
    it('reads the { items } pagination envelope', async () => {
      const items = [
        {
          id: 'a1',
          crew_id: 'crew-1',
          user_id: 'user-1',
          username: 'Alice',
          type: 'expense-added',
          detail: 'Dinner $40',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      vi.mocked(api.get).mockResolvedValueOnce({ items, nextCursor: null });
      await useCrewStore.getState().loadActivity('crew-1');
      expect(useCrewStore.getState().activity).toEqual(items);
      expect(api.get).toHaveBeenCalledWith('/crews/crew-1/activity');
    });

    it('accepts a bare array too', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([{ id: 'a1' }]);
      await useCrewStore.getState().loadActivity('crew-1');
      expect(useCrewStore.getState().activity).toEqual([{ id: 'a1' }]);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('nope'));
      await expect(useCrewStore.getState().loadActivity('crew-1')).rejects.toThrow('nope');
      expect(useCrewStore.getState().error).toBe('nope');
    });
  });
});
