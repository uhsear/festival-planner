import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { mapErrorToUserMessage } from '../services/errors';
import { isOffline } from '../services/offlineQueue';
import { getStorage } from '../platform/storage';
import { useAuthStore } from './authStore';

// Offline helper -- api.put now owns offline interception: when offline AND the
// path is replay-eligible (`/profiles/...` is), api routes the PUT into the
// platform queue (web's IndexedDB bridge or the RN queue) and returns a
// synthetic optimistic result, so the optimistic pick/note survives instead of
// failing. clientId stays deterministic so multiple offline toggles of the same
// field collapse to one replayed PUT (the queue upserts by clientId). When
// online it's a plain PUT. No double-queue: api is the single queue gateway.
async function offlinePut(url: string, body: unknown, clientId: string): Promise<void> {
  await api.put(url, body, { clientId, offlineLabel: 'Update picks' });
}

/**
 * Retry a read on transient failures (network errors / 5xx) with exponential
 * backoff. Skips retrying when we're known-offline so the UI falls back to the
 * persisted (cached) schedule quickly instead of stalling.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { isNetworkError?: boolean; status?: number };
      const retryable = !isOffline() && (e.isNetworkError === true || (e.status ?? 0) >= 500);
      if (!retryable || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
      attempt++;
    }
  }
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
  SaveReminderRequest,
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
  // ── Offline read-cache bookkeeping (persisted) ──────────────────
  // `_festivalCachedAt` is the epoch-ms when the selected festival last loaded
  // successfully — a "synced N ago" freshness chip reads it. `_profilesCachedAt`
  // is when `allProfiles` was last persisted. `_cachedFestivalId` records which
  // festival the persisted `allProfiles` snapshot belongs to, mirroring
  // crewStore._cachedCrewId, so a different festival's crew picks never bleed
  // into the digest/overlap views on a cold offline start.
  _festivalCachedAt: number | null;
  _profilesCachedAt: number | null;
  _cachedFestivalId: string | null;
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
  /**
   * Bulk-apply ONE priority to many sets in a single coalesced write (M2 bulk
   * pick helpers). Merges every `setId` into the current profile's picks map and
   * issues exactly ONE `offlinePut` to `/profiles/:id` — never N writes. Reuses
   * the deterministic-clientId coalescing (`bulk-<profileId>`) so repeated bulk
   * applies offline collapse to one replayed PUT whose body is the latest map.
   * Offline-native + queued, mirroring savePick's optimistic-then-PUT path.
   * Never DOWNGRADES an existing stronger pick (must > want > maybe): a set
   * already at a higher priority is left untouched; only unpicked sets and
   * weaker picks are written. Resolves to the REAL number of sets changed (0
   * when nothing changed) so callers can report a truthful "Added N" instead of
   * `setIds.length`. A no-op (no write) when nothing actually changes.
   */
  bulkSavePicks: (setIds: string[], priority: Priority) => Promise<number>;
  removePick: (festivalId: string, setId: string) => Promise<void>;
  saveNote: (request: SaveNoteRequest) => Promise<void>;
  saveReminder: (request: SaveReminderRequest) => Promise<void>;
  setError: (error: string | null) => void;
}

export type FestivalDataStore = FestivalDataState & FestivalDataActions;

// ── Persisted allProfiles snapshot bounds (F1) ─────────────────────────────
// allProfiles powers crew-overlap / crew-digest / grid-overlap, which render
// EMPTY on a cold offline start unless persisted. We persist a BOUNDED,
// crew-scoped snapshot keyed by `_cachedFestivalId`: only the fields those
// views read ({ id, userId, name, picks }) — never notes/reminders/etag — and
// capped to MAX_CACHED_PROFILES so a large festival can't bloat the blob.
const MAX_CACHED_PROFILES = 60;

/** Strip a profile down to the crew-overlap/digest essentials for persistence. */
function slimProfileForCache(p: Profile): Pick<Profile, 'id' | 'userId' | 'name' | 'picks'> {
  return { id: p.id, userId: p.userId, name: p.name, picks: p.picks };
}

let _lastSelectFestivalId: string | null = null;

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
  _festivalCachedAt: null,
  _profilesCachedAt: null,
  _cachedFestivalId: null,

  loadFestivals: async () => {
    set({ isLoading: true, error: null });
    try {
      const festivals = await withRetry(() => api.get<Festival[]>('/festivals'));
      set({ festivals, isLoading: false });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load festivals');
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  // FIX: Single GET /festivals/:id returns stages + days (with nested sets).
  //      Profiles come from GET /profiles/:festivalId (separate endpoint).
  //      Removed 3 phantom sub-resource fetches (/sets, /stages, /days).
  selectFestival: async (festivalId: string) => {
    _lastSelectFestivalId = festivalId;
    set({ isLoading: true, error: null, currentFestivalId: festivalId });
    try {
      // Festival detail is public; profiles require auth (401 for guests).
      const detail = await withRetry(() => api.get<FestivalDetailResponse>(`/festivals/${festivalId}`));
      let profiles: Profile[] = [];
      let profilesFetchFailed = false;
      if (useAuthStore.getState().user) {
        try {
          profiles = await api.get<Profile[]>(`/profiles/${festivalId}`);
        } catch (_) {
          // Offline (the /profiles endpoint is not service-worker-cached) or a
          // session blip. Don't trust the empty list — see currentProfile below.
          profilesFetchFailed = true;
        }
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

      // Find the current user's profile from the loaded profiles. When the
      // profiles fetch failed (offline — /festivals is SW-cached but /profiles is
      // not), DON'T clobber the persisted profile: keep it if it belongs to this
      // festival so the user can still see and make picks with no signal. Same
      // for allProfiles (crew-scoped pick views) — preserve the persisted list.
      const userId = useAuthStore.getState().user?.id;
      const fetchedProfile = userId ? profiles.find((p) => p.userId === userId) || null : null;
      const prevState = get();
      const currentProfile =
        fetchedProfile ??
        (profilesFetchFailed && prevState.currentProfile?.festivalId === festivalId ? prevState.currentProfile : null);
      // Offline-preserve: when the /profiles fetch failed (offline / session blip)
      // keep the in-memory or rehydrated crew profiles INSTEAD of an empty list —
      // but only when they belong to THIS festival (staleness guard, mirroring
      // crewStore._cachedCrewId). A persisted snapshot from another festival must
      // never bleed into overlap/digest views.
      const preservedAllProfiles =
        profilesFetchFailed && profiles.length === 0 && prevState._cachedFestivalId === festivalId
          ? prevState.allProfiles
          : profiles;
      // Stamp the profiles cache time only when we actually hold a fresh list;
      // a preserved (stale) list keeps its prior timestamp so freshness UI stays honest.
      const profilesAreFresh = !(profilesFetchFailed && profiles.length === 0);

      if (_lastSelectFestivalId !== festivalId) {
        set({ isLoading: false });
        return;
      }

      set({
        // Re-assert the id alongside the data: an async persist rehydration
        // finishing mid-fetch can overwrite the id set at the top of this
        // action with a stale persisted value (null for a first-time guest),
        // which previously left the store in an inconsistent state and
        // bounced the user back to the festival picker.
        currentFestivalId: festivalId,
        currentFestival: festival,
        sets,
        stages,
        days,
        allProfiles: preservedAllProfiles,
        currentProfile,
        isLoading: false,
        _festivalCachedAt: Date.now(),
        _cachedFestivalId: festivalId,
        _profilesCachedAt: profilesAreFresh ? Date.now() : prevState._profilesCachedAt,
      });

      // Default the day selector to today when the festival is in progress
      // (local date matches a day), otherwise day 0. en-CA gives YYYY-MM-DD.
      const todayStr = new Date().toLocaleDateString('en-CA');
      const todayIdx = days.findIndex((d) => d.date === todayStr);

      // Reset UI state in the UI store when selecting a new festival
      useFestivalUIStore.setState({
        // Empty array = "all stages" (the schedule UI normalizes all-selected →
        // []). Storing the FULL stage-id array instead made index.tsx read a
        // PHANTOM active stage filter on every festival load — force-opening the
        // filter panel, lighting the active dot, and rendering the results-summary
        // + Clear-all chip + PhaseHomeActions on a clean load (squeezing the
        // timeline). [] keeps a fresh load filter-free.
        activeStages: [],
        selectedDay: todayIdx >= 0 ? todayIdx : 0,
      });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load festival');
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
      const currentProfile = userId ? profiles.find((p) => p.userId === userId) || null : null;
      set({
        allProfiles: profiles,
        currentProfile,
        isLoading: false,
        _profilesCachedAt: Date.now(),
        _cachedFestivalId: festivalId,
      });
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to load profiles');
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
      currentProfile: currentProfile && currentProfile.id === profileId ? updated : currentProfile,
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
      const message = mapErrorToUserMessage(err, 'Failed to save pick');
      // Roll back the optimistic update so the UI never shows a pick as saved
      // when the write actually failed (e.g. offline with no queue on mobile).
      set({ currentProfile: prev, error: message });
      throw err;
    }
  },

  // Bulk pick helper (M2): merge MANY setIds at one priority into the picks map
  // and issue exactly ONE coalesced PUT. Idempotent — if nothing actually
  // changes (all sets already at this priority-or-higher, or no setIds), we skip
  // the write entirely rather than queue a redundant replay. Returns the real
  // count of sets changed so the caller never reports "Added N" on 0 changes.
  bulkSavePicks: async (setIds: string[], priority: Priority): Promise<number> => {
    const prev = get().currentProfile;
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile -- select a festival first');
      }

      // Priority strength order so a bulk "maybe" can't silently clobber a
      // hand-set "must": must > want-to-see > maybe.
      const rank: Record<Priority, number> = { maybe: 1, 'want-to-see': 2, must: 3 };

      const basePicks = currentProfile.picks || {};
      const mergedPicks: Record<string, Priority> = { ...basePicks };
      let changed = 0;
      for (const setId of setIds) {
        const existing = mergedPicks[setId];
        // Never DOWNGRADE a stronger existing pick — only set unpicked sets or
        // upgrade a weaker one. Count only the sets we actually change.
        if (existing && rank[existing] >= rank[priority]) continue;
        mergedPicks[setId] = priority;
        changed += 1;
      }

      // Idempotent: nothing to write (empty list, or every set already at this
      // priority-or-higher). Avoids a redundant queued PUT on repeated applies.
      if (changed === 0) return 0;

      // Optimistic: reflect all merged picks locally BEFORE the network call so
      // every star fills immediately even offline (the PUT is then queued).
      set({
        currentProfile: {
          ...currentProfile,
          picks: mergedPicks,
        },
      });

      // ONE coalesced write. Deterministic clientId keyed only by profile (not
      // per-set) so repeated bulk applies collapse to a single replayed PUT
      // whose body is the latest full map — never N writes.
      await offlinePut(`/profiles/${currentProfile.id}`, { picks: mergedPicks }, `bulk-${currentProfile.id}`);
      return changed;
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to save picks');
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

      const mergedPicks = Object.fromEntries(Object.entries(currentProfile.picks).filter(([id]) => id !== setId));

      set({
        currentProfile: {
          ...currentProfile,
          picks: mergedPicks,
        },
      });

      // Same clientId as savePick so a toggle-on-then-off offline sequence
      // collapses to one PUT whose body is the latest map.
      await offlinePut(`/profiles/${currentProfile.id}`, { picks: mergedPicks }, `pick-${currentProfile.id}-${setId}`);
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to remove pick');
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
      const message = mapErrorToUserMessage(err, 'Failed to save note');
      set({ currentProfile: prev, error: message });
      throw err;
    }
  },

  // PUT /profiles/:profileId with the full reminders map (mirrors savePick).
  // The reminder backend (scheduler/FCM/DND) is live; this is the write path
  // no client previously exercised. minutes=null clears the set's reminder.
  saveReminder: async (request: SaveReminderRequest) => {
    const prev = get().currentProfile;
    set({ error: null });
    try {
      const { currentProfile } = get();
      if (!currentProfile) {
        throw new Error('No active profile -- select a festival first');
      }

      const mergedReminders: Record<string, number> = {
        ...(currentProfile.reminders || {}),
      };
      if (request.minutes != null) {
        mergedReminders[request.setId] = request.minutes;
      } else {
        delete mergedReminders[request.setId];
      }

      set({
        currentProfile: {
          ...currentProfile,
          reminders: mergedReminders,
        },
      });

      await offlinePut(
        `/profiles/${currentProfile.id}`,
        { reminders: mergedReminders },
        `reminder-${currentProfile.id}-${request.setId}`,
      );
    } catch (err) {
      const message = mapErrorToUserMessage(err, 'Failed to save reminder');
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
    // Persist the selected festival's schedule + the user's own profile so a
    // cold start with no signal (the festival condition) renders the cached
    // schedule and picks/reminders instantly; selectFestival revalidates when
    // online.
    //
    // allProfiles IS persisted now (F1) — but as a BOUNDED, crew-scoped, slimmed
    // snapshot ({ id, userId, name, picks }, capped to MAX_CACHED_PROFILES),
    // tagged with `_cachedFestivalId`. Without it crew-overlap / crew-digest /
    // grid-overlap render empty on a cold offline start. The selectFestival
    // staleness guard drops it when it belongs to a different festival, so one
    // festival's picks never bleed into another's views. Required Profile fields
    // not used by those views (notes/reminders/festivalId/updatedAt) are dropped
    // here and backfilled with empties on rehydrate to keep the type valid.
    partialize: (state) => ({
      currentFestivalId: state.currentFestivalId,
      currentFestival: state.currentFestival,
      sets: state.sets,
      stages: state.stages,
      days: state.days,
      currentProfile: state.currentProfile,
      allProfiles: state.allProfiles.slice(0, MAX_CACHED_PROFILES).map((p) => ({
        ...slimProfileForCache(p),
        // Backfill the Profile fields the overlap/digest views don't read so the
        // rehydrated array still satisfies Profile[]; revalidated on reconnect.
        festivalId: state._cachedFestivalId ?? '',
        notes: {},
        updatedAt: '',
      })),
      _festivalCachedAt: state._festivalCachedAt,
      _profilesCachedAt: state._profilesCachedAt,
      _cachedFestivalId: state._cachedFestivalId,
    }),
    // Hydration-vs-live-state guard: persist rehydrates ASYNCHRONOUSLY (the
    // AsyncStorage read), so a user can start selecting a festival BEFORE
    // hydration lands. The default merge ({...current, ...persisted}) would
    // then clobber the in-flight/just-loaded selection with the stale
    // persisted snapshot (null for a first-time guest) — bouncing the user
    // back to the picker. When the live state already has a selection that
    // the persisted blob doesn't match, keep the live selection.
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<FestivalDataState>;
      if (current.currentFestivalId && p.currentFestivalId !== current.currentFestivalId) {
        const {
          currentFestivalId: _id,
          currentFestival: _f,
          sets: _s,
          stages: _st,
          days: _d,
          currentProfile: _cp,
          allProfiles: _ap,
          _festivalCachedAt: _fca,
          _profilesCachedAt: _pca,
          _cachedFestivalId: _cfi,
          ...rest
        } = p;
        return { ...current, ...rest };
      }
      return { ...current, ...p };
    },
  }),
);
