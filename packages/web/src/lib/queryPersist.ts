import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { useAuthStore } from '@festie/shared';

/**
 * Offline-survival persistence for the TanStack Query cache (web).
 *
 * Why: crew sub-features (PollsTab / MeetingPointsTab / ExpensesTab and the
 * crew.tsx tab badges) read entirely from the in-memory react-query cache. On a
 * page reload with no network — e.g. standing in a field at a festival — those
 * queries refetch from scratch and fall straight to skeleton -> error. By
 * snapshotting the cache to localStorage we let the user reopen their crew's
 * data offline.
 *
 * Session safety (shared browsers): we only persist because
 *   1. `buster` is keyed to the current user id, so a different user's restore
 *      is rejected (the dehydrated cache is discarded), AND
 *   2. main.tsx already calls `queryClient.clear()` on every auth-state change,
 *      which empties the cache before a new user's first query can be written.
 * We additionally restrict what is dehydrated to a crew/profile whitelist via
 * `shouldDehydrateQuery`, so no auth tokens or other volatile/sensitive queries
 * ever touch localStorage.
 */

const STORAGE_KEY = 'festie-rq-cache';
const MAX_AGE = 1000 * 60 * 60 * 24; // 24h

/**
 * Query-key roots that are safe to persist for offline reads. These are the
 * crew sub-feature keys actually used by the *Tab components and the crew.tsx
 * badges (confirmed against the source — see useCrewQuerySink.ts):
 *   ['meeting-points', crewId]   — MeetingPointsTab
 *   ['polls', crewId]            — PollsTab + crew.tsx open-poll badge
 *   ['expenses', crewId]         — ExpensesTab
 *   ['expense-balances', crewId] — ExpensesTab + crew.tsx unsettled badge
 *   ['crew-activity', crewId]    — ActivityTab
 * Anything else (auth, lineup, ratings, …) is intentionally NOT persisted.
 */
const PERSISTED_KEY_ROOTS = new Set<string>([
  'meeting-points',
  'polls',
  'expenses',
  'expense-balances',
  'settlement-plan',
  'crew-activity',
]);

export const queryPersister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: STORAGE_KEY,
});

/**
 * persistOptions for <PersistQueryClientProvider>.
 *
 * `buster` is the current user id (or '' when logged out). When the active user
 * changes, the buster changes and any cache persisted under the old user is
 * discarded on restore — defence-in-depth alongside the clear()-on-auth-change
 * subscription in main.tsx. Read lazily at provider mount; restore happens once
 * at startup, and the clear() subscription handles in-session user switches.
 */
export function buildPersistOptions(): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: queryPersister,
    maxAge: MAX_AGE,
    buster: useAuthStore.getState().user?.id ?? '',
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        const root = query.queryKey?.[0];
        return typeof root === 'string' && PERSISTED_KEY_ROOTS.has(root);
      },
    },
  };
}
