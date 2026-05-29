import { create, StateCreator } from 'zustand';
import { api } from '../services/api';
import {
  Crew,
  CrewMember,
  CrewOverlap,
  CreateCrewRequest,
  JoinCrewRequest,
  CrewPoll,
  CreateCrewPollRequest,
  CrewMeetingPoint,
  CreateCrewMeetingPointRequest,
  UpdateCrewMeetingPointRequest,
} from '../types';

export interface CrewState {
  crews: Crew[];
  activeCrew: Crew | null;
  crewMembers: CrewMember[];
  crewOverlap: Record<string, CrewOverlap>;
  // Crew sub-feature data, keyed implicitly by the active crew (the screen
  // reloads these on crew switch). Additive — existing consumers ignore them.
  polls: CrewPoll[];
  meetingPoints: CrewMeetingPoint[];
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
  // Polls (routes/crew-polls.ts).
  loadPolls: (crewId: string) => Promise<void>;
  createPoll: (crewId: string, request: CreateCrewPollRequest) => Promise<CrewPoll>;
  votePoll: (crewId: string, pollId: string, optionIndex: number) => Promise<void>;
  closePoll: (crewId: string, pollId: string) => Promise<void>;
  // Meeting points (routes/crew-meeting-points.ts).
  loadMeetingPoints: (crewId: string) => Promise<void>;
  createMeetingPoint: (
    crewId: string,
    request: CreateCrewMeetingPointRequest,
  ) => Promise<CrewMeetingPoint>;
  updateMeetingPoint: (
    crewId: string,
    mpId: string,
    request: UpdateCrewMeetingPointRequest,
  ) => Promise<CrewMeetingPoint>;
  deleteMeetingPoint: (crewId: string, mpId: string) => Promise<void>;
  // Home base (owner-only PUT /crews/:id/home-base).
  updateHomeBase: (
    crewId: string,
    payload: { location: string | null; time: string | null },
  ) => Promise<void>;
  // ── Socket-driven setters (additive) ────────────────────────────
  // Applied by the realtime sync hook when crew:* events arrive for the
  // active crew. They mutate the in-memory polls / meetingPoints / activeCrew
  // home base so the open crew screen reflects remote changes live, without an
  // API round-trip. All are guarded by the caller against crew mismatch.
  applyHomeBaseUpdate: (
    crewId: string,
    payload: { location: string | null; time: string | null },
  ) => void;
  applyMeetingPointUpsert: (meetingPoint: CrewMeetingPoint) => void;
  applyMeetingPointRemoval: (mpId: string) => void;
  applyPollCreated: (poll: CrewPoll) => void;
  applyPollVote: (pollId: string, userId: string, optionIndex: number) => void;
  applyPollClosed: (pollId: string) => void;
  setError: (error: string | null) => void;
}

export type CrewStore = CrewState & CrewActions;

const crewStore: StateCreator<CrewStore> = (set) => ({
  crews: [],
  activeCrew: null,
  crewMembers: [],
  crewOverlap: {},
  polls: [],
  meetingPoints: [],
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

  // ── Polls ──────────────────────────────────────────────────────
  // GET /crews/:crewId/polls -> { polls } (api unwraps the data envelope).
  // Normalize votes the way the web PollsTab does so counts stay consistent.
  loadPolls: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<{ polls: CrewPoll[] } | CrewPoll[]>(
        `/crews/${crewId}/polls`,
      );
      const list = Array.isArray(res) ? res : (res?.polls ?? []);
      const polls = list.map((p) => ({
        ...p,
        votes: (p.votes || []).filter(
          (v) => v && v.user_id && typeof v.option === 'number',
        ),
      }));
      set({ polls });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load polls';
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/polls -> { poll }.
  createPoll: async (crewId: string, request: CreateCrewPollRequest) => {
    set({ error: null });
    try {
      const { poll } = await api.post<{ poll: CrewPoll }>(
        `/crews/${crewId}/polls`,
        request,
      );
      const normalized: CrewPoll = { ...poll, votes: poll.votes ?? [] };
      set((state) => ({ polls: [normalized, ...state.polls] }));
      return normalized;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create poll';
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/polls/:pollId/vote -> { voted: true }. Refetch so the
  // server-resolved vote counts (one-vote-per-user semantics) are authoritative.
  votePoll: async (crewId: string, pollId: string, optionIndex: number) => {
    set({ error: null });
    try {
      await api.post(`/crews/${crewId}/polls/${pollId}/vote`, { optionIndex });
      await useCrewStore.getState().loadPolls(crewId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to vote';
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/polls/:pollId (close). Drop it from local state.
  closePoll: async (crewId: string, pollId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/polls/${pollId}`);
      set((state) => ({ polls: state.polls.filter((p) => p.id !== pollId) }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to close poll';
      set({ error: message });
      throw err;
    }
  },

  // ── Meeting points ─────────────────────────────────────────────
  // GET /crews/:crewId/meeting-points -> { meetingPoints }.
  loadMeetingPoints: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<
        { meetingPoints: CrewMeetingPoint[] } | CrewMeetingPoint[]
      >(`/crews/${crewId}/meeting-points`);
      const meetingPoints = Array.isArray(res) ? res : (res?.meetingPoints ?? []);
      set({ meetingPoints });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load meeting points';
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/meeting-points -> { meetingPoint } (201).
  createMeetingPoint: async (
    crewId: string,
    request: CreateCrewMeetingPointRequest,
  ) => {
    set({ error: null });
    try {
      const { meetingPoint } = await api.post<{ meetingPoint: CrewMeetingPoint }>(
        `/crews/${crewId}/meeting-points`,
        request,
      );
      set((state) => ({ meetingPoints: [meetingPoint, ...state.meetingPoints] }));
      return meetingPoint;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to add meeting point';
      set({ error: message });
      throw err;
    }
  },

  // PUT /crews/:crewId/meeting-points/:mpId -> { meetingPoint }.
  updateMeetingPoint: async (
    crewId: string,
    mpId: string,
    request: UpdateCrewMeetingPointRequest,
  ) => {
    set({ error: null });
    try {
      const { meetingPoint } = await api.put<{ meetingPoint: CrewMeetingPoint }>(
        `/crews/${crewId}/meeting-points/${mpId}`,
        request,
      );
      set((state) => ({
        meetingPoints: state.meetingPoints.map((m) =>
          m.id === mpId ? meetingPoint : m,
        ),
      }));
      return meetingPoint;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update meeting point';
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/meeting-points/:mpId.
  deleteMeetingPoint: async (crewId: string, mpId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/meeting-points/${mpId}`);
      set((state) => ({
        meetingPoints: state.meetingPoints.filter((m) => m.id !== mpId),
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to remove meeting point';
      set({ error: message });
      throw err;
    }
  },

  // ── Home base ──────────────────────────────────────────────────
  // PUT /crews/:crewId/home-base -> { crew }. Owner-only server-side. Merge the
  // returned crew so activeCrew/crews reflect the new home base immediately.
  updateHomeBase: async (
    crewId: string,
    payload: { location: string | null; time: string | null },
  ) => {
    set({ error: null });
    try {
      const { crew } = await api.put<{ crew: Crew }>(
        `/crews/${crewId}/home-base`,
        payload,
      );
      set((state) => ({
        activeCrew:
          state.activeCrew?.id === crewId
            ? { ...state.activeCrew, ...crew }
            : state.activeCrew,
        crews: state.crews.map((c) =>
          c.id === crewId ? { ...c, ...crew } : c,
        ),
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update home base';
      set({ error: message });
      throw err;
    }
  },

  // ── Socket-driven setters (additive) ──────────────────────────
  // Merge a remote home-base change onto the active crew + crews list. The
  // socket payload carries `location` / `time`; map them onto the serialized
  // crew's homeBaseLocation / homeBaseTime fields.
  applyHomeBaseUpdate: (
    crewId: string,
    payload: { location: string | null; time: string | null },
  ) => {
    set((state) => ({
      activeCrew:
        state.activeCrew?.id === crewId
          ? {
              ...state.activeCrew,
              homeBaseLocation: payload.location,
              homeBaseTime: payload.time,
            }
          : state.activeCrew,
      crews: state.crews.map((c) =>
        c.id === crewId
          ? { ...c, homeBaseLocation: payload.location, homeBaseTime: payload.time }
          : c,
      ),
    }));
  },

  // Insert or replace a meeting point from a remote create/update event.
  applyMeetingPointUpsert: (meetingPoint: CrewMeetingPoint) => {
    set((state) => {
      const exists = state.meetingPoints.some((m) => m.id === meetingPoint.id);
      return {
        meetingPoints: exists
          ? state.meetingPoints.map((m) =>
              m.id === meetingPoint.id ? meetingPoint : m,
            )
          : [meetingPoint, ...state.meetingPoints],
      };
    });
  },

  applyMeetingPointRemoval: (mpId: string) => {
    set((state) => ({
      meetingPoints: state.meetingPoints.filter((m) => m.id !== mpId),
    }));
  },

  // Prepend a poll created remotely (skip if already present from our own
  // optimistic create). Normalize votes like loadPolls / createPoll.
  applyPollCreated: (poll: CrewPoll) => {
    set((state) => {
      if (state.polls.some((p) => p.id === poll.id)) return {};
      const normalized: CrewPoll = { ...poll, votes: poll.votes ?? [] };
      return { polls: [normalized, ...state.polls] };
    });
  },

  // Apply a single remote vote: one-vote-per-user, so replace any prior vote
  // by this user on this poll, then add the new one.
  applyPollVote: (pollId: string, userId: string, optionIndex: number) => {
    set((state) => ({
      polls: state.polls.map((p) => {
        if (p.id !== pollId) return p;
        const others = (p.votes || []).filter((v) => v.user_id !== userId);
        return {
          ...p,
          votes: [...others, { option: optionIndex, user_id: userId }],
        };
      }),
    }));
  },

  // Drop a closed poll from local state (mirrors closePoll's local effect).
  applyPollClosed: (pollId: string) => {
    set((state) => ({ polls: state.polls.filter((p) => p.id !== pollId) }));
  },

  setError: (error: string | null) => {
    set({ error });
  },
});

export const useCrewStore = create<CrewStore>()(crewStore);
