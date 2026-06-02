// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * CrewRealtimeSink — the injected effect boundary for crew realtime.
 *
 * The router (crewEventRouter) is pure and decides *what* should happen; the
 * sink decides *where* it lands. Mobile applies changes to the crewStore;
 * web reads crew sub-data from TanStack Query — so the shared layer must not
 * assume a single destination. `useCrewRealtime` calls the sink methods with
 * the already-resolved, already-guarded intent args.
 *
 * `createStoreSink` is the zustand-crewStore adapter (so mobile can adopt this
 * shared path later without behavior change).
 */

import type { CrewMeetingPoint, CrewPoll } from '../types/domain';

/**
 * The minimal crewStore surface the store-sink adapter depends on. Declared
 * structurally (not imported from crewStore) so the realtime module stays
 * decoupled and the adapter accepts any compatible store api (incl. test doubles).
 */
export interface CrewStoreSinkApi {
  getState: () => {
    activeCrew: { id: string } | null;
    applyHomeBaseUpdate: (crewId: string, payload: { location: string | null; time: string | null }) => void;
    applyMeetingPointUpsert: (meetingPoint: CrewMeetingPoint) => void;
    applyMeetingPointRemoval: (mpId: string) => void;
    applyPollCreated: (poll: CrewPoll) => void;
    applyPollVote: (pollId: string, userId: string, optionIndex: number) => void;
    applyPollClosed: (pollId: string) => void;
    loadPolls: (crewId: string) => Promise<void>;
    loadExpenses: (crewId: string) => Promise<void>;
    loadActivity: (crewId: string) => Promise<void>;
  };
}

export interface CrewRealtimeSink {
  onHomeBaseUpdated: (crewId: string, payload: { location: string | null; time: string | null }) => void;
  onMeetingPointUpsert: (crewId: string, meetingPoint: CrewMeetingPoint) => void;
  onMeetingPointRemoved: (crewId: string, mpId: string) => void;
  /**
   * Poll-created carries no full poll shape; the authoritative reload happens
   * in the hook's debounced path. `partial` carries the raw event fields for
   * sinks that want an optimistic insert.
   */
  onPollCreated: (
    crewId: string,
    partial: {
      pollId: string;
      question: string;
      options: string[];
      createdBy: string;
    },
  ) => void;
  onPollVoted: (crewId: string, pollId: string, userId: string, optionIndex: number) => void;
  onPollClosed: (crewId: string, pollId: string) => void;
  onExpensesChanged: (crewId: string) => void;
  onActivityLogged: (crewId: string) => void;
}

/**
 * Adapter mapping the sink to the existing crewStore socket-driven setters.
 *
 * Semantics mirror mobile's useRealtimeSync:
 * - home base / meeting points / poll-vote / poll-closed apply in place
 * - poll-created reloads the authoritative poll list (payload lacks the full
 *   poll: created_at / closed / votes), guarded against a stale active crew
 * - expenses / activity reload their authoritative lists
 *
 * Reload methods re-read the *current* active crew id before firing so a crew
 * switch between event and (debounced) flush can't write the wrong crew's data.
 */
export function createStoreSink(crewStoreApi: CrewStoreSinkApi): CrewRealtimeSink {
  const stillActive = (crewId: string): boolean => crewStoreApi.getState().activeCrew?.id === crewId;

  return {
    onHomeBaseUpdated: (crewId, payload) => {
      crewStoreApi.getState().applyHomeBaseUpdate(crewId, payload);
    },
    onMeetingPointUpsert: (_crewId, meetingPoint) => {
      crewStoreApi.getState().applyMeetingPointUpsert(meetingPoint);
    },
    onMeetingPointRemoved: (_crewId, mpId) => {
      crewStoreApi.getState().applyMeetingPointRemoval(mpId);
    },
    onPollCreated: (crewId) => {
      // The event lacks the full poll shape; reload the authoritative list.
      if (!stillActive(crewId)) return;
      void crewStoreApi
        .getState()
        .loadPolls(crewId)
        .catch(() => {});
    },
    onPollVoted: (_crewId, pollId, userId, optionIndex) => {
      crewStoreApi.getState().applyPollVote(pollId, userId, optionIndex);
    },
    onPollClosed: (_crewId, pollId) => {
      crewStoreApi.getState().applyPollClosed(pollId);
    },
    onExpensesChanged: (crewId) => {
      if (!stillActive(crewId)) return;
      void crewStoreApi
        .getState()
        .loadExpenses(crewId)
        .catch(() => {});
    },
    onActivityLogged: (crewId) => {
      if (!stillActive(crewId)) return;
      void crewStoreApi
        .getState()
        .loadActivity(crewId)
        .catch(() => {});
    },
  };
}
