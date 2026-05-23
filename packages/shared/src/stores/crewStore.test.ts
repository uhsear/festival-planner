import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCrewStore } from './crewStore';
import { api } from '../services/api';
import type { Crew, CrewMember } from '../types/domain';

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
  { id: 'cm-1', userId: 'user-1', name: 'Alice', role: 'owner' },
  { id: 'cm-2', userId: 'user-2', name: 'Bob', role: 'member' },
];

function resetStore() {
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    crewOverlap: {},
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
      vi.mocked(api.post).mockResolvedValueOnce(mockCrew);
      const result = await useCrewStore.getState().createCrew({ name: 'Test Crew' });
      expect(result).toEqual(mockCrew);
      expect(useCrewStore.getState().crews).toHaveLength(1);
      expect(useCrewStore.getState().activeCrew).toEqual(mockCrew);
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
      await useCrewStore.getState().kickMember('crew-1', 'cm-2');
      expect(useCrewStore.getState().crewMembers).toHaveLength(1);
      expect(useCrewStore.getState().crewMembers[0]!.id).toBe('cm-1');
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
      await useCrewStore.getState().transferOwnership('crew-1', 'cm-2');
      const members = useCrewStore.getState().crewMembers;
      expect(members.find((m) => m.id === 'cm-2')!.role).toBe('owner');
      expect(members.find((m) => m.id === 'cm-1')!.role).toBe('member');
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
});
