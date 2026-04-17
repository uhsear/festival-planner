import { create, StateCreator } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../services/api';
import { useAuthStore } from './authStore';
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

/** Shape returned by GET /festivals/:id (after envelope unwrap). */
interface FestivalDetailResponse extends Festival {
  stages: Stage[];
  days: (FestivalDay & { label?: string; sets: FestivalSet[] })[];
}

export interface FestivalState {
  festivals: Festival[];
  currentFestivalId: string | null;
  currentFestival: Festival | null;
  currentProfile: Profile | null;
  allProfiles: Profile[];
  selectedDay: number;
  activeStages: string[];
  searchQuery: string;
  sets: FestivalSet[];
  stages: Stage[];
  days: FestivalDay[];
  isLoading: boolean;
  error: string | null;
}

export interface FestivalActions {
  loadFestivals: () => Promise<void>;
  selectFestival: (festivalId: string) => Promise<void>;
  loadProfiles: (festivalId: string) => Promise<void>;
  setCurrentProfile: (profile: Profile) => void;
  savePick: (request: SavePickRequest) => Promise<void>;
  removePick: (festivalId: string, setId: string) => Promise<void>;
  saveNote: (request: SaveNoteRequest) => Promise<void>;
  setSelectedDay: (dayIndex: number) => void;
  setActiveStages: (stageIds: string[]) => void;
  setSearchQuery: (query: string) => void;
  setError: (error: string | null) => void;
}

export type FestivalStore = FestivalState & FestivalActions;

const festivalStore: StateCreator<FestivalStore> = (set, get) => ({
  festivals: [],
  currentFestivalId: null,
  currentFestival: null,
  currentProfile: null,
  allProfiles: [],
  selectedDay: 0,
  activeStages: [],
  searchQuery: '',
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
      try {
        profiles = await api.get<Profile[]>(`/profiles/${festivalId}`);
      } catch (_) { /* guest — no profiles, that's fine */ }

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
        activeStages: allStageIds,
        selectedDay: 0,
        isLoading: false,
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

  // FIX: PUT /profiles/:profileId with full picks map.
  //      Was incorrectly hitting PUT /profiles/:festivalId/picks.
  savePick: async (request: SavePickRequest) => {
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile — select a festival first');
      }

      const mergedPicks: Record<string, Priority> = {
        ...currentProfile.picks,
      };
      if (request.priority) {
        mergedPicks[request.setId] = request.priority;
      } else {
        delete mergedPicks[request.setId];
      }

      await api.put(`/profiles/${currentProfile.id}`, { picks: mergedPicks });

      set({
        currentProfile: {
          ...currentProfile,
          picks: mergedPicks,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save pick';
      set({ error: message });
      throw err;
    }
  },

  // FIX: PUT /profiles/:profileId with full picks map (key removed).
  //      Was incorrectly hitting DELETE /profiles/:festivalId/picks/:setId.
  removePick: async (_festivalId: string, setId: string) => {
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile — select a festival first');
      }

      const mergedPicks = Object.fromEntries(
        Object.entries(currentProfile.picks).filter(([id]) => id !== setId),
      );

      await api.put(`/profiles/${currentProfile.id}`, { picks: mergedPicks });

      set({
        currentProfile: {
          ...currentProfile,
          picks: mergedPicks,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove pick';
      set({ error: message });
      throw err;
    }
  },

  // FIX: PUT /profiles/:profileId with full notes map.
  //      Was incorrectly hitting PUT /profiles/:festivalId/notes.
  saveNote: async (request: SaveNoteRequest) => {
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile — select a festival first');
      }

      const mergedNotes: Record<string, string> = {
        ...currentProfile.notes,
        [request.setId]: request.note,
      };

      await api.put(`/profiles/${currentProfile.id}`, { notes: mergedNotes });

      set({
        currentProfile: {
          ...currentProfile,
          notes: mergedNotes,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save note';
      set({ error: message });
      throw err;
    }
  },

  setSelectedDay: (dayIndex: number) => {
    set({ selectedDay: dayIndex });
  },

  setActiveStages: (stageIds: string[]) => {
    set({ activeStages: stageIds });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setError: (error: string | null) => {
    set({ error });
  },
});

export const useFestivalStore = create<FestivalStore>()(
  persist(festivalStore, {
    name: 'festie-festival',
    partialize: (state) => ({
      currentFestivalId: state.currentFestivalId,
    }),
  }),
);
