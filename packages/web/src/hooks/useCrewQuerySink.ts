import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import type { CrewRealtimeSink } from '@festie/shared/realtime/crewRealtimeSink';

/**
 * Web adapter for the shared CrewRealtimeSink.
 *
 * Web crew sub-features (polls, meeting points, expenses) are TanStack-Query
 * backed — they live in PollsTab / MeetingPointsTab / ExpensesTab, NOT in the
 * crewStore (unlike mobile). So the sink's job is to invalidate the matching
 * query keys and let TanStack Query refetch. Home base is the exception: the
 * web crew route reads activeCrew.homeBaseLocation/Time straight from the
 * crewStore, so that intent applies to the store instead.
 *
 * Event -> query-key mapping (keys confirmed against the *Tab components):
 *   onMeetingPointUpsert / onMeetingPointRemoved -> ['meeting-points', crewId]
 *   onPollCreated / onPollVoted / onPollClosed   -> ['polls', crewId]
 *   onExpensesChanged   -> ['expenses', crewId] + ['expense-balances', crewId]
 *   onActivityLogged    -> no-op (web has no activity query/view)
 *   onHomeBaseUpdated   -> crewStore.applyHomeBaseUpdate (store, not Query)
 *
 * The crewId passed to each method is the already-guarded active crew id
 * (the shared router scopes poll/expense events to the active crew), so
 * invalidating ['<key>', crewId] always targets the open crew's data.
 */
export function buildCrewQuerySink(queryClient: QueryClient): CrewRealtimeSink {
  return {
    onHomeBaseUpdated: (crewId, payload) => {
      useCrewStore.getState().applyHomeBaseUpdate(crewId, payload);
    },
    onMeetingPointUpsert: (crewId) => {
      void queryClient.invalidateQueries({ queryKey: ['meeting-points', crewId] });
    },
    onMeetingPointRemoved: (crewId) => {
      void queryClient.invalidateQueries({ queryKey: ['meeting-points', crewId] });
    },
    onPollCreated: (crewId) => {
      void queryClient.invalidateQueries({ queryKey: ['polls', crewId] });
    },
    onPollVoted: (crewId) => {
      void queryClient.invalidateQueries({ queryKey: ['polls', crewId] });
    },
    onPollClosed: (crewId) => {
      void queryClient.invalidateQueries({ queryKey: ['polls', crewId] });
    },
    onExpensesChanged: (crewId) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', crewId] });
      void queryClient.invalidateQueries({ queryKey: ['expense-balances', crewId] });
    },
    onActivityLogged: () => {
      // Web has no activity feed query/view — nothing to invalidate.
    },
  };
}

/** Hook wrapper: memoizes the sink against the queryClient identity. */
export function useCrewQuerySink(): CrewRealtimeSink {
  const queryClient = useQueryClient();
  return useMemo(() => buildCrewQuerySink(queryClient), [queryClient]);
}
