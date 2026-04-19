import { create, StateCreator } from 'zustand';
import { api } from '../services/api';
import { Crew, CrewMember, CrewOverlap, CreateCrewRequest, JoinCrewRequest } from '../types';

export interface CrewState {
  crews: Crew[];
  activeCrew: Crew | null;
  crewMembers: CrewMember[];
  crewOverlap: Record<string, CrewOverlap>;
  crewLoading: boolean;
  error: string | null;
}

export interface CrewActions {
  loadCrews: () => Promise<void>;
  selectCrew: (crewId: string) => Promise<void>;
  createCrew: (request: CreateCrewRequest) => Promise<Crew>;
  joinByCode: (request: JoinCrewRequest) => Promise<void>;
  leaveCrew: (crewId: string) => Promise<void>;
  kickMember: (crewId: string, memberId: string) => Promise<void>;
  transferOwnership: (crewId: string, newOwnerId: string) => Promise<void>;
  regenerateInvite: (crewId: string) => Promise<string>;
  deleteCrew: (crewId: string) => Promise<void>;
  loadOverlap: (crewId: string, festivalId: string) => Promise<void>;
  forceAddMember: (crewId: string, userId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export type CrewStore = CrewState & CrewActions;

const crewStore: StateCreator<CrewStore> = (set) => ({
  crews: [],
  activeCrew: null,
  crewMembers: [],
  crewOverlap: {},
  crewLoading: false,
  error: null,

  loadCrews: async () => {
    set({ crewLoading: true, error: null });
    try {
      const crews = await api.get<Crew[]>('/crews');
      set({ crews, crewLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load crews';
      set({ error: message, crewLoading: false });
      throw err;
    }
  },

  selectCrew: async (crewId: string) => {
    // Clear previous crew's data immediately so rapid switches don't
    // leave stale activeCrew/members visible during the fetch.
    set({ crewLoading: true, error: null, activeCrew: null, crewMembers: [] });
    try {
      const crew = await api.get<Crew & { members: CrewMember[] }>(`/crews/${crewId}`);
      set({
        activeCrew: crew,
        crewMembers: crew.members ?? [],
        crewLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load crew';
      set({ error: message, crewLoading: false });
      throw err;
    }
  },

  createCrew: async (request: CreateCrewRequest) => {
    set({ crewLoading: true, error: null });
    try {
      const crew = await api.post<Crew>('/crews', request);
      set((state) => ({
        crews: [...state.crews, crew],
        activeCrew: crew,
        crewMembers: [
          {
            id: '',
            userId: '',
            name: 'You',
            role: 'owner',
          },
        ],
        crewLoading: false,
      }));
      return crew;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create crew';
      set({ error: message, crewLoading: false });
      throw err;
    }
  },

  joinByCode: async (request: JoinCrewRequest) => {
    set({ crewLoading: true, error: null });
    try {
      const crew = await api.post<Crew>('/crews/join', request);
      set((state) => ({
        crews: [...state.crews, crew],
        crewLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join crew';
      set({ error: message, crewLoading: false });
      throw err;
    }
  },

  leaveCrew: async (crewId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/leave`);
      set((state) => ({
        crews: state.crews.filter((c) => c.id !== crewId),
        activeCrew: state.activeCrew?.id === crewId ? null : state.activeCrew,
        crewMembers: state.activeCrew?.id === crewId ? [] : state.crewMembers,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to leave crew';
      set({ error: message });
      throw err;
    }
  },

  kickMember: async (crewId: string, memberId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/members/${memberId}`);
      set((state) => ({
        crewMembers: state.crewMembers.filter((m) => m.id !== memberId),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to kick member';
      set({ error: message });
      throw err;
    }
  },

  transferOwnership: async (crewId: string, newOwnerId: string) => {
    set({ error: null });
    try {
      await api.put(`/crews/${crewId}/transfer`, { userId: newOwnerId });
      set((state) => ({
        crewMembers: state.crewMembers.map((m) =>
          m.id === newOwnerId ? { ...m, role: 'owner' } : { ...m, role: 'member' },
        ),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to transfer ownership';
      set({ error: message });
      throw err;
    }
  },

  regenerateInvite: async (crewId: string) => {
    set({ error: null });
    try {
      const { inviteCode } = await api.post<{ inviteCode: string }>(
        `/crews/${crewId}/invite`,
        {},
      );
      set((state) => ({
        activeCrew: state.activeCrew ? { ...state.activeCrew, inviteCode } : null,
      }));
      return inviteCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate invite';
      set({ error: message });
      throw err;
    }
  },

  deleteCrew: async (crewId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}`);
      set((state) => ({
        crews: state.crews.filter((c) => c.id !== crewId),
        activeCrew: state.activeCrew?.id === crewId ? null : state.activeCrew,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete crew';
      set({ error: message });
      throw err;
    }
  },

  loadOverlap: async (crewId: string, festivalId: string) => {
    set({ error: null });
    try {
      const overlap = await api.get<Record<string, CrewOverlap>>(
        `/crews/${crewId}/overlap?festivalId=${festivalId}`,
      );
      set({ crewOverlap: overlap });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load overlap';
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/members — admin-only (server gates on global 'admin' role).
  // Surfaces member conflict + "not found" errors unchanged so the caller can
  // distinguish "already a member" from a real failure.
  forceAddMember: async (crewId: string, userId: string) => {
    set({ error: null });
    try {
      const updated = await api.post<Crew>(`/crews/${crewId}/members`, { userId });
      set((state) => ({
        activeCrew: state.activeCrew?.id === crewId ? updated : state.activeCrew,
        crews: state.crews.map((c) => (c.id === crewId ? updated : c)),
        crewMembers: updated.members || state.crewMembers,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add member';
      set({ error: message });
      throw err;
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },
});

export const useCrewStore = create<CrewStore>()(crewStore);
