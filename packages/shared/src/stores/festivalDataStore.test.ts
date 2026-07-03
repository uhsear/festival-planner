import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useAuthStore } from './authStore';
import { useUIStore } from './uiStore';
import { api } from '../services/api';
import type { Festival, Profile } from '../types/domain';

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
    _festivalCachedAt: null,
    _profilesCachedAt: null,
    _cachedFestivalId: null,
  });
  useFestivalUIStore.setState({
    selectedDay: 0,
    activeStages: [],
    searchQuery: '',
  });
  useUIStore.setState({ pendingSync: 0 });
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
            id: 'd1',
            festivalId: 'fest-1',
            date: '2026-06-01',
            label: 'Day 1',
            createdAt: '',
            updatedAt: '',
            sets: [
              {
                id: 'set-1',
                festivalId: 'fest-1',
                stageId: 's1',
                startTime: '14:00',
                endTime: '15:00',
                createdAt: '',
                updatedAt: '',
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

    it('resets activeStages to [] (all-selected) in the UI store', async () => {
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
      // Empty = "all stages". Storing the full id array here made the schedule
      // UI read a phantom active stage filter on every load (it normalizes
      // all-selected → []); [] keeps a fresh load filter-free.
      expect(useFestivalUIStore.getState().activeStages).toEqual([]);
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

    it('survives a persist rehydration clobbering currentFestivalId mid-fetch (guest first selection)', async () => {
      // Regression: zustand persist rehydrates asynchronously. A guest's first
      // festival selection can race the hydration — the stale persisted blob
      // (currentFestivalId: null) lands AFTER selectFestival set the id but
      // BEFORE the fetch resolved. The selection must still complete and the
      // final state must be self-consistent (id + festival both set).
      const detailResponse = { ...mockFestival, stages: [], days: [] };
      let resolveFetch!: (v: unknown) => void;
      vi.mocked(api.get).mockReturnValueOnce(new Promise((r) => (resolveFetch = r)));

      const selection = useFestivalDataStore.getState().selectFestival('fest-1');
      // Simulate the late rehydration overwriting the in-flight id with the
      // stale persisted value (null — the guest never selected a festival).
      useFestivalDataStore.setState({ currentFestivalId: null });

      resolveFetch(detailResponse);
      await selection;

      const state = useFestivalDataStore.getState();
      expect(state.currentFestivalId).toBe('fest-1');
      expect(state.currentFestival).toBeTruthy();
      expect(state.isLoading).toBe(false);
    });

    it('drops a stale response when a newer selectFestival superseded it', async () => {
      const detailA = { ...mockFestival, id: 'fest-A', stages: [], days: [] };
      const detailB = { ...mockFestival, id: 'fest-B', stages: [], days: [] };
      let resolveA!: (v: unknown) => void;
      vi.mocked(api.get)
        .mockReturnValueOnce(new Promise((r) => (resolveA = r)))
        .mockResolvedValueOnce(detailB);

      const selectionA = useFestivalDataStore.getState().selectFestival('fest-A');
      const selectionB = useFestivalDataStore.getState().selectFestival('fest-B');
      await selectionB;
      // A's slow response lands after B completed — it must NOT overwrite B.
      resolveA(detailA);
      await selectionA;

      const state = useFestivalDataStore.getState();
      expect(state.currentFestivalId).toBe('fest-B');
      expect(state.currentFestival?.id).toBe('fest-B');
      expect(state.isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('404'));
      await expect(useFestivalDataStore.getState().selectFestival('bad')).rejects.toThrow();
      expect(useFestivalDataStore.getState().error).toBe('404');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useFestivalDataStore.getState().selectFestival('bad')).rejects.toBe('string error');
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

    it('preserves a persisted currentProfile when the profiles fetch fails offline', async () => {
      // Festival case: /festivals is SW-cached (succeeds offline) but /profiles is
      // not (throws). The persisted profile for THIS festival must survive so the
      // user can still see and make picks with no signal.
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      const persisted = {
        id: 'prof-1',
        userId: 'user-1',
        festivalId: 'fest-1',
        picks: { s1: 'must' },
        notes: {},
      } as unknown as import('../types').Profile;
      // _cachedFestivalId reflects the real store invariant: these cached
      // profiles were loaded for fest-1, so the staleness guard preserves them.
      useFestivalDataStore.setState({
        currentProfile: persisted,
        allProfiles: [persisted],
        _cachedFestivalId: 'fest-1',
      });

      const detailResponse = {
        ...mockFestival,
        stages: [{ id: 's1', name: 'Main', festivalId: 'fest-1', createdAt: '', updatedAt: '' }],
        days: [],
      };
      vi.mocked(api.get)
        .mockResolvedValueOnce(detailResponse) // /festivals/:id from SW cache
        .mockRejectedValueOnce(new Error('Network request failed')); // /profiles offline

      await useFestivalDataStore.getState().selectFestival('fest-1');
      const state = useFestivalDataStore.getState();
      expect(state.currentProfile).toEqual(persisted); // NOT clobbered to null
      expect(state.allProfiles).toEqual([persisted]); // preserved too
    });

    it('does NOT preserve a persisted profile from a DIFFERENT festival', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      const otherFestProfile = {
        id: 'prof-9',
        userId: 'user-1',
        festivalId: 'fest-OTHER',
        picks: {},
        notes: {},
      } as unknown as import('../types').Profile;
      useFestivalDataStore.setState({ currentProfile: otherFestProfile });

      const detailResponse = {
        ...mockFestival,
        stages: [{ id: 's1', name: 'Main', festivalId: 'fest-1', createdAt: '', updatedAt: '' }],
        days: [],
      };
      vi.mocked(api.get)
        .mockResolvedValueOnce(detailResponse)
        .mockRejectedValueOnce(new Error('Network request failed'));

      await useFestivalDataStore.getState().selectFestival('fest-1');
      // Wrong-festival profile must not leak in — picks would be meaningless.
      expect(useFestivalDataStore.getState().currentProfile).toBeNull();
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
      await expect(useFestivalDataStore.getState().loadProfiles('fest-1')).rejects.toThrow('Server error');
      expect(useFestivalDataStore.getState().error).toBe('Server error');
      expect(useFestivalDataStore.getState().isLoading).toBe(false);
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.get).mockRejectedValueOnce('string error');
      await expect(useFestivalDataStore.getState().loadProfiles('fest-1')).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to load profiles');
    });

    it('sets currentProfile to null when no user is logged in', async () => {
      useAuthStore.setState({ user: null });
      vi.mocked(api.get).mockResolvedValueOnce([mockProfile]);
      await useFestivalDataStore.getState().loadProfiles('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual([mockProfile]);
      expect(useFestivalDataStore.getState().currentProfile).toBeNull();
    });

    it('preserves optimistic picks when offline queue has pending writes (drain-race guard)', async () => {
      // Reproduce: user makes pick offline → optimistic state in store, PUT queued.
      // AppState foreground-return fires reloadProfiles BEFORE drain completes.
      // loadProfiles fetches stale server state (pre-drain) and overwrites picks → disappear.
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });

      // Local optimistic state: includes an offline pick, note, and reminder
      // ('set-offline') not yet on server — the full optimistic PUT payload.
      const optimisticProfile: Profile = {
        ...mockProfile,
        picks: { 'set-1': 'must', 'set-offline': 'want-to-see' },
        notes: { ...mockProfile.notes, 'set-offline': 'meet at rail' },
        reminders: { ...mockProfile.reminders, 'set-offline': 15 },
      };
      useFestivalDataStore.setState({ currentProfile: optimisticProfile });

      // Drain in progress: pendingSync > 0 means the PUT hasn't reached the server yet
      useUIStore.setState({ pendingSync: 1 });

      // Server returns the stale profile (pre-drain — 'set-offline' data not there yet)
      const staleServerProfile: Profile = { ...mockProfile, picks: { 'set-1': 'must' } };
      vi.mocked(api.get).mockResolvedValueOnce([staleServerProfile]);

      await useFestivalDataStore.getState().loadProfiles('fest-1');

      // The whole offline payload must survive — drain hasn't written it to the server yet
      const cp = useFestivalDataStore.getState().currentProfile;
      expect(cp?.picks['set-offline']).toBe('want-to-see');
      expect(cp?.notes['set-offline']).toBe('meet at rail');
      expect(cp?.reminders?.['set-offline']).toBe(15);
      // Existing picks must also survive
      expect(cp?.picks['set-1']).toBe('must');
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

  describe('bulkSavePicks', () => {
    it('merges all setIds into the picks map in ONE coalesced PUT', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);

      await useFestivalDataStore.getState().bulkSavePicks(['set-2', 'set-3', 'set-4'], 'must');

      // Exactly one write, not N.
      expect(api.put).toHaveBeenCalledTimes(1);
      expect(api.put).toHaveBeenCalledWith(
        `/profiles/${mockProfile.id}`,
        {
          picks: {
            'set-1': 'must', // pre-existing pick preserved
            'set-2': 'must',
            'set-3': 'must',
            'set-4': 'must',
          },
        },
        expect.objectContaining({ clientId: `bulk-${mockProfile.id}` }),
      );

      // Optimistic local state reflects all merged picks.
      const profile = useFestivalDataStore.getState().currentProfile!;
      expect(profile.picks['set-2']).toBe('must');
      expect(profile.picks['set-3']).toBe('must');
      expect(profile.picks['set-4']).toBe('must');
    });

    it('uses a profile-scoped clientId so repeated bulk applies coalesce', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValue(undefined);

      await useFestivalDataStore.getState().bulkSavePicks(['set-2'], 'want-to-see');
      await useFestivalDataStore.getState().bulkSavePicks(['set-3'], 'maybe');

      // Both writes share the same deterministic clientId so the offline queue
      // upserts them into one replayed PUT.
      const calls = vi.mocked(api.put).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]![2]).toEqual(expect.objectContaining({ clientId: `bulk-${mockProfile.id}` }));
      expect(calls[1]![2]).toEqual(expect.objectContaining({ clientId: `bulk-${mockProfile.id}` }));
    });

    it('is idempotent: no write when every set is already at this priority', async () => {
      // mockProfile already has set-1 -> 'must'.
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValue(undefined);

      await useFestivalDataStore.getState().bulkSavePicks(['set-1'], 'must');

      // No redundant queued PUT.
      expect(api.put).not.toHaveBeenCalled();
    });

    it('is idempotent: no write for an empty setIds list', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValue(undefined);

      await useFestivalDataStore.getState().bulkSavePicks([], 'must');

      expect(api.put).not.toHaveBeenCalled();
    });

    it('still writes once when only SOME of the sets change', async () => {
      // set-1 is already 'must'; set-2 is new. One PUT, merged map.
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);

      await useFestivalDataStore.getState().bulkSavePicks(['set-1', 'set-2'], 'must');

      expect(api.put).toHaveBeenCalledTimes(1);
      expect(useFestivalDataStore.getState().currentProfile!.picks['set-2']).toBe('must');
    });

    it('throws when no current profile', async () => {
      useFestivalDataStore.setState({ currentProfile: null });
      await expect(useFestivalDataStore.getState().bulkSavePicks(['set-1'], 'must')).rejects.toThrow(
        'No active profile',
      );
    });

    it('rolls back the optimistic update and sets error on API failure', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Server error'));

      await expect(useFestivalDataStore.getState().bulkSavePicks(['set-2', 'set-3'], 'must')).rejects.toThrow(
        'Server error',
      );
      const profile = useFestivalDataStore.getState().currentProfile!;
      // Rolled back to the original picks map.
      expect(profile.picks['set-2']).toBeUndefined();
      expect(profile.picks['set-3']).toBeUndefined();
      expect(useFestivalDataStore.getState().error).toBe('Server error');
    });

    it('handles non-Error thrown values', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(useFestivalDataStore.getState().bulkSavePicks(['set-2'], 'must')).rejects.toBe('string error');
      expect(useFestivalDataStore.getState().error).toBe('Failed to save picks');
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
      await expect(useFestivalDataStore.getState().removePick('fest-1', 'set-1')).rejects.toThrow('No active profile');
    });

    it('sets error on API failure', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('Server error'));
      await expect(useFestivalDataStore.getState().removePick('fest-1', 'set-1')).rejects.toThrow('Server error');
      expect(useFestivalDataStore.getState().error).toBe('Server error');
    });

    it('handles non-Error thrown values', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockRejectedValueOnce('string error');
      await expect(useFestivalDataStore.getState().removePick('fest-1', 'set-1')).rejects.toBe('string error');
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
    // offlinePut now delegates to api.put, which owns offline interception
    // (api routes to the platform queue when offlineMode is set). Here api is
    // fully mocked, so we just assert the store calls api.put with the
    // deterministic clientId + label and that the optimistic update survives.
    it('routes the write through api.put with a deterministic clientId', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      vi.mocked(api.put).mockResolvedValueOnce(undefined);

      await useFestivalDataStore.getState().savePick({
        festivalId: 'fest-1',
        setId: 'set-2',
        priority: 'maybe',
      });

      expect(api.put).toHaveBeenCalledWith(
        `/profiles/${mockProfile.id}`,
        expect.objectContaining({ picks: expect.objectContaining({ 'set-2': 'maybe' }) }),
        expect.objectContaining({ clientId: `pick-${mockProfile.id}-set-2` }),
      );
      // Optimistic update should have taken effect.
      expect(useFestivalDataStore.getState().currentProfile!.picks['set-2']).toBe('maybe');
    });

    it('keeps the optimistic update when api.put resolves (offline synthetic)', async () => {
      useFestivalDataStore.setState({ currentProfile: mockProfile });
      // Simulate the offline synthetic optimistic result api would return.
      vi.mocked(api.put).mockResolvedValueOnce({ _optimistic: true } as never);

      await useFestivalDataStore.getState().savePick({
        festivalId: 'fest-1',
        setId: 'set-2',
        priority: 'want-to-see',
      });

      expect(api.put).toHaveBeenCalled();
      expect(useFestivalDataStore.getState().currentProfile!.picks['set-2']).toBe('want-to-see');
    });
  });

  // ── F1: bounded, crew-scoped allProfiles persistence ─────────────────────
  describe('persist partialize (F1: allProfiles snapshot)', () => {
    // Reach into the persist middleware's configured partialize so we test the
    // exact serialization the store ships, not a re-implementation.
    const partialize = (state: ReturnType<typeof useFestivalDataStore.getState>) =>
      (
        useFestivalDataStore as unknown as {
          persist: { getOptions: () => { partialize: (s: typeof state) => Record<string, unknown> } };
        }
      ).persist
        .getOptions()
        .partialize(state);

    function profile(i: number): Profile {
      return {
        id: `prof-${i}`,
        userId: `user-${i}`,
        name: `User ${i}`,
        festivalId: 'fest-1',
        picks: { [`set-${i}`]: 'must' },
        notes: { [`set-${i}`]: 'secret note' },
        reminders: { [`set-${i}`]: 15 },
        updatedAt: '2026-01-01T00:00:00Z',
      };
    }

    it('persists allProfiles SLIMMED to { id, userId, name, picks } only', () => {
      useFestivalDataStore.setState({
        allProfiles: [profile(1)],
        _cachedFestivalId: 'fest-1',
        _profilesCachedAt: 123,
        _festivalCachedAt: 456,
      });
      const out = partialize(useFestivalDataStore.getState()) as { allProfiles: Record<string, unknown>[] };
      expect(out.allProfiles).toHaveLength(1);
      const p = out.allProfiles[0]!;
      expect(p.id).toBe('prof-1');
      expect(p.userId).toBe('user-1');
      expect(p.name).toBe('User 1');
      expect(p.picks).toEqual({ 'set-1': 'must' });
      // notes/reminders are dropped (not read by overlap/digest), notes backfilled empty.
      expect(p.notes).toEqual({});
      expect('reminders' in p).toBe(false);
      // festivalId backfilled from the cached-festival tag.
      expect(p.festivalId).toBe('fest-1');
    });

    it('caps the persisted snapshot at MAX_CACHED_PROFILES (60)', () => {
      const many = Array.from({ length: 200 }, (_, i) => profile(i));
      useFestivalDataStore.setState({ allProfiles: many, _cachedFestivalId: 'fest-1' });
      const out = partialize(useFestivalDataStore.getState()) as { allProfiles: unknown[] };
      expect(out.allProfiles).toHaveLength(60);
    });

    it('persists the freshness + staleness-guard bookkeeping fields', () => {
      useFestivalDataStore.setState({
        allProfiles: [],
        _cachedFestivalId: 'fest-1',
        _profilesCachedAt: 111,
        _festivalCachedAt: 222,
      });
      const out = partialize(useFestivalDataStore.getState()) as Record<string, unknown>;
      expect(out._cachedFestivalId).toBe('fest-1');
      expect(out._profilesCachedAt).toBe(111);
      expect(out._festivalCachedAt).toBe(222);
    });
  });

  // ── F1: selectFestival freshness stamps + cross-festival staleness guard ──
  describe('selectFestival F1 bookkeeping', () => {
    it('stamps _festivalCachedAt, _profilesCachedAt and _cachedFestivalId on success', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      const detailResponse = { ...mockFestival, stages: [], days: [] };
      vi.mocked(api.get).mockResolvedValueOnce(detailResponse).mockResolvedValueOnce([mockProfile]);

      const before = Date.now();
      await useFestivalDataStore.getState().selectFestival('fest-1');
      const state = useFestivalDataStore.getState();
      expect(state._cachedFestivalId).toBe('fest-1');
      expect(state._festivalCachedAt).toBeGreaterThanOrEqual(before);
      expect(state._profilesCachedAt).toBeGreaterThanOrEqual(before);
    });

    it('preserves persisted allProfiles offline ONLY when they belong to this festival', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      const cachedProfiles = [mockProfile];
      useFestivalDataStore.setState({ allProfiles: cachedProfiles, _cachedFestivalId: 'fest-1' });

      const detailResponse = { ...mockFestival, stages: [], days: [] };
      vi.mocked(api.get)
        .mockResolvedValueOnce(detailResponse)
        .mockRejectedValueOnce(new Error('Network request failed')); // /profiles offline

      await useFestivalDataStore.getState().selectFestival('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual(cachedProfiles);
    });

    it('DROPS a persisted allProfiles snapshot from a DIFFERENT festival (staleness guard)', async () => {
      useAuthStore.setState({
        user: { id: 'user-1', username: 'alice', createdAt: '', updatedAt: '' },
      });
      // Cached profiles belong to fest-OTHER; selecting fest-1 offline must not
      // bleed another festival's crew picks into the overlap/digest views.
      useFestivalDataStore.setState({ allProfiles: [mockProfile], _cachedFestivalId: 'fest-OTHER' });

      const detailResponse = { ...mockFestival, stages: [], days: [] };
      vi.mocked(api.get)
        .mockResolvedValueOnce(detailResponse)
        .mockRejectedValueOnce(new Error('Network request failed'));

      await useFestivalDataStore.getState().selectFestival('fest-1');
      expect(useFestivalDataStore.getState().allProfiles).toEqual([]);
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
