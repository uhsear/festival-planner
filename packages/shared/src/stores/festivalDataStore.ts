import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { getStorage } from '../platform/storage';
import { useAuthStore } from './authStore';

// Offline helper -- when `window.__festieQueue` is present AND the browser
// reports offline, queue the mutation via the bridge instead of calling the
// API. clientId is deterministic so multiple offline toggles of the same
// field collapse to one replayed PUT (useOfflineQueue.queueMutation upserts
// by clientId). Falls back to direct API call if the bridge is missing or
// we're online.
async function offlinePut(url: string, body: unknown, clientId: string): Promise<void> {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const bridge = window.__festieQueue;
    if (bridge?.queueMutation) {
      await bridge.queueMutation({ type: 'api', clientId, url, method: 'PUT', body });
      return;
    }
  }
  await api.put(url, body);
}
import {
  Festival,
  FestivalSet,
  FestivalDay,
  Stage,
  Profile,
  Priority,
  SavePickRequest,
  SaveNoteRequest,
} from '../types';

import { useFestivalUIStore } from './festivalUIStore';

/** Shape returned by GET /festivals/:id (after envelope unwrap). */
interface FestivalDetailResponse extends Festival {
  stages: Stage[];
  days: (FestivalDay & { label?: string; sets: FestivalSet[] })[];
}

export interface FestivalDataState {
  festivals: Festival[];
  currentFestivalId: string | null;
  currentFestival: Festival | null;
  currentProfile: Profile | null;
  allProfiles: Profile[];
  sets: FestivalSet[];
  stages: Stage[];
  days: FestivalDay[];
  isLoading: boolean;
  error: string | null;
}

export interface FestivalDataActions {
  loadFestivals: () => Promise<void>;
  selectFestival: (festivalId: string) => Promise<void>;
  loadProfiles: (festivalId: string) => Promise<void>;
  setCurrentProfile: (profile: Profile) => void;
  /**
   * Patch a single profile's picks in place from a realtime socket payload,
   * avoiding a full /profiles refetch on every pick event. Returns false if the
   * profile isn't loaded yet or no picks were provided — the caller should then
   * fall back to a full reload (e.g. a brand-new joiner).
   */
  applyProfilePatch: (patch: { profileId: string; picks?: Record<string, Priority> }) => boolean;
  savePick: (request: SavePickRequest) => Promise<void>;
  removePick: (festivalId: string, setId: string) => Promise<void>;
  saveNote: (request: SaveNoteRequest) => Promise<void>;
  setError: (error: string | null) => void;
}

export type FestivalDataStore = FestivalDataState & FestivalDataActions;

const festivalDataStore: StateCreator<FestivalDataStore> = (set, get) => ({
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

  loadFestivals: async () => {
    set({ isLoading: true, error: null });
    try {
      const festivals = await api.get<Festival[]>('/festivals');
      set({ festivals, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load festivals';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  // FIX: Single GET /festivals/:id returns stages + days (with nested sets).
  //      Profiles come from GET /profiles/:festivalId (separate endpoint).
  //      Removed 3 phantom sub-resource fetches (/sets, /stages, /days).
  selectFestival: async (festivalId: string) => {
    set({ isLoading: true, error: null, currentFestivalId: festivalId });
    try {
      // Festival detail is public; profiles require auth (401 for guests).
      const detail = await api.get<FestivalDetailResponse>(`/festivals/${festivalId}`);
      let profiles: Profile[] = [];
      if (useAuthStore.getState().user) {
        try {
          profiles = await api.get<Profile[]>(`/profiles/${festivalId}`);
        } catch (_) { /* session expired mid-flight -- ignore */ }
      }

      const { stages, days: rawDays, ...festival } = detail;

      // Flatten sets out of days[].sets, adding dayIndex + date from parent day
      const sets: FestivalSet[] = rawDays.flatMap((day, dayIdx) =>
        (day.sets ?? []).map((s) => ({ ...s, dayIndex: dayIdx, date: day.date })),
      );

      // Strip nested sets from day objects for the days[] store field (keep label for day tabs)
      const days: FestivalDay[] = rawDays.map(({ sets: _sets, ...day }, idx) => ({
        ...day,
        dayIndex: idx,
      }));

      // Initialize activeStages with ALL stage IDs (legacy behavior: show all by default)
      const allStageIds = stages.map((s) => s.id);

      // Find the current user's profile from the loaded profiles
      const userId = useAuthStore.getState().user?.id;
      const currentProfile = userId
        ? profiles.find((p) => p.userId === userId) || null
        : null;

      set({
        currentFestival: festival,
        sets,
        stages,
        days,
        allProfiles: profiles,
        currentProfile,
        isLoading: false,
      });

      // Reset UI state in the UI store when selecting a new festival
      useFestivalUIStore.setState({
        activeStages: allStageIds,
        selectedDay: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load festival';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  // FIX: profiles endpoint is GET /profiles/:festivalId, not /festivals/:id/profiles
  loadProfiles: async (festivalId: string) => {
    set({ isLoading: true, error: null });
    try {
      const profiles = await api.get<Profile[]>(`/profiles/${festivalId}`);
      const userId = useAuthStore.getState().user?.id;
      const currentProfile = userId
        ? profiles.find((p) => p.userId === userId) || null
        : null;
      set({ allProfiles: profiles, currentProfile, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profiles';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  setCurrentProfile: (profile: Profile) => {
    set({ currentProfile: profile });
  },

  applyProfilePatch: ({ profileId, picks }) => {
    if (!picks) return false;
    const { allProfiles, currentProfile } = get();
    const idx = allProfiles.findIndex((p) => p.id === profileId);
    if (idx === -1) return false; // not loaded — caller falls back to full reload
    const updated = { ...allProfiles[idx]!, picks };
    const next = allProfiles.slice();
    next[idx] = updated;
    set({
      allProfiles: next,
      currentProfile:
        currentProfile && currentProfile.id === profileId ? updated : currentProfile,
    });
    return true;
  },

  // FIX: PUT /profiles/:profileId with full picks map.
  //      Was incorrectly hitting PUT /profiles/:festivalId/picks.
  savePick: async (request: SavePickRequest) => {
    const prev = get().currentProfile;
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile -- select a festival first');
      }

      const mergedPicks: Record<string, Priority> = {
        ...currentProfile.picks,
      };
      if (request.priority) {
        mergedPicks[request.setId] = request.priority;
      } else {
        delete mergedPicks[request.setId];
      }

      // Optimistic: update local state BEFORE the network call so the star
      // fills immediately even if we're offline and the real PUT is queued.
      set({
        currentProfile: {
          ...currentProfile,
          picks: mergedPicks,
        },
      });

      await offlinePut(
        `/profiles/${currentProfile.id}`,
        { picks: mergedPicks },
        `pick-${currentProfile.id}-${request.setId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save pick';
      // Roll back the optimistic update so the UI never shows a pick as saved
      // when the write actually failed (e.g. offline with no queue on mobile).
      set({ currentProfile: prev, error: message });
      throw err;
    }
  },

  // FIX: PUT /profiles/:profileId with full picks map (key removed).
  //      Was incorrectly hitting DELETE /profiles/:festivalId/picks/:setId.
  removePick: async (_festivalId: string, setId: string) => {
    const prev = get().currentProfile;
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile -- select a festival first');
      }

      const mergedPicks = Object.fromEntries(
        Object.entries(currentProfile.picks).filter(([id]) => id !== setId),
      );

      set({
        currentProfile: {
          ...currentProfile,
          picks: mergedPicks,
        },
      });

      // Same clientId as savePick so a toggle-on-then-off offline sequence
      // collapses to one PUT whose body is the latest map.
      await offlinePut(
        `/profiles/${currentProfile.id}`,
        { picks: mergedPicks },
        `pick-${currentProfile.id}-${setId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove pick';
      set({ currentProfile: prev, error: message });
      throw err;
    }
  },

  // FIX: PUT /profiles/:profileId with full notes map.
  //      Was incorrectly hitting PUT /profiles/:festivalId/notes.
  saveNote: async (request: SaveNoteRequest) => {
    const prev = get().currentProfile;
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile -- select a festival first');
      }

      const mergedNotes: Record<string, string> = {
        ...currentProfile.notes,
        [request.setId]: request.note,
      };

      set({
        currentProfile: {
          ...currentProfile,
          notes: mergedNotes,
        },
      });

      await offlinePut(
        `/profiles/${currentProfile.id}`,
        { notes: mergedNotes },
        `note-${currentProfile.id}-${request.setId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save note';
      set({ currentProfile: prev, error: message });
      throw err;
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },
});

export const useFestivalDataStore = create<FestivalDataStore>()(
  persist(festivalDataStore, {
    name: 'festie-festival',
    storage: createJSONStorage(() => getStorage()),
    partialize: (state) => ({
      currentFestivalId: state.currentFestivalId,
    }),
  }),
);
