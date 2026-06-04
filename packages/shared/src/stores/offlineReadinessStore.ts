import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { getStorage } from '../platform/storage';
import { useFestivalDataStore } from './festivalDataStore';
import { useCrewStore } from './crewStore';
import type { FestivalSet } from '../types';

// ── F5: "Download this festival for offline" keystone ──────────────────────
//
// This store is the EXPLICIT, user-driven download that makes every DURING-
// festival offline feature actually work. It does NOT re-implement any fetch:
// it ORCHESTRATES the existing loaders (selectFestival / loadProfiles /
// selectCrew + the crew sub-resource loaders) so each populates its OWN
// persisted store (festivalDataStore + crewStore zustand-persist). It then
// fetches weather + prefetches artist art so the web service worker caches the
// PUBLIC assets (see vite.config.ts runtimeCaching).
//
// Division of labor (the security guardrail, mirrored in vite.config.ts):
//   - SW caches ONLY public GETs (festivals, weather, images) — URL-keyed, so
//     a per-user endpoint would leak across accounts on a shared device.
//   - Per-user data (profiles, crew) stays in zustand-persist, scoped by the
//     existing `_cachedFestivalId` / `_cachedCrewId` staleness guards.
//
// One section failing marks ONLY that section `error`; the rest still succeed,
// so a flaky weather endpoint never blocks the schedule/picks/crew download.

export type ReadinessStatus = 'idle' | 'syncing' | 'ready' | 'error';

export interface SectionReadiness {
  status: ReadinessStatus;
  /** epoch-ms of the last successful sync of this section (null until ready). */
  syncedAt: number | null;
}

/** The five downloadable sections of a festival. */
export type ReadinessSection = 'schedule' | 'picks' | 'crew' | 'weather' | 'art';

export interface FestivalReadiness {
  schedule: SectionReadiness;
  picks: SectionReadiness;
  crew: SectionReadiness;
  weather: SectionReadiness;
  art: SectionReadiness;
}

const SECTIONS: ReadinessSection[] = ['schedule', 'picks', 'crew', 'weather', 'art'];

function emptySection(): SectionReadiness {
  return { status: 'idle', syncedAt: null };
}

function emptyReadiness(): FestivalReadiness {
  return {
    schedule: emptySection(),
    picks: emptySection(),
    crew: emptySection(),
    weather: emptySection(),
    art: emptySection(),
  };
}

// Cap how many artist images we prefetch so a huge lineup can't issue thousands
// of image requests (and the SW art cache is bounded to ~300 entries anyway).
const MAX_ART_PREFETCH = 120;

/**
 * Loaders the orchestrator drives. Defaulted to the real store actions; the
 * `deps` override exists so tests can mock every loader without a live network.
 */
export interface DownloadDeps {
  selectFestival: (festivalId: string) => Promise<void>;
  loadProfiles: (festivalId: string) => Promise<void>;
  selectCrew: (crewId: string) => Promise<void>;
  loadMeetingPoints: (crewId: string) => Promise<void>;
  loadPolls: (crewId: string) => Promise<void>;
  loadExpenses: (crewId: string) => Promise<void>;
  loadActivity: (crewId: string) => Promise<void>;
  /** Fetch weather for the festival (public GET — web SW caches it). */
  fetchWeather: (festivalId: string) => Promise<void>;
  /** Read the loaded sets so art prefetch can collect artist image URLs. */
  getSets: () => FestivalSet[];
  /** Prefetch one image URL into the (web) SW CacheFirst art cache. */
  prefetchImage: (url: string) => Promise<void>;
}

function defaultDeps(): DownloadDeps {
  return {
    selectFestival: (festivalId) => useFestivalDataStore.getState().selectFestival(festivalId),
    loadProfiles: (festivalId) => useFestivalDataStore.getState().loadProfiles(festivalId),
    selectCrew: (crewId) => useCrewStore.getState().selectCrew(crewId),
    loadMeetingPoints: (crewId) => useCrewStore.getState().loadMeetingPoints(crewId),
    loadPolls: (crewId) => useCrewStore.getState().loadPolls(crewId),
    loadExpenses: (crewId) => useCrewStore.getState().loadExpenses(crewId),
    loadActivity: (crewId) => useCrewStore.getState().loadActivity(crewId),
    fetchWeather: async (festivalId) => {
      // Public GET — issuing it primes the web SW weather cache (vite.config.ts
      // StaleWhileRevalidate). We don't store the body here; the weather UI
      // re-reads it (served from cache when offline).
      await api.get(`/weather/${festivalId}`);
    },
    getSets: () => useFestivalDataStore.getState().sets,
    prefetchImage: async (url) => {
      // Best-effort image warm: a GET routes the response into the SW CacheFirst
      // art cache. `no-store` is NOT used — we WANT the SW to cache it.
      if (typeof fetch !== 'function') return;
      await fetch(url, { mode: 'no-cors' });
    },
  };
}

/** Collect unique artist photo URLs from the loaded sets, bounded. */
export function collectArtUrls(sets: FestivalSet[], limit = MAX_ART_PREFETCH): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    for (const a of s.artists ?? []) {
      const url = a.photo;
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
        if (urls.length >= limit) return urls;
      }
    }
  }
  return urls;
}

export interface OfflineReadinessState {
  /** Per-festival readiness, keyed by festivalId. */
  byFestival: Record<string, FestivalReadiness>;
  /** The festivalId currently downloading, or null when idle. */
  downloadingFestivalId: string | null;
}

export interface OfflineReadinessActions {
  /**
   * Orchestrate a full offline download for `festivalId` (and `crewId` if the
   * user has an active crew). Drives the existing loaders so each populates its
   * persisted store; fetches weather + prefetches art for the SW cache. Each
   * section runs independently — one failure marks only that section `error`.
   * Resolves when every section has settled (it never throws).
   */
  downloadForOffline: (festivalId: string, crewId?: string, deps?: Partial<DownloadDeps>) => Promise<void>;
  /** Read a festival's readiness (returns an all-idle snapshot when absent). */
  getReadiness: (festivalId: string) => FestivalReadiness;
  /** Clear a festival's readiness (e.g. on logout / account switch). */
  clearReadiness: (festivalId: string) => void;
}

export type OfflineReadinessStore = OfflineReadinessState & OfflineReadinessActions;

const store: StateCreator<OfflineReadinessStore> = (set, get) => {
  // Patch a single section of a festival's readiness, preserving the others.
  function patchSection(festivalId: string, section: ReadinessSection, next: SectionReadiness): void {
    set((state) => {
      const current = state.byFestival[festivalId] ?? emptyReadiness();
      return {
        byFestival: {
          ...state.byFestival,
          [festivalId]: { ...current, [section]: next },
        },
      };
    });
  }

  // Run one section's loader inside its own try/catch so a single failure marks
  // ONLY that section `error` and never rejects the overall download.
  async function runSection(festivalId: string, section: ReadinessSection, fn: () => Promise<void>): Promise<void> {
    patchSection(festivalId, section, { status: 'syncing', syncedAt: null });
    try {
      await fn();
      patchSection(festivalId, section, { status: 'ready', syncedAt: Date.now() });
    } catch {
      // Keep any previously-synced timestamp so the UI can still say "synced N
      // ago" for a section that was ready before and just failed to refresh.
      const prev = get().byFestival[festivalId]?.[section];
      patchSection(festivalId, section, { status: 'error', syncedAt: prev?.syncedAt ?? null });
    }
  }

  return {
    byFestival: {},
    downloadingFestivalId: null,

    downloadForOffline: async (festivalId, crewId, depsOverride) => {
      const d: DownloadDeps = { ...defaultDeps(), ...depsOverride };
      // Seed an all-syncing snapshot up front so the UI shows progress for every
      // section immediately.
      set((state) => {
        const base = state.byFestival[festivalId] ?? emptyReadiness();
        const seeded: FestivalReadiness = { ...base };
        for (const sec of SECTIONS) {
          // Crew stays idle when there's no crew to download.
          if (sec === 'crew' && !crewId) continue;
          seeded[sec] = { status: 'syncing', syncedAt: base[sec].syncedAt };
        }
        return { byFestival: { ...state.byFestival, [festivalId]: seeded }, downloadingFestivalId: festivalId };
      });

      try {
        // 1) Schedule MUST run (and complete) first: it populates `sets`, which
        //    art prefetch reads. The rest run in parallel after.
        await runSection(festivalId, 'schedule', () => d.selectFestival(festivalId));

        await Promise.all([
          runSection(festivalId, 'picks', () => d.loadProfiles(festivalId)),
          runSection(festivalId, 'weather', () => d.fetchWeather(festivalId)),
          runSection(festivalId, 'art', async () => {
            const urls = collectArtUrls(d.getSets());
            // Best-effort: a single failed image must not fail the section.
            await Promise.allSettled(urls.map((u) => d.prefetchImage(u)));
          }),
          crewId
            ? runSection(festivalId, 'crew', async () => {
                await d.selectCrew(crewId);
                // Sub-resources are best-effort: a crew with no polls/expenses
                // still counts as "crew downloaded" once selectCrew succeeds.
                await Promise.allSettled([
                  d.loadMeetingPoints(crewId),
                  d.loadPolls(crewId),
                  d.loadExpenses(crewId),
                  d.loadActivity(crewId),
                ]);
              })
            : Promise.resolve(),
        ]);
      } finally {
        set({ downloadingFestivalId: null });
      }
    },

    getReadiness: (festivalId) => get().byFestival[festivalId] ?? emptyReadiness(),

    clearReadiness: (festivalId) => {
      set((state) => {
        if (!(festivalId in state.byFestival)) return {};
        const next = { ...state.byFestival };
        delete next[festivalId];
        return { byFestival: next };
      });
    },
  };
};

export const useOfflineReadinessStore = create<OfflineReadinessStore>()(
  persist(store, {
    name: 'festie-offline-readiness',
    storage: createJSONStorage(() => getStorage()),
    // Persist only the readiness map so the checklist survives a cold start and
    // can render "Ready · synced N ago" with N advancing from the device clock.
    // `downloadingFestivalId` is transient (a download never survives a reload).
    partialize: (state) => ({ byFestival: state.byFestival }),
  }),
);
