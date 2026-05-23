import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useAuthStore } from './authStore';
import { api } from '../services/api';
import type { Festival, Profile, FestivalSet, Stage, FestivalDay } from '../types/domain';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockFestival: Festival = {
  id: 'fest-1',
  name: 'Test Festival',
  startDate: '2026-06-01',
  endDate: '2026-06-03',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockProfile: Profile = {
  id: 'prof-1',
  userId: 'user-1',
  festivalId: 'fest-1',
  picks: { 'set-1': 'must' },
  notes: { 'set-1': 'great show' },
  updatedAt: '2026-01-01T00:00:00Z',
};

function resetStores() {
  useFestivalDataStore.setState({
    festivals: [],
    currentFestivalId: null,
    currentFestival: null,
    currentProfile: null,
    allProfiles: [],
    sets: [],
    stages: [],
    days: [],
    isLoading: false,
    error: null,
  });
  useFestivalUIStore.setState({
    selectedDay: 0,
    activeStages: [],
    searchQuery: '',
  });
}

describe('festivalDataStore', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    // Default: no auth user
    useAuthStore.setState({ user: null, userToken: null });
  });

  describe('initial state', () => {
    it('starts with empty festivals', () => {
      expect(useFestivalDataStore.getState().festivals).toEqual([]);
    });

    it('starts with null currentFestivalId', () => {
      expect(useFestivalDataStore.getState().currentFestivalId).toBeNull();
    });

    it('starts with null currentFestival', () => {
      expect(useFestivalDataStore.getState().currentFestival).toBeNull();
    });

    it('starts with null currentProfile', () => {
      expect(useFestivalDataStore.getState().currentProfile).toBeNull();
    });

    it('starts not loading', () => {
      expect(useFestivalDataStore.getState().isLoading).toBe(false);
    });
  });

  describe('loadFestivals', () => {
    it('loads festivals on success', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([mockFestival]);
      await useFestivalDataStore.getState().loadFestivals();
      expect(useFestivalDataStore.getState().festivals).toEqual([mockFestival]);
      expect(useFestivalDataStore.getState().isLoading).toBe(false);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network'));
      await expect(useFestivalDataStore.getState().loadFestivals()).rejects.toThrow();
      expect(useFestivalDataStore.getState().error).toBe('Network');
      expect(useFestivalDataStore.getState().isLoading).toBe(false);
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useFestivalDataStore.getState().loadFestivals()).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to load festivals');
    });
  });

  describe('selectFestival', () => {
    it('sets currentFestivalId immediately', async () => {
      const detailResponse = {
        ...mockFestival,
        stages: [{ id: 's1', name: 'Main', festivalId: 'fest-1', createdAt: '', updatedAt: '' }],
        days: [
          {
            id: 'd1', festivalId: 'fest-1', date: '2026-06-01', label: 'Day 1',
            createdAt: '', updatedAt: '',
            sets: [
              {
                id: 'set-1', festivalId: 'fest-1', stageId: 's1',
                startTime: '14:00', endTime: '15:00',
                createdAt: '', updatedAt: '',
              },
            ],
          },
        ],
      };
      vi.mocked(api.get).mockResolvedValueOnce(detailResponse);

      await useFestivalDataStore.getState().selectFestival('fest-1');

      const state = useFestivalDataStore.getState();
      expect(state.currentFestivalId).toBe('fest-1');
      expect(state.currentFestival).toBeTruthy();
      expect(state.stages).toHaveLength(1);
      expect(state.sets).toHaveLength(1);
      expect(state.days).toHaveLength(1);
      // Sets should have dayIndex and date merged from the parent day
      expect(state.sets[0]!.dayIndex).toBe(0);
      expect(state.sets[0]!.date).toBe('2026-06-01');
    });

    it('initializes activeStages in the UI store', async () => {
      const detailResponse = {
        ...mockFestival,
        stages: [
          { id: 's1', name: 'Main', festivalId: 'fest-1', createdAt: '', updatedAt: '' },
          { id: 's2', name: 'Side', festivalId: 'fest-1', createdAt: '', updatedAt: '' },
        ],
        days: [],
      };
      vi.mocked(api.get).mockResolvedValueOnce(detailResponse);

      await useFestivalDataStore.getState().selectFestival('fest-1');
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s1', 's2']);
      expect(useFestivalUIStore.getState().selectedDay).toBe(0);
    });

    it('loads profiles when user is authenticated', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      const detailResponse = { ...mockFestival, stages: [], days: [] };
      vi.mocked(api.get)
        .mockResolvedValueOnce(detailResponse) // festival detail
        .mockResolvedValueOnce([mockProfile]); // profiles

      await useFestivalDataStore.getState().selectFestival('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual([mockProfile]);
      expect(useFestivalDataStore.getState().currentProfile).toEqual(mockProfile);
    });

    it('skips profiles when no authenticated user', async () => {
      const detailResponse = { ...mockFestival, stages: [], days: [] };
      vi.mocked(api.get).mockResolvedValueOnce(detailResponse);

      await useFestivalDataStore.getState().selectFestival('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual([]);
      expect(useFestivalDataStore.getState().currentProfile).toBeNull();
    });

    it('sets error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('404'));
      await expect(
        useFestivalDataStore.getState().selectFestival('bad'),
      ).rejects.toThrow();
      expect(useFestivalDataStore.getState().error).toBe('404');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(
        useFestivalDataStore.getState().selectFestival('bad'),
      ).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to load festival');
    });

    it('continues when profile load fails for authenticated user', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      const detailResponse = {
        ...mockFestival,
        stages: [{ id: 's1', name: 'Main', festivalId: 'fest-1', createdAt: '', updatedAt: '' }],
        days: [],
      };
      vi.mocked(api.get)
        .mockResolvedValueOnce(detailResponse) // festival detail
        .mockRejectedValueOnce(new Error('401 Unauthorized')); // profiles fail

      await useFestivalDataStore.getState().selectFestival('fest-1');
      const state = useFestivalDataStore.getState();
      expect(state.currentFestival).toBeTruthy();
      expect(state.allProfiles).toEqual([]);
      expect(state.currentProfile).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe('loadProfiles', () => {
    it('loads profiles and sets currentProfile matching user', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      vi.mocked(api.get).mockResolvedValueOnce([mockProfile]);
      await useFestivalDataStore.getState().loadProfiles('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual([mockProfile]);
      expect(useFestivalDataStore.getState().currentProfile).toEqual(mockProfile);
    });

    it('sets currentProfile to null when no matching profile', async () => {
      useAuthStore.setState({
        user: { id: 'user-999', username: 'nobody', createdAt: '', updatedAt: '' },
      });
      vi.mocked(api.get).mockResolvedValueOnce([mockProfile]);
      await useFestivalDataStore.getState().loadProfiles('fest-1');
      expect(useFestivalDataStore.getState().currentProfile).toBeNull();
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Server error'));
      await expect(
        useFestivalDataStore.getState().loadProfiles('fest-1'),
      ).rejects.toThrow('Server error');
      expect(useFestivalDataStore.getState().error).toBe('Server error');
      expect(useFestivalDataStore.getState().isLoading).toBe(false);
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(
        useFestivalDataStore.getState().loadProfiles('fest-1'),
      ).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to load profiles');
    });

    it('sets currentProfile to null when no user is logged in', async () => {
      useAuthStore.setState({ user: null });
      vi.mocked(api.get).mockResolvedValueOnce([mockProfile]);
      await useFestivalDataStore.getState().loadProfiles('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual([mockProfile]);
      expect(useFestivalDataStore.getState().currentProfile).toBeNull();
    });
  });

  describe('setCurrentProfile', () => {
    it('sets the current profile', () => {
      useFestivalDataStore.getState().setCurrentProfile(mockProfile);
      expect(useFestivalDataStore.getState().currentProfile).toEqual(mockProfile);
    });
  });

  describe('savePick', () => {
    it('optimistically updates the profile picks', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      // Mock the offlinePut (which calls api.put)
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useFestivalDataStore.getState().savePick({
        festivalId: 'fest-1',
        setId: 'set-2',
        priority: 'maybe',
      });
      const profile = useFestivalDataStore.getState().currentProfile!;
      expect(profile.picks['set-2']).toBe('maybe');
      expect(profile.picks['set-1']).toBe('must'); // existing pick preserved
    });

    it('throws when no current profile', async () => {
      useFestivalDataStore.setState({ currentProfile: null });
      await expect(
        useFestivalDataStore.getState().savePick({
          festivalId: 'fest-1',
          setId: 'set-1',
          priority: 'must',
        }),
      ).rejects.toThrow('No active profile');
    });

    it('removes pick when priority is null', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useFestivalDataStore.getState().savePick({
        festivalId: 'fest-1',
        setId: 'set-1',
        priority: null,
      });
      const profile = useFestivalDataStore.getState().currentProfile!;
      expect(profile.picks['set-1']).toBeUndefined();
    });

    it('sets error on API failure', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Server error'));
      await expect(
        useFestivalDataStore.getState().savePick({
          festivalId: 'fest-1',
          setId: 'set-2',
          priority: 'must',
        }),
      ).rejects.toThrow('Server error');
      expect(useFestivalDataStore.getState().error).toBe('Server error');
    });

    it('handles non-Error thrown values', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(
        useFestivalDataStore.getState().savePick({
          festivalId: 'fest-1',
          setId: 'set-2',
          priority: 'must',
        }),
      ).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to save pick');
    });
  });

  describe('removePick', () => {
    it('removes the pick from profile', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useFestivalDataStore.getState().removePick('fest-1', 'set-1');
      const profile = useFestivalDataStore.getState().currentProfile!;
      expect(profile.picks['set-1']).toBeUndefined();
    });

    it('throws when no current profile', async () => {
      useFestivalDataStore.setState({ currentProfile: null });
      await expect(
        useFestivalDataStore.getState().removePick('fest-1', 'set-1'),
      ).rejects.toThrow('No active profile');
    });

    it('sets error on API failure', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Server error'));
      await expect(
        useFestivalDataStore.getState().removePick('fest-1', 'set-1'),
      ).rejects.toThrow('Server error');
      expect(useFestivalDataStore.getState().error).toBe('Server error');
    });

    it('handles non-Error thrown values', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(
        useFestivalDataStore.getState().removePick('fest-1', 'set-1'),
      ).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to remove pick');
    });
  });

  describe('saveNote', () => {
    it('optimistically updates the profile notes', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useFestivalDataStore.getState().saveNote({
        festivalId: 'fest-1',
        setId: 'set-2',
        note: 'bring earplugs',
      });
      const profile = useFestivalDataStore.getState().currentProfile!;
      expect(profile.notes['set-2']).toBe('bring earplugs');
    });

    it('throws when no current profile', async () => {
      useFestivalDataStore.setState({ currentProfile: null });
      await expect(
        useFestivalDataStore.getState().saveNote({
          festivalId: 'fest-1',
          setId: 'set-1',
          note: 'test',
        }),
      ).rejects.toThrow('No active profile');
    });

    it('sets error on API failure', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Server error'));
      await expect(
        useFestivalDataStore.getState().saveNote({
          festivalId: 'fest-1',
          setId: 'set-2',
          note: 'test',
        }),
      ).rejects.toThrow('Server error');
      expect(useFestivalDataStore.getState().error).toBe('Server error');
    });

    it('handles non-Error thrown values', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(
        useFestivalDataStore.getState().saveNote({
          festivalId: 'fest-1',
          setId: 'set-2',
          note: 'test',
        }),
      ).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to save note');
    });
  });

  describe('offline queue integration', () => {
    it('queues mutation via bridge when offline', async () => {
      const queueMutation = vi.fn().mockResolvedValue(undefined);
      (window as any).__festieQueue = { queueMutation };
      Object.defineProperty(navigator, 'onLine', { writable: true, value: false });

      useFestivalDataStore.setState({ currentProfile: mockProfile });
      await useFestivalDataStore.getState().savePick({
        festivalId: 'fest-1',
        setId: 'set-2',
        priority: 'maybe',
      });

      expect(queueMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'api',
          method: 'PUT',
          url: `/profiles/${mockProfile.id}`,
        }),
      );
      // Optimistic update should still have taken effect
      expect(useFestivalDataStore.getState().currentProfile!.picks['set-2']).toBe('maybe');

      // Cleanup
      delete (window as any).__festieQueue;
      Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
    });

    it('falls back to api.put when offline but no bridge', async () => {
      Object.defineProperty(navigator, 'onLine', { writable: true, value: false });

      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);
      await useFestivalDataStore.getState().savePick({
        festivalId: 'fest-1',
        setId: 'set-2',
        priority: 'want-to-see',
      });

      expect(api.put).toHaveBeenCalled();
      expect(useFestivalDataStore.getState().currentProfile!.picks['set-2']).toBe('want-to-see');

      // Cleanup
      Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
    });
  });

  describe('setError', () => {
    it('sets error', () => {
      useFestivalDataStore.getState().setError('bad');
      expect(useFestivalDataStore.getState().error).toBe('bad');
    });

    it('clears error', () => {
      useFestivalDataStore.getState().setError('bad');
      useFestivalDataStore.getState().setError(null);
      expect(useFestivalDataStore.getState().error).toBeNull();
    });
  });
});
