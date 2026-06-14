import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { registerCreateReconciler } from '../services/offlineQueue';
import { mapErrorToUserMessage } from '../services/errors';
import { getStorage } from '../platform/storage';
import { useAuthStore } from './authStore';
import {
  Crew,
  CrewMember,
  CrewOverlap,
  CreateCrewRequest,
  JoinCrewRequest,
  ReformCrewResponse,
  CrewPoll,
  CreateCrewPollRequest,
  PollSetRef,
  ClosePollOptions,
  CrewMeetingPoint,
  CreateCrewMeetingPointRequest,
  UpdateCrewMeetingPointRequest,
  CrewPackingItem,
  CreateCrewPackingItemRequest,
  UpdateCrewPackingItemRequest,
  CrewRideOffer,
  CreateCrewRideOfferRequest,
  UpdateCrewRideOfferRequest,
  CrewMemberStatus,
  UpdateCrewMemberStatusRequest,
  CrewExpense,
  CrewExpenseBalance,
  CreateCrewExpenseRequest,
  SettleCrewExpenseRequest,
  CrewSettlement,
  CrewSettlementPlan,
  CrewActivityEntry,
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
  packingItems: CrewPackingItem[];
  rideOffers: CrewRideOffer[];
  // M5: last-synced "on my way / ETA to [point]" per crew member. A degraded-
  // sync snapshot list (NOT live GPS) — render each row's `updated_at` with
  // formatStaleness ("as of N ago"), never as real-time.
  crewStatuses: CrewMemberStatus[];
  expenses: CrewExpense[];
  expenseBalances: CrewExpenseBalance[];
  // Netted who-pays-whom plan (greedy min-cash-flow) + payee handles. Loaded
  // alongside balances from the settlement-plan endpoint.
  settlements: CrewSettlement[];
  activity: CrewActivityEntry[];
  crewLoading: boolean;
  error: string | null;
  // ── Offline read-cache bookkeeping (persisted) ──────────────────
  // `_cachedAt` is the epoch-ms when the active crew's data was last loaded;
  // a later UI can render "showing offline data · synced N ago" from it.
  // `_cachedCrewId` records which crew the persisted sub-data (members /
  // meetingPoints / polls / expenses / activity) belongs to, so a cold start
  // never shows one crew's stale meeting points while another crew is open.
  _cachedAt: number | null;
  _cachedCrewId: string | null;
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
  // Reform the given (source) crew for another festival: server creates a NEW
  // crew in `targetFestivalId`, auto-adds prior members who already have a
  // target-festival profile, and returns the rest as "to invite". Returns the
  // new crew + roster outcome; the caller surfaces its invite link via
  // CrewInviteBar. Online-only (a fresh crew can't be created offline).
  reformCrew: (sourceCrewId: string, targetFestivalId: string) => Promise<ReformCrewResponse>;
  deleteCrew: (crewId: string) => Promise<void>;
  loadOverlap: (crewId: string, festivalId: string) => Promise<void>;
  forceAddMember: (crewId: string, userId: string) => Promise<void>;
  // Polls (routes/crew-polls.ts).
  loadPolls: (crewId: string) => Promise<void>;
  // `setRefs` (optional) carries the schedule-aware composer's option→set
  // linkage (index-aligned with request.options). It is kept in LOCAL state
  // only and never sent to the server — closePoll consumes it to spawn the
  // winning set's meeting point + reminder. Plain polls omit it.
  createPoll: (crewId: string, request: CreateCrewPollRequest, setRefs?: (PollSetRef | null)[]) => Promise<CrewPoll>;
  votePoll: (crewId: string, pollId: string, optionIndex: number) => Promise<void>;
  // `opts` (optional) lets a schedule-aware poll, on close, materialize the
  // winning option's linked set as a meeting point + seeded reminder. Omitted →
  // legacy close (just drop the poll).
  closePoll: (crewId: string, pollId: string, opts?: ClosePollOptions) => Promise<void>;
  // Meeting points (routes/crew-meeting-points.ts).
  loadMeetingPoints: (crewId: string) => Promise<void>;
  createMeetingPoint: (crewId: string, request: CreateCrewMeetingPointRequest) => Promise<CrewMeetingPoint>;
  updateMeetingPoint: (
    crewId: string,
    mpId: string,
    request: UpdateCrewMeetingPointRequest,
  ) => Promise<CrewMeetingPoint>;
  deleteMeetingPoint: (crewId: string, mpId: string) => Promise<void>;
  // Packing board (routes/crew-packing.ts). Offline-native like polls.
  loadPacking: (crewId: string) => Promise<void>;
  createPackingItem: (crewId: string, request: CreateCrewPackingItemRequest) => Promise<CrewPackingItem>;
  updatePackingItem: (
    crewId: string,
    itemId: string,
    request: UpdateCrewPackingItemRequest,
  ) => Promise<CrewPackingItem>;
  deletePackingItem: (crewId: string, itemId: string) => Promise<void>;
  // Ride board (routes/crew-rides.ts). Offline-native like packing.
  loadRides: (crewId: string) => Promise<void>;
  createRideOffer: (crewId: string, request: CreateCrewRideOfferRequest) => Promise<CrewRideOffer>;
  updateRideOffer: (crewId: string, offerId: string, request: UpdateCrewRideOfferRequest) => Promise<CrewRideOffer>;
  deleteRideOffer: (crewId: string, offerId: string) => Promise<void>;
  // Member status (routes/crew-status.ts). Offline-degraded like the crew
  // sub-resources: updateMyStatus queues offline (deterministic clientId
  // collapses toggles) and reconciles on a signal blip. NOT live GPS.
  loadStatuses: (crewId: string) => Promise<void>;
  updateMyStatus: (crewId: string, request: UpdateCrewMemberStatusRequest, myUserId: string) => Promise<void>;
  // Expenses (routes/crew-expenses.ts).
  loadExpenses: (crewId: string) => Promise<void>;
  addExpense: (crewId: string, request: CreateCrewExpenseRequest) => Promise<void>;
  removeExpense: (crewId: string, expenseId: string) => Promise<void>;
  settleExpense: (crewId: string, request: SettleCrewExpenseRequest) => Promise<void>;
  // Activity feed (routes/crew-activity.ts).
  loadActivity: (crewId: string) => Promise<void>;
  // Home base (owner-only PUT /crews/:id/home-base).
  updateHomeBase: (crewId: string, payload: { location: string | null; time: string | null }) => Promise<void>;
  // M6 Crew Photo Wall (Phase 1, link-out): set/clear the crew shared-album URL
  // (member-gated PUT /crews/:id/photo-album). Pass null to clear.
  updatePhotoAlbum: (crewId: string, payload: { photoAlbumUrl: string | null }) => Promise<void>;
  // ── Socket-driven setters (additive) ────────────────────────────
  // Applied by the realtime sync hook when crew:* events arrive for the
  // active crew. They mutate the in-memory polls / meetingPoints / activeCrew
  // home base so the open crew screen reflects remote changes live, without an
  // API round-trip. All are guarded by the caller against crew mismatch.
  applyHomeBaseUpdate: (crewId: string, payload: { location: string | null; time: string | null }) => void;
  // M6: merge a remote photo-album change onto the active crew + crews list.
  applyPhotoAlbumUpdate: (crewId: string, payload: { photoAlbumUrl: string | null }) => void;
  applyMeetingPointUpsert: (meetingPoint: CrewMeetingPoint) => void;
  applyMeetingPointRemoval: (mpId: string) => void;
  applyPollCreated: (poll: CrewPoll) => void;
  applyPollVote: (pollId: string, userId: string, optionIndex: number) => void;
  applyPollClosed: (pollId: string) => void;
  // M5: upsert a crew member's last-synced status from a remote
  // crew:status-updated event. Replaces any prior row for that user (one row
  // per member). Honest staleness is rendered from `updated_at` by consumers.
  applyStatusUpdate: (status: CrewMemberStatus) => void;
  setError: (error: string | null) => void;
}

export type CrewStore = CrewState & CrewActions;

type CrewSet = Parameters<StateCreator<CrewStore>>[0];

// GET /crews/:crewId/expenses/settlement-plan -> { balances, settlements }.
// The settlement-plan endpoint returns BOTH the raw balances and the netted
// who-pays-whom plan (with payee handles), so one call populates both. Shared
// by the expense mutations so each refetches an authoritative plan after
// writing.
async function loadBalances(set: CrewSet, crewId: string): Promise<void> {
  const res = await api.get<CrewSettlementPlan>(`/crews/${crewId}/expenses/settlement-plan`);
  const expenseBalances = res?.balances ?? [];
  const settlements = res?.settlements ?? [];
  set({ expenseBalances, settlements });
}

// ── Persisted read-cache size bounds ──────────────────────────────────────
// Cap the persisted blob so a busy crew can't bloat AsyncStorage/localStorage.
// Lists are stored newest-first by their loaders (server order / prepend), so
// slicing the head keeps the most-recent items.
const MAX_CACHED_ACTIVITY = 50;
const MAX_CACHED_POLLS = 100;
const MAX_CACHED_PACKING = 200;
const MAX_CACHED_RIDES = 200;
const MAX_CACHED_STATUSES = 100;
const MAX_CACHED_EXPENSES = 100;

// ── Offline optimistic-create helpers (Phase 2) ────────────────────────────
// Drop any lingering client-only optimistic placeholders from a list. Called
// whenever an authoritative server list replaces local state (load*/selectCrew)
// so a refetch can never leave a temp entity duplicated alongside the real one
// — the reload-dedup safety net behind the queue reconciler.
function dropOptimistic<T extends { _optimistic?: boolean }>(list: T[]): T[] {
  return list.filter((item) => item._optimistic !== true);
}

// ── Schedule-aware poll close (M2) ─────────────────────────────────────────
// Tally a poll's votes and return the set linkage behind the WINNING option, or
// null when the poll isn't schedule-aware, has no votes, or the winner is a
// free-text option (no set behind it). Ties resolve to the lowest option index
// (deterministic). Used by closePoll to spawn the meeting point + reminder.
function resolveWinningSetRef(poll: CrewPoll): PollSetRef | null {
  const refs = poll._setRefs;
  if (!refs || refs.length === 0) return null;
  const counts = new Array<number>(poll.options.length).fill(0);
  for (const v of poll.votes || []) {
    if (typeof v.option === 'number' && v.option >= 0 && v.option < counts.length) {
      counts[v.option] = (counts[v.option] ?? 0) + 1;
    }
  }
  let winner = -1;
  let best = 0; // a winner needs at least one vote
  for (let i = 0; i < counts.length; i++) {
    if ((counts[i] ?? 0) > best) {
      best = counts[i] ?? 0;
      winner = i;
    }
  }
  if (winner < 0) return null;
  return refs[winner] ?? null;
}

let _lastSelectCrewId: string | null = null;

const crewStore: StateCreator<CrewStore> = (set) => ({
  crews: [],
  activeCrew: null,
  crewMembers: [],
  crewOverlap: {},
  polls: [],
  meetingPoints: [],
  packingItems: [],
  rideOffers: [],
  crewStatuses: [],
  expenses: [],
  expenseBalances: [],
  settlements: [],
  activity: [],
  crewLoading: false,
  error: null,
  _cachedAt: null,
  _cachedCrewId: null,

  loadCrews: async () => {
    set({ crewLoading: true, error: null });
    try {
      const crews = await api.get<Crew[]>('/crews');
      set({ crews, crewLoading: false });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load crews');
      set({ error: message, crewLoading: false });
      throw err;
    }
  },

  selectCrew: async (crewId: string) => {
    _lastSelectCrewId = crewId;
    set((state) => {
      const sameCrew = state._cachedCrewId === crewId;
      return {
        crewLoading: true,
        error: null,
        activeCrew: null,
        crewMembers: sameCrew ? state.crewMembers : [],
        polls: sameCrew ? state.polls : [],
        meetingPoints: sameCrew ? state.meetingPoints : [],
        packingItems: sameCrew ? state.packingItems : [],
        rideOffers: sameCrew ? state.rideOffers : [],
        crewStatuses: sameCrew ? state.crewStatuses : [],
        expenses: sameCrew ? state.expenses : [],
        expenseBalances: sameCrew ? state.expenseBalances : [],
        settlements: sameCrew ? state.settlements : [],
        activity: sameCrew ? state.activity : [],
      };
    });
    try {
      const crew = await api.get<Crew & { members: CrewMember[] }>(`/crews/${crewId}`);
      if (_lastSelectCrewId !== crewId) {
        set({ crewLoading: false });
        return;
      }
      set({
        activeCrew: crew,
        crewMembers: crew.members ?? [],
        crewLoading: false,
        _cachedAt: Date.now(),
        _cachedCrewId: crewId,
      });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load crew');
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
        crewMembers: crew.members ?? [],
        crewLoading: false,
      }));
      return crew;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to create crew');
      set({ error: message, crewLoading: false });
      throw err;
    }
  },

  // POST /crews/join -> the joined crew. Offline: queue the join and insert an
  // optimistic placeholder crew so the user sees "joined" immediately; the
  // reconciler (registered below) swaps it for the real crew once the queued
  // POST replays. The clientId is DETERMINISTIC on the invite code
  // (`join-<inviteCode>`) so repeated offline taps of the same invite collapse
  // into a single replayed join (replay-safe; the server treats re-joining an
  // already-joined crew as a no-op/idempotent rather than a duplicate).
  //
  // NOTE: this only routes to the offline queue once '/crews/join' is added to
  // OFFLINE_ELIGIBLE_PATTERNS in services/api.ts (a separate file). Until then
  // the post() runs online-only and onOptimisticCreate is never invoked — the
  // online path below is unchanged, so this is safe to land independently.
  joinByCode: async (request: JoinCrewRequest) => {
    set({ crewLoading: true, error: null });
    try {
      let optimisticCrew: Crew | null = null;
      const res = await api.post<Crew | (JoinCrewRequest & { id: string; _optimistic: true })>('/crews/join', request, {
        // Deterministic clientId collapses repeated offline join taps of the
        // same invite into one pending write keyed on the invite code.
        clientId: `POST:/crews/join:join-${request.inviteCode}`,
        offlineLabel: 'Join crew',
        onOptimisticCreate: (result) => {
          const r = result as { id: string };
          optimisticCrew = {
            id: r.id,
            name: 'Joining crew…',
            owner: '',
            members: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _optimistic: true,
          };
          set((state) => ({ crews: [...state.crews, optimisticCrew as Crew], crewLoading: false }));
        },
      });
      // Offline: the placeholder is already inserted; nothing more to do.
      if (optimisticCrew) return;
      const crew = res as Crew;
      set((state) => ({
        crews: state.crews.some((c) => c.id === crew.id) ? state.crews : [...state.crews, crew],
        crewLoading: false,
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to join crew');
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
      const message = mapErrorToUserMessage(err, 'Failed to leave crew');
      set({ error: message });
      throw err;
    }
  },

  kickMember: async (crewId: string, memberId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/members/${memberId}`);
      set((state) => ({
        crewMembers: state.crewMembers.filter((m) => m.userId !== memberId),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to kick member');
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
          m.userId === newOwnerId ? { ...m, role: 'owner' } : { ...m, role: 'member' },
        ),
        activeCrew:
          state.activeCrew?.id === crewId
            ? {
                ...state.activeCrew,
                owner: newOwnerId,
                members: state.activeCrew.members.map((m) =>
                  m.userId === newOwnerId ? { ...m, role: 'owner' } : { ...m, role: 'member' },
                ),
              }
            : state.activeCrew,
        crews: state.crews.map((c) => (c.id === crewId ? { ...c, owner: newOwnerId } : c)),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to transfer ownership');
      set({ error: message });
      throw err;
    }
  },

  regenerateInvite: async (crewId: string) => {
    set({ error: null });
    try {
      const { inviteCode } = await api.post<{ inviteCode: string }>(`/crews/${crewId}/invite`, {});
      set((state) => ({
        activeCrew: state.activeCrew ? { ...state.activeCrew, inviteCode } : null,
      }));
      return inviteCode;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to regenerate invite');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:sourceCrewId/reform { targetFestivalId } -> the new crew +
  // { reform: { autoAdded, invited } }. Insert the new crew into the list and
  // select it so the screen shows its invite link immediately. Idempotent on
  // the server: re-running returns the same reformed crew rather than a dupe.
  reformCrew: async (sourceCrewId: string, targetFestivalId: string) => {
    set({ crewLoading: true, error: null });
    try {
      const crew = await api.post<ReformCrewResponse>(`/crews/${sourceCrewId}/reform`, { targetFestivalId });
      set((state) => ({
        // Replace if the reformed crew is already in the list (idempotent
        // re-run), otherwise append. Then make it the active crew.
        crews: state.crews.some((c) => c.id === crew.id)
          ? state.crews.map((c) => (c.id === crew.id ? crew : c))
          : [...state.crews, crew],
        activeCrew: crew,
        crewMembers: crew.members ?? [],
        crewLoading: false,
        _cachedAt: Date.now(),
        _cachedCrewId: crew.id,
      }));
      return crew;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to reform crew');
      set({ error: message, crewLoading: false });
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
      const message = mapErrorToUserMessage(err, 'Failed to delete crew');
      set({ error: message });
      throw err;
    }
  },

  loadOverlap: async (crewId: string, festivalId: string) => {
    set({ error: null });
    try {
      const overlap = await api.get<Record<string, CrewOverlap>>(`/crews/${crewId}/overlap?festivalId=${festivalId}`);
      set({ crewOverlap: overlap });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load overlap');
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
      const message = mapErrorToUserMessage(err, 'Failed to add member');
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
      const res = await api.get<{ polls: CrewPoll[] } | CrewPoll[]>(`/crews/${crewId}/polls`);
      const list = Array.isArray(res) ? res : (res?.polls ?? []);
      const polls = list.map((p) => ({
        ...p,
        votes: (p.votes || []).filter((v) => v && v.user_id && typeof v.option === 'number'),
      }));
      // Authoritative server list — drop any lingering optimistic placeholders
      // so a refetch can't duplicate an offline-created poll (reload-dedup).
      set({ polls: dropOptimistic(polls) });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load polls');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/polls -> { poll }. When offline the post is queued and
  // returns a synthetic optimistic poll (id = clientId, _optimistic: true);
  // onOptimisticCreate inserts it so it renders immediately. The reconciler
  // (registered below) swaps it for the real poll once the queued POST replays.
  createPoll: async (crewId: string, request: CreateCrewPollRequest, setRefs?: (PollSetRef | null)[]) => {
    set({ error: null });
    try {
      // Schedule-aware linkage is CLIENT-ONLY: attach it to local state but keep
      // it out of the POST body so the server (which ignores it) stays the source
      // of truth for the poll itself and no migration is needed. Only keep it
      // when it actually links at least one option to a set.
      const localSetRefs = setRefs && setRefs.some((r) => r != null) ? setRefs : undefined;
      let optimisticPoll: CrewPoll | null = null;
      // The offline synthetic result is the BODY shape ({ ...request, id, _optimistic }),
      // NOT the server's { poll } envelope — so build + return the placeholder here
      // and skip the envelope unwrap below for that case.
      const res = await api.post<{ poll: CrewPoll } | (CreateCrewPollRequest & { id: string; _optimistic: true })>(
        `/crews/${crewId}/polls`,
        request,
        {
          onOptimisticCreate: (result) => {
            const r = result as { id: string };
            optimisticPoll = {
              id: r.id,
              crew_id: crewId,
              created_by: '',
              question: request.question,
              options: request.options,
              votes: [],
              closes_at: request.closesAt ?? null,
              closed: false,
              created_at: new Date().toISOString(),
              _optimistic: true,
              ...(localSetRefs ? { _setRefs: localSetRefs } : {}),
            };
            set((state) => ({ polls: [optimisticPoll as CrewPoll, ...state.polls] }));
          },
        },
      );
      // Offline: the placeholder is already inserted; return it (don't re-insert).
      if (optimisticPoll) return optimisticPoll;
      const { poll } = res as { poll: CrewPoll };
      // Re-attach the client-only linkage onto the authoritative server poll
      // (the server never echoes it back).
      const normalized: CrewPoll = {
        ...poll,
        votes: poll.votes ?? [],
        ...(localSetRefs ? { _setRefs: localSetRefs } : {}),
      };
      set((state) => ({ polls: [normalized, ...state.polls] }));
      return normalized;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to create poll');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/polls/:pollId/vote -> { voted: true }. Refetch so the
  // server-resolved vote counts (one-vote-per-user semantics) are authoritative.
  //
  // Optimistic: write the user's vote into the local poll BEFORE the POST so the
  // option fills instantly (mirrors savePick) — critical on festival-grade signal
  // where the refetch may never complete. Snapshot + roll back on error; the
  // best-effort refetch then reconciles to the server-authoritative counts.
  votePoll: async (crewId: string, pollId: string, optionIndex: number) => {
    set({ error: null });

    const userId = useAuthStore.getState().user?.id ?? null;
    const prevPolls = useCrewStore.getState().polls;

    if (userId) {
      set((state) => ({
        polls: state.polls.map((p) => {
          if (p.id !== pollId) return p;
          // One vote per user: drop this user's prior vote, then add the new one.
          const others = (p.votes ?? []).filter((v) => v.user_id !== userId);
          return { ...p, votes: [...others, { option: optionIndex, user_id: userId }] };
        }),
      }));
    }

    try {
      await api.post(`/crews/${crewId}/polls/${pollId}/vote`, { optionIndex });
      try {
        await useCrewStore.getState().loadPolls(crewId);
      } catch {
        /* refetch is best-effort; the write succeeded */
      }
    } catch (err) {
      // Roll back the optimistic vote so the UI matches reality.
      if (userId) set({ polls: prevPolls });
      const message = mapErrorToUserMessage(err, 'Failed to vote');
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/polls/:pollId (close). Drop it from local state.
  //
  // Schedule-aware close (M2): if the poll carries `_setRefs` (set by the
  // composer) AND `opts` is supplied, the WINNING option's linked set becomes a
  // shared meeting point (label=artist, stageReference=stage, meetAt=set start)
  // via the existing createMeetingPoint, and a reminder is seeded via the
  // injected `opts.seedReminder` (bound to festivalDataStore.saveReminder). We
  // resolve the winner + the linked set BEFORE deleting so the poll/linkage is
  // still in state. The meeting-point create and reminder are best-effort: a
  // failure there is swallowed so it never blocks closing the poll. Plain polls
  // (no `_setRefs`/`opts`) close exactly as before.
  closePoll: async (crewId: string, pollId: string, opts?: ClosePollOptions) => {
    set({ error: null });
    // Resolve the winning set linkage up front (poll still present in state).
    const poll = useCrewStore.getState().polls.find((p) => p.id === pollId);
    const winningRef = poll ? resolveWinningSetRef(poll) : null;
    try {
      await api.delete(`/crews/${crewId}/polls/${pollId}`);
      set((state) => ({ polls: state.polls.filter((p) => p.id !== pollId) }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to close poll');
      set({ error: message });
      throw err;
    }
    // Post-close side effects — best-effort, never throw back to the caller so a
    // meeting-point/reminder hiccup can't undo a successful close.
    if (winningRef) {
      try {
        await useCrewStore.getState().createMeetingPoint(crewId, {
          label: winningRef.label,
          location: winningRef.stageReference ?? '',
          type: 'set',
          stageReference: winningRef.stageReference,
          meetAt: winningRef.meetAt,
        });
      } catch {
        // createMeetingPoint already surfaced the error on the store.
      }
      if (opts?.seedReminder && opts.festivalId) {
        try {
          await opts.seedReminder(winningRef.setId, opts.festivalId);
        } catch {
          // Reminder seeding is best-effort; saveReminder surfaces its own error.
        }
      }
    }
  },

  // ── Meeting points ─────────────────────────────────────────────
  // GET /crews/:crewId/meeting-points -> { meetingPoints }.
  loadMeetingPoints: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<{ meetingPoints: CrewMeetingPoint[] } | CrewMeetingPoint[]>(
        `/crews/${crewId}/meeting-points`,
      );
      const meetingPoints = Array.isArray(res) ? res : (res?.meetingPoints ?? []);
      // Reload-dedup: discard lingering optimistic placeholders.
      set({ meetingPoints: dropOptimistic(meetingPoints) });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load meeting points');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/meeting-points -> { meetingPoint } (201). Offline: queue
  // + insert an optimistic placeholder so it renders immediately; the reconciler
  // swaps it for the real meeting point once the queued POST replays.
  createMeetingPoint: async (crewId: string, request: CreateCrewMeetingPointRequest) => {
    set({ error: null });
    try {
      let optimisticMp: CrewMeetingPoint | null = null;
      const res = await api.post<
        { meetingPoint: CrewMeetingPoint } | (CreateCrewMeetingPointRequest & { id: string; _optimistic: true })
      >(`/crews/${crewId}/meeting-points`, request, {
        onOptimisticCreate: (result) => {
          const r = result as { id: string };
          optimisticMp = {
            id: r.id,
            crew_id: crewId,
            created_by: '',
            label: request.label,
            location: request.location,
            type: request.type ?? 'custom',
            meet_at: request.meetAt ?? null,
            stage_reference: request.stageReference ?? null,
            // F4: render offline-captured coords immediately; survives reconcile
            // since the queued POST replays the same lat/lng (no reconciler change).
            latitude: request.latitude ?? null,
            longitude: request.longitude ?? null,
            // 055: render recurrence immediately; the queued POST replays the same
            // recursDaily so the reconciled server row matches (server defaults false).
            recurs_daily: request.recursDaily ?? false,
            active: true,
            created_at: new Date().toISOString(),
            _optimistic: true,
          };
          set((state) => ({ meetingPoints: [optimisticMp as CrewMeetingPoint, ...state.meetingPoints] }));
        },
      });
      // Offline: placeholder already inserted; return it (don't re-insert).
      if (optimisticMp) return optimisticMp;
      const { meetingPoint } = res as { meetingPoint: CrewMeetingPoint };
      set((state) => ({ meetingPoints: [meetingPoint, ...state.meetingPoints] }));
      return meetingPoint;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to add meeting point');
      set({ error: message });
      throw err;
    }
  },

  // PUT /crews/:crewId/meeting-points/:mpId -> { meetingPoint }.
  // Offline, api.put queues the write and returns the SYNTHETIC optimistic shape
  // `{ ...request, _optimistic: true }` — NOT the server's { meetingPoint }
  // envelope. Destructuring `{ meetingPoint }` from that wrote `undefined` into
  // the list (latent bug). Detect the optimistic result and instead MERGE the
  // request body onto the existing meeting point (camelCase request → snake_case
  // stored fields), mirroring savePick / createMeetingPoint's optimistic pattern,
  // so the edit shows immediately and reconciles cleanly when the PUT replays.
  updateMeetingPoint: async (crewId: string, mpId: string, request: UpdateCrewMeetingPointRequest) => {
    set({ error: null });
    try {
      const res = await api.put<
        { meetingPoint: CrewMeetingPoint } | (UpdateCrewMeetingPointRequest & { _optimistic: true })
      >(`/crews/${crewId}/meeting-points/${mpId}`, request);

      // Offline: synthetic optimistic result — merge the request fields onto the
      // current entity (only the keys actually present in the request).
      //
      // PARTIAL-MERGE CONTRACT: the merge is intentionally explicit (per-key)
      // rather than `{ ...m, ...request }` — that would (a) write camelCase
      // request keys (meetAt/stageReference) alongside the snake_case stored
      // ones, and (b) blow away fields the request didn't touch. The cost of
      // being correct here is that the optimistic entity keeps the OLD values of
      // any SERVER-computed fields it can't know (e.g. `updated_at`) until the
      // queued PUT replays. That is by design: `_optimistic: true` stays set, and
      // when the PUT replays the queue's reload-dedup (loadMeetingPoints →
      // dropOptimistic) replaces this whole row with the authoritative server
      // entity. Consumers that show staleness should prefer the server row once
      // `_optimistic` clears; do NOT trust server-derived fields on an
      // `_optimistic` meeting point.
      if (res && (res as { _optimistic?: boolean })._optimistic) {
        let merged: CrewMeetingPoint | null = null;
        set((state) => ({
          meetingPoints: state.meetingPoints.map((m) => {
            if (m.id !== mpId) return m;
            merged = {
              ...m,
              ...(request.label !== undefined ? { label: request.label } : {}),
              ...(request.location !== undefined ? { location: request.location } : {}),
              ...(request.type !== undefined ? { type: request.type } : {}),
              ...(request.meetAt !== undefined ? { meet_at: request.meetAt } : {}),
              ...(request.stageReference !== undefined ? { stage_reference: request.stageReference } : {}),
              ...(request.latitude !== undefined ? { latitude: request.latitude } : {}),
              ...(request.longitude !== undefined ? { longitude: request.longitude } : {}),
              ...(request.recursDaily !== undefined ? { recurs_daily: request.recursDaily } : {}),
            };
            return merged;
          }),
        }));
        // Return the merged entity (or a best-effort synthetic if it wasn't in
        // the list) so callers always get a CrewMeetingPoint, never undefined.
        return (
          merged ?? {
            id: mpId,
            crew_id: crewId,
            created_by: '',
            label: request.label ?? '',
            location: request.location ?? '',
            type: request.type ?? 'custom',
            meet_at: request.meetAt ?? null,
            stage_reference: request.stageReference ?? null,
            latitude: request.latitude ?? null,
            longitude: request.longitude ?? null,
            recurs_daily: request.recursDaily ?? false,
            active: true,
            created_at: new Date().toISOString(),
            _optimistic: true,
          }
        );
      }

      // Online: authoritative { meetingPoint } envelope.
      const { meetingPoint } = res as { meetingPoint: CrewMeetingPoint };
      set((state) => ({
        meetingPoints: state.meetingPoints.map((m) => (m.id === mpId ? meetingPoint : m)),
      }));
      return meetingPoint;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to update meeting point');
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/meeting-points/:mpId.
  // Offline, api.delete queues the write and resolves with a synthetic success
  // ({ ok: true, _optimistic: true }) rather than throwing, so the optimistic
  // removal below runs in both the online and offline paths — the deleted point
  // disappears immediately and the queued DELETE replays on reconnect.
  deleteMeetingPoint: async (crewId: string, mpId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/meeting-points/${mpId}`);
      set((state) => ({
        meetingPoints: state.meetingPoints.filter((m) => m.id !== mpId),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to remove meeting point');
      set({ error: message });
      throw err;
    }
  },

  // ── Packing board (M2 logistics) ───────────────────────────────
  // GET /crews/:crewId/packing -> { items }. Drop any lingering optimistic
  // placeholders so a refetch can't duplicate an offline-created item.
  loadPacking: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<{ items: CrewPackingItem[] } | CrewPackingItem[]>(`/crews/${crewId}/packing`);
      const items = Array.isArray(res) ? res : (res?.items ?? []);
      set({ packingItems: dropOptimistic(items) });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load packing list');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/packing -> { item }. Offline: queue + insert an optimistic
  // placeholder so it renders immediately; the reconciler swaps it for the real
  // item once the queued POST replays. Mirrors createPoll / createMeetingPoint.
  createPackingItem: async (crewId: string, request: CreateCrewPackingItemRequest) => {
    set({ error: null });
    try {
      let optimisticItem: CrewPackingItem | null = null;
      const res = await api.post<
        { item: CrewPackingItem } | (CreateCrewPackingItemRequest & { id: string; _optimistic: true })
      >(`/crews/${crewId}/packing`, request, {
        onOptimisticCreate: (result) => {
          const r = result as { id: string };
          optimisticItem = {
            id: r.id,
            crew_id: crewId,
            created_by: '',
            label: request.label,
            brought_by: request.broughtBy ?? null,
            claimed: request.claimed === true,
            created_at: new Date().toISOString(),
            _optimistic: true,
          };
          set((state) => ({ packingItems: [optimisticItem as CrewPackingItem, ...state.packingItems] }));
        },
      });
      // Offline: placeholder already inserted; return it (don't re-insert).
      if (optimisticItem) return optimisticItem;
      const { item } = res as { item: CrewPackingItem };
      set((state) => ({ packingItems: [item, ...state.packingItems] }));
      return item;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to add packing item');
      set({ error: message });
      throw err;
    }
  },

  // PUT /crews/:crewId/packing/:itemId -> { item }. Offline, api.put queues the
  // write and returns the SYNTHETIC optimistic shape `{ ...request, _optimistic }`
  // — NOT the server's { item } envelope — so detect it and MERGE the request
  // fields onto the existing item (camelCase request → snake_case stored fields),
  // mirroring updateMeetingPoint, so the claim/edit shows immediately and
  // reconciles cleanly when the PUT replays.
  updatePackingItem: async (crewId: string, itemId: string, request: UpdateCrewPackingItemRequest) => {
    set({ error: null });
    try {
      const res = await api.put<{ item: CrewPackingItem } | (UpdateCrewPackingItemRequest & { _optimistic: true })>(
        `/crews/${crewId}/packing/${itemId}`,
        request,
      );

      // Offline: synthetic optimistic result — merge the request fields onto the
      // current entity (only the keys actually present in the request).
      if (res && (res as { _optimistic?: boolean })._optimistic) {
        let merged: CrewPackingItem | null = null;
        set((state) => ({
          packingItems: state.packingItems.map((it) => {
            if (it.id !== itemId) return it;
            merged = {
              ...it,
              ...(request.label !== undefined ? { label: request.label } : {}),
              ...(request.broughtBy !== undefined ? { brought_by: request.broughtBy } : {}),
              ...(request.claimed !== undefined ? { claimed: request.claimed } : {}),
            };
            return merged;
          }),
        }));
        return (
          merged ?? {
            id: itemId,
            crew_id: crewId,
            created_by: '',
            label: request.label ?? '',
            brought_by: request.broughtBy ?? null,
            claimed: request.claimed === true,
            created_at: new Date().toISOString(),
            _optimistic: true,
          }
        );
      }

      // Online: authoritative { item } envelope.
      const { item } = res as { item: CrewPackingItem };
      set((state) => ({
        packingItems: state.packingItems.map((it) => (it.id === itemId ? item : it)),
      }));
      return item;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to update packing item');
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/packing/:itemId. Offline, api.delete queues the write
  // and resolves with a synthetic success rather than throwing, so the optimistic
  // removal runs in both paths and the queued DELETE replays on reconnect.
  deletePackingItem: async (crewId: string, itemId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/packing/${itemId}`);
      set((state) => ({
        packingItems: state.packingItems.filter((it) => it.id !== itemId),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to remove packing item');
      set({ error: message });
      throw err;
    }
  },

  // ── Ride board (M2 logistics) ──────────────────────────────────
  // GET /crews/:crewId/rides -> { offers }. Drop any lingering optimistic
  // placeholders so a refetch can't duplicate an offline-created offer.
  loadRides: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<{ offers: CrewRideOffer[] } | CrewRideOffer[]>(`/crews/${crewId}/rides`);
      const offers = Array.isArray(res) ? res : (res?.offers ?? []);
      set({ rideOffers: dropOptimistic(offers) });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load ride board');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/rides -> { offer }. Offline: queue + insert an optimistic
  // placeholder so it renders immediately; the reconciler swaps it for the real
  // offer once the queued POST replays. Mirrors createPackingItem.
  createRideOffer: async (crewId: string, request: CreateCrewRideOfferRequest) => {
    set({ error: null });
    try {
      let optimisticOffer: CrewRideOffer | null = null;
      const res = await api.post<
        { offer: CrewRideOffer } | (CreateCrewRideOfferRequest & { id: string; _optimistic: true })
      >(`/crews/${crewId}/rides`, request, {
        onOptimisticCreate: (result) => {
          const r = result as { id: string };
          optimisticOffer = {
            id: r.id,
            crew_id: crewId,
            created_by: '',
            driver: request.driver ?? null,
            seats: request.seats ?? null,
            depart_from: request.departFrom ?? null,
            depart_at: request.departAt ?? null,
            note: request.note ?? null,
            created_at: new Date().toISOString(),
            _optimistic: true,
          };
          set((state) => ({ rideOffers: [optimisticOffer as CrewRideOffer, ...state.rideOffers] }));
        },
      });
      // Offline: placeholder already inserted; return it (don't re-insert).
      if (optimisticOffer) return optimisticOffer;
      const { offer } = res as { offer: CrewRideOffer };
      set((state) => ({ rideOffers: [offer, ...state.rideOffers] }));
      return offer;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to add ride offer');
      set({ error: message });
      throw err;
    }
  },

  // PUT /crews/:crewId/rides/:offerId -> { offer }. Offline, api.put queues the
  // write and returns the SYNTHETIC optimistic shape `{ ...request, _optimistic }`
  // — NOT the server's { offer } envelope — so detect it and MERGE the request
  // fields onto the existing offer (camelCase request → snake_case stored fields),
  // mirroring updatePackingItem, so the edit shows immediately and reconciles
  // cleanly when the PUT replays.
  updateRideOffer: async (crewId: string, offerId: string, request: UpdateCrewRideOfferRequest) => {
    set({ error: null });
    try {
      const res = await api.put<{ offer: CrewRideOffer } | (UpdateCrewRideOfferRequest & { _optimistic: true })>(
        `/crews/${crewId}/rides/${offerId}`,
        request,
      );

      // Offline: synthetic optimistic result — merge the request fields onto the
      // current entity (only the keys actually present in the request).
      if (res && (res as { _optimistic?: boolean })._optimistic) {
        let merged: CrewRideOffer | null = null;
        set((state) => ({
          rideOffers: state.rideOffers.map((o) => {
            if (o.id !== offerId) return o;
            merged = {
              ...o,
              ...(request.driver !== undefined ? { driver: request.driver } : {}),
              ...(request.seats !== undefined ? { seats: request.seats } : {}),
              ...(request.departFrom !== undefined ? { depart_from: request.departFrom } : {}),
              ...(request.departAt !== undefined ? { depart_at: request.departAt } : {}),
              ...(request.note !== undefined ? { note: request.note } : {}),
            };
            return merged;
          }),
        }));
        return (
          merged ?? {
            id: offerId,
            crew_id: crewId,
            created_by: '',
            driver: request.driver ?? null,
            seats: request.seats ?? null,
            depart_from: request.departFrom ?? null,
            depart_at: request.departAt ?? null,
            note: request.note ?? null,
            created_at: new Date().toISOString(),
            _optimistic: true,
          }
        );
      }

      // Online: authoritative { offer } envelope.
      const { offer } = res as { offer: CrewRideOffer };
      set((state) => ({
        rideOffers: state.rideOffers.map((o) => (o.id === offerId ? offer : o)),
      }));
      return offer;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to update ride offer');
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/rides/:offerId. Offline, api.delete queues the write
  // and resolves with a synthetic success rather than throwing, so the optimistic
  // removal runs in both paths and the queued DELETE replays on reconnect.
  deleteRideOffer: async (crewId: string, offerId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/rides/${offerId}`);
      set((state) => ({
        rideOffers: state.rideOffers.filter((o) => o.id !== offerId),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to remove ride offer');
      set({ error: message });
      throw err;
    }
  },

  // ── Member status (M5: last-synced on-my-way / ETA) ────────────
  // GET /crews/:crewId/status -> { statuses }. This is a DEGRADED-SYNC snapshot
  // list, NOT live GPS — consumers render each row's `updated_at` as honest
  // staleness ("as of N ago" via formatStaleness), never as real-time.
  loadStatuses: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<{ statuses: CrewMemberStatus[] } | CrewMemberStatus[]>(`/crews/${crewId}/status`);
      const statuses = Array.isArray(res) ? res : (res?.statuses ?? []);
      // Reload-dedup: drop any lingering optimistic placeholder so an offline
      // self-update isn't duplicated once the authoritative list arrives.
      set({ crewStatuses: dropOptimistic(statuses) });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load crew status');
      set({ error: message });
      throw err;
    }
  },

  // PUT /crews/:crewId/status -> { status }. Upserts MY OWN status (one row per
  // member). Offline-degraded: api.put queues the write with a DETERMINISTIC
  // clientId (`status-<crewId>-<userId>`) so repeated offline toggles collapse
  // into the latest, replay-safe value — captured offline, delivered on a
  // signal blip. Optimistically upserts my row locally (replacing any prior one)
  // so the change shows immediately; `updated_at` is set to now so my own
  // staleness reads honestly until the server confirms. Never implies live.
  updateMyStatus: async (crewId: string, request: UpdateCrewMemberStatusRequest, myUserId: string) => {
    set({ error: null });
    // Snapshot before the optimistic upsert so an online server rejection can
    // restore the pre-update list (the offline path returns successfully below
    // and never reaches the catch, so this only ever rolls back a real reject).
    // Captured inside the updater since this store creator only exposes `set`.
    let prevStatuses: CrewMemberStatus[] = [];
    // Optimistically upsert my own row up front (covers both online + offline).
    const nowIso = new Date().toISOString();
    set((state) => {
      prevStatuses = state.crewStatuses;
      const mine = state.crewStatuses.find((s) => s.user_id === myUserId);
      // 055: optimistically reflect the breadcrumb only when a position is
      // supplied. Omitting `position` must leave the prior coords untouched
      // (mirrors the server COALESCE) — so fall back to my existing row's values.
      const pos = request.position;
      const merged: CrewMemberStatus = {
        crew_id: crewId,
        user_id: myUserId,
        status: request.status ?? null,
        target_meeting_point_id: request.targetMeetingPointId ?? null,
        eta_minutes: request.etaMinutes ?? null,
        note: request.note ?? null,
        latitude: pos ? pos.lat : (mine?.latitude ?? null),
        longitude: pos ? pos.lng : (mine?.longitude ?? null),
        location_captured_at: pos ? (pos.capturedAt ?? nowIso) : (mine?.location_captured_at ?? null),
        updated_at: nowIso,
        // Preserve my joined display fields if I already had a row.
        username: mine?.username,
        name: mine?.name,
        avatar_key: mine?.avatar_key,
        avatar_version: mine?.avatar_version,
        _optimistic: true,
      };
      const others = state.crewStatuses.filter((s) => s.user_id !== myUserId);
      return { crewStatuses: [merged, ...others] };
    });
    try {
      const res = await api.put<{ status: CrewMemberStatus } | (UpdateCrewMemberStatusRequest & { _optimistic: true })>(
        `/crews/${crewId}/status`,
        request,
        {
          // Deterministic clientId collapses repeated offline toggles into one
          // pending write keyed on (crew, user).
          clientId: `PUT:/crews/${crewId}/status:status-${crewId}-${myUserId}`,
          offlineLabel: 'Update my crew status',
        },
      );
      // Offline: the synthetic `{ ...request, _optimistic: true }` is already
      // reflected by the optimistic upsert above — nothing more to do.
      if (res && (res as { _optimistic?: boolean })._optimistic) return;
      // Online: replace my optimistic row with the authoritative server row.
      const { status } = res as { status: CrewMemberStatus };
      if (status && typeof status.user_id === 'string') {
        set((state) => {
          const others = state.crewStatuses.filter((s) => s.user_id !== status.user_id);
          return { crewStatuses: [{ ...status, _optimistic: false }, ...others] };
        });
      }
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to update status');
      // Roll back the optimistic upsert so the user never keeps seeing a status
      // the server rejected. Only reached on an ONLINE reject (the offline path
      // returns above without throwing).
      set({ crewStatuses: prevStatuses, error: message });
      throw err;
    }
  },

  // ── Expenses ───────────────────────────────────────────────────
  // GET /crews/:crewId/expenses -> array (api unwraps the data envelope).
  // Fetches the expense list AND the balance ledger together so one call
  // populates the whole tab; the mutations below re-call this to refresh.
  loadExpenses: async (crewId: string) => {
    set({ error: null });
    try {
      const res = await api.get<CrewExpense[] | { expenses: CrewExpense[] }>(`/crews/${crewId}/expenses`);
      const expenses = Array.isArray(res) ? res : (res?.expenses ?? []);
      // Reload-dedup: discard lingering optimistic placeholders so an
      // offline-created expense isn't duplicated once the server list arrives.
      set({ expenses: dropOptimistic(expenses) });
      await loadBalances(set, crewId);
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load expenses');
      set({ error: message });
      throw err;
    }
  },

  // POST /crews/:crewId/expenses, then refetch so the server-resolved split +
  // balances stay authoritative (mirrors the web ExpensesTab invalidation).
  // Offline: queue + insert an optimistic expense so it renders immediately, and
  // SKIP the refetch (a GET would fail offline). We deliberately do NOT fake the
  // balance ledger — balances reconcile on the next online loadExpenses, which
  // also drops the optimistic placeholder (dropOptimistic). The reconciler
  // removes the placeholder when the queued POST replays.
  addExpense: async (crewId: string, request: CreateCrewExpenseRequest) => {
    set({ error: null });
    try {
      let wasOptimistic = false;
      await api.post(`/crews/${crewId}/expenses`, request, {
        onOptimisticCreate: (result) => {
          wasOptimistic = true;
          const r = result as { id: string };
          const optimisticExpense: CrewExpense = {
            id: r.id,
            crew_id: crewId,
            paid_by: '',
            paid_by_name: '',
            description: request.description,
            amount: request.amount,
            split_with: request.splitWith,
            category: request.category,
            planned: request.planned === true,
            created_at: new Date().toISOString(),
            _optimistic: true,
          };
          set((state) => ({ expenses: [optimisticExpense, ...state.expenses] }));
        },
      });
      // Offline: placeholder inserted; balances reconcile on the next online sync.
      if (wasOptimistic) return;
      await useCrewStore.getState().loadExpenses(crewId);
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to add expense');
      set({ error: message });
      throw err;
    }
  },

  // DELETE /crews/:crewId/expenses/:id, then refetch.
  removeExpense: async (crewId: string, expenseId: string) => {
    set({ error: null });
    try {
      await api.delete(`/crews/${crewId}/expenses/${expenseId}`);
      set((state) => ({
        expenses: state.expenses.filter((e) => e.id !== expenseId),
      }));
      try {
        await useCrewStore.getState().loadExpenses(crewId);
      } catch {
        /* refetch is best-effort; the write succeeded */
      }
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to remove expense');
      set({ error: message });
      throw err;
    }
  },

  settleExpense: async (crewId: string, request: SettleCrewExpenseRequest) => {
    set({ error: null });
    try {
      await api.post(`/crews/${crewId}/expenses/settle`, request);
      try {
        await useCrewStore.getState().loadExpenses(crewId);
      } catch {
        /* refetch is best-effort; the write succeeded */
      }
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to settle up');
      set({ error: message });
      throw err;
    }
  },

  // ── Activity feed ──────────────────────────────────────────────
  // GET /crews/:crewId/activity -> array of crew events.
  loadActivity: async (crewId: string) => {
    set({ error: null });
    try {
      // Server returns { items, nextCursor } (paginated). Accept a bare array
      // or { activity } too, in case the shape changes.
      const res = await api.get<
        | CrewActivityEntry[]
        | { items: CrewActivityEntry[]; nextCursor?: string | null }
        | { activity: CrewActivityEntry[] }
      >(`/crews/${crewId}/activity`);
      const activity = Array.isArray(res) ? res : (('items' in res ? res.items : res.activity) ?? []);
      set({ activity });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load activity');
      set({ error: message });
      throw err;
    }
  },

  // ── Home base ──────────────────────────────────────────────────
  // PUT /crews/:crewId/home-base -> { crew }. Owner-only server-side. Merge the
  // returned crew so activeCrew/crews reflect the new home base immediately.
  updateHomeBase: async (crewId: string, payload: { location: string | null; time: string | null }) => {
    set({ error: null });
    try {
      const { crew } = await api.put<{ crew: Crew }>(`/crews/${crewId}/home-base`, payload);
      set((state) => ({
        activeCrew: state.activeCrew?.id === crewId ? { ...state.activeCrew, ...crew } : state.activeCrew,
        crews: state.crews.map((c) => (c.id === crewId ? { ...c, ...crew } : c)),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to update home base');
      set({ error: message });
      throw err;
    }
  },

  // ── Photo album (M6 Crew Photo Wall, Phase 1 link-out) ─────────
  // PUT /crews/:crewId/photo-album -> { crew }. Member-gated server-side. Merge
  // the returned crew so activeCrew/crews reflect the new album URL immediately.
  updatePhotoAlbum: async (crewId: string, payload: { photoAlbumUrl: string | null }) => {
    set({ error: null });
    try {
      const { crew } = await api.put<{ crew: Crew }>(`/crews/${crewId}/photo-album`, payload);
      set((state) => ({
        activeCrew: state.activeCrew?.id === crewId ? { ...state.activeCrew, ...crew } : state.activeCrew,
        crews: state.crews.map((c) => (c.id === crewId ? { ...c, ...crew } : c)),
      }));
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to update photo album');
      set({ error: message });
      throw err;
    }
  },

  // M6: merge a remote photo-album change onto the active crew + crews list.
  applyPhotoAlbumUpdate: (crewId: string, payload: { photoAlbumUrl: string | null }) => {
    set((state) => ({
      activeCrew:
        state.activeCrew?.id === crewId
          ? { ...state.activeCrew, photoAlbumUrl: payload.photoAlbumUrl }
          : state.activeCrew,
      crews: state.crews.map((c) => (c.id === crewId ? { ...c, photoAlbumUrl: payload.photoAlbumUrl } : c)),
    }));
  },

  // ── Socket-driven setters (additive) ──────────────────────────
  // Merge a remote home-base change onto the active crew + crews list. The
  // socket payload carries `location` / `time`; map them onto the serialized
  // crew's homeBaseLocation / homeBaseTime fields.
  applyHomeBaseUpdate: (crewId: string, payload: { location: string | null; time: string | null }) => {
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
        c.id === crewId ? { ...c, homeBaseLocation: payload.location, homeBaseTime: payload.time } : c,
      ),
    }));
  },

  // Insert or replace a meeting point from a remote create/update event.
  applyMeetingPointUpsert: (meetingPoint: CrewMeetingPoint) => {
    set((state) => {
      const exists = state.meetingPoints.some((m) => m.id === meetingPoint.id);
      return {
        meetingPoints: exists
          ? state.meetingPoints.map((m) => (m.id === meetingPoint.id ? meetingPoint : m))
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

  // M5: upsert a member's last-synced status from a remote crew:status-updated
  // event. One row per user — replace any prior row for that user, newest first.
  // We do NOT overwrite MY OWN locally-newer optimistic row with an older remote
  // echo: if the incoming row is for me and is not newer than what I have, skip.
  applyStatusUpdate: (status: CrewMemberStatus) => {
    if (!status || typeof status.user_id !== 'string') return;
    set((state) => {
      const existing = state.crewStatuses.find((s) => s.user_id === status.user_id);
      // Last-write-wins by timestamp so a delayed echo can't clobber a newer
      // local update (e.g. my own optimistic row that hasn't synced yet).
      if (existing) {
        const incomingMs = new Date(status.updated_at).getTime();
        const existingMs = new Date(existing.updated_at).getTime();
        if (Number.isFinite(existingMs) && Number.isFinite(incomingMs) && incomingMs < existingMs) {
          return {};
        }
      }
      const others = state.crewStatuses.filter((s) => s.user_id !== status.user_id);
      return { crewStatuses: [{ ...status, _optimistic: false }, ...others] };
    });
  },

  setError: (error: string | null) => {
    set({ error });
  },
});

export const useCrewStore = create<CrewStore>()(
  persist(crewStore, {
    name: 'festie-crew',
    // v2 (M5): added the persisted `crewStatuses` read-cache. Old v1 blobs lack
    // the key; the migrate below backfills it to an empty list so a rehydrate
    // from v1 never yields `crewStatuses: undefined`.
    version: 2,
    storage: createJSONStorage(() => getStorage()),
    // Persist ONLY the read-cache for the active crew so a cold start with no
    // signal (the festival condition) renders the crew's members / meeting
    // points / polls / expenses / activity instantly; selectCrew revalidates
    // when online. `crews` is the user's crew list (small, lets the picker
    // render offline). `crewOverlap` and all loading/error flags are NOT
    // persisted (transient / re-fetched on reconnect). Lists are bounded so the
    // blob stays small (see MAX_CACHED_* above).
    partialize: (state) => ({
      crews: state.crews,
      activeCrew: state.activeCrew,
      crewMembers: state.crewMembers,
      meetingPoints: state.meetingPoints,
      polls: state.polls.slice(0, MAX_CACHED_POLLS),
      packingItems: state.packingItems.slice(0, MAX_CACHED_PACKING),
      rideOffers: state.rideOffers.slice(0, MAX_CACHED_RIDES),
      crewStatuses: state.crewStatuses.slice(0, MAX_CACHED_STATUSES),
      expenses: state.expenses.slice(0, MAX_CACHED_EXPENSES),
      expenseBalances: state.expenseBalances,
      settlements: state.settlements,
      activity: state.activity.slice(0, MAX_CACHED_ACTIVITY),
      _cachedAt: state._cachedAt,
      _cachedCrewId: state._cachedCrewId,
    }),
    // v1 → v2: backfill the new `crewStatuses` read-cache so a rehydrate from a
    // v1 blob (which lacks the key) never yields `undefined`. Other fields are
    // carried through unchanged.
    migrate: (persistedState, version) => {
      const s = (persistedState ?? {}) as Partial<CrewStore>;
      if (version < 2 && !Array.isArray(s.crewStatuses)) {
        return { ...s, crewStatuses: [] } as CrewStore;
      }
      return s as CrewStore;
    },
  }),
);

// ── Offline create reconciliation (Phase 2) ────────────────────────────────
// When a queued offline POST replays successfully on reconnect, the offline
// queue calls this with the temp clientId (which is the optimistic entity's id)
// and the authoritative server response. We REPLACE the optimistic placeholder
// (matched by id === clientId) with the real entity so exactly one entity
// remains — no duplicate, no lingering _optimistic. The route is inferred from
// the clientId (format: `POST:/crews/:id/<resource>...:uuid`).
//
// Idempotent + safe by construction: the match is keyed on the temp clientId,
// which the server never reuses, so this can only ever touch OUR placeholder.
// If the response shape is unexpected (or the placeholder is already gone, e.g.
// a prior reload-dedup ran), we simply drop the placeholder by id; the next
// authoritative load* then carries the real entity. This never double-inserts.
registerCreateReconciler((clientId, serverResponse) => {
  const res = serverResponse as Record<string, unknown> | null | undefined;

  // Offline crew join: clientId is `POST:/crews/join:join-<inviteCode>`. The
  // POST /crews/join response is the joined crew itself (no envelope). Swap the
  // optimistic placeholder crew (matched by id === clientId) for the real crew.
  // Checked BEFORE the resource branches below since none of them match a bare
  // `/crews/join` clientId.
  if (clientId.includes('/crews/join')) {
    const crew = (res?.crew ?? res) as Crew | undefined;
    useCrewStore.setState((state) => {
      const hasTemp = state.crews.some((c) => c.id === clientId);
      if (!hasTemp) return {};
      const real: Crew | null = crew && typeof crew.id === 'string' ? { ...crew, _optimistic: false } : null;
      const withoutTemp = state.crews.filter((c) => c.id !== clientId);
      // Guard against the real crew already being present (e.g. a concurrent
      // loadCrews landed it) so we never end up with two copies.
      const realAlreadyPresent = real ? withoutTemp.some((c) => c.id === real.id) : false;
      return { crews: real && !realAlreadyPresent ? [...withoutTemp, real] : withoutTemp };
    });
    return;
  }

  if (clientId.includes('/polls')) {
    const poll = (res?.poll ?? res) as CrewPoll | undefined;
    useCrewStore.setState((state) => {
      const temp = state.polls.find((p) => p.id === clientId);
      if (!temp) return {};
      // Carry the client-only schedule-aware linkage forward onto the real poll
      // (the server never echoes `_setRefs`), so close still spawns the meeting
      // point + reminder after an offline-created poll reconciles.
      const real: CrewPoll | null =
        poll && typeof poll.id === 'string'
          ? {
              ...poll,
              votes: poll.votes ?? [],
              _optimistic: false,
              ...(temp._setRefs ? { _setRefs: temp._setRefs } : {}),
            }
          : null;
      const withoutTemp = state.polls.filter((p) => p.id !== clientId);
      // Guard against a real entity that somehow already arrived (e.g. via a
      // socket applyPollCreated) so we never end up with two copies.
      const realAlreadyPresent = real ? withoutTemp.some((p) => p.id === real.id) : false;
      return { polls: real && !realAlreadyPresent ? [real, ...withoutTemp] : withoutTemp };
    });
    return;
  }

  if (clientId.includes('/meeting-points')) {
    const mp = (res?.meetingPoint ?? res) as CrewMeetingPoint | undefined;
    useCrewStore.setState((state) => {
      const hasTemp = state.meetingPoints.some((m) => m.id === clientId);
      if (!hasTemp) return {};
      const real: CrewMeetingPoint | null = mp && typeof mp.id === 'string' ? { ...mp, _optimistic: false } : null;
      const withoutTemp = state.meetingPoints.filter((m) => m.id !== clientId);
      const realAlreadyPresent = real ? withoutTemp.some((m) => m.id === real.id) : false;
      return { meetingPoints: real && !realAlreadyPresent ? [real, ...withoutTemp] : withoutTemp };
    });
    return;
  }

  if (clientId.includes('/packing')) {
    const item = (res?.item ?? res) as CrewPackingItem | undefined;
    useCrewStore.setState((state) => {
      const hasTemp = state.packingItems.some((it) => it.id === clientId);
      if (!hasTemp) return {};
      const real: CrewPackingItem | null = item && typeof item.id === 'string' ? { ...item, _optimistic: false } : null;
      const withoutTemp = state.packingItems.filter((it) => it.id !== clientId);
      const realAlreadyPresent = real ? withoutTemp.some((it) => it.id === real.id) : false;
      return { packingItems: real && !realAlreadyPresent ? [real, ...withoutTemp] : withoutTemp };
    });
    return;
  }

  if (clientId.includes('/rides')) {
    const offer = (res?.offer ?? res) as CrewRideOffer | undefined;
    useCrewStore.setState((state) => {
      const hasTemp = state.rideOffers.some((o) => o.id === clientId);
      if (!hasTemp) return {};
      const real: CrewRideOffer | null =
        offer && typeof offer.id === 'string' ? { ...offer, _optimistic: false } : null;
      const withoutTemp = state.rideOffers.filter((o) => o.id !== clientId);
      const realAlreadyPresent = real ? withoutTemp.some((o) => o.id === real.id) : false;
      return { rideOffers: real && !realAlreadyPresent ? [real, ...withoutTemp] : withoutTemp };
    });
    return;
  }

  if (clientId.includes('/expenses')) {
    // Expenses: the POST response shape isn't relied upon (server resolves the
    // split + balance ledger). Just remove the placeholder; the next online
    // loadExpenses brings the real expense AND the authoritative balances.
    useCrewStore.setState((state) => {
      const hasTemp = state.expenses.some((e) => e.id === clientId);
      return hasTemp ? { expenses: state.expenses.filter((e) => e.id !== clientId) } : {};
    });
    return;
  }
});
