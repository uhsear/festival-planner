import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  routeHomeBaseUpdated,
  routeMeetingPointUpsert,
  routeMeetingPointRemoved,
  routePollCreated,
  routePollVoted,
  routePollClosed,
  routeExpensesChanged,
  routeActivityLogged,
} from '../crewEventRouter';
import { createStoreSink } from '../crewRealtimeSink';
import { useCrewStore } from '../../stores/crewStore';
import { api } from '../../services/api';
import type { CrewMeetingPoint, CrewPoll } from '../../types/domain';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const ACTIVE = 'crew-active';
const OTHER = 'crew-other';

// ── Sample backend payloads (shapes verified against routes/ + lib/emitter) ──

const homeBasePayload = {
  crewId: ACTIVE,
  location: 'Main Gate',
  time: '20:00',
};

// crew:meeting-point-created/-updated emit the raw snake_case DB row.
const mpRowSnake = {
  id: 'mp-1',
  crew_id: ACTIVE,
  created_by: 'user-1',
  label: 'Tent',
  location: 'Camp A',
  type: 'during',
  meet_at: null,
  stage_reference: null,
  active: true,
  created_at: '2026-06-01T00:00:00Z',
} as unknown as CrewMeetingPoint;

const mpRemovedPayload = { id: 'mp-1', crewId: ACTIVE };

const pollCreatedPayload = {
  pollId: 'poll-1',
  question: 'Where to meet?',
  options: ['Gate', 'Tent'],
  createdBy: 'user-1',
};

const pollVotedPayload = { pollId: 'poll-1', userId: 'user-2', optionIndex: 1 };
const pollClosedPayload = { pollId: 'poll-1' };

const expenseAddedPayload = {
  _v: 1,
  crewId: ACTIVE,
  expense: { id: 'e1' } as Record<string, unknown>,
};
const expenseDeletedPayload = { _v: 1, crewId: ACTIVE, expenseId: 'e1' };
const activityPayload = {
  _v: 1,
  crewId: ACTIVE,
  item: { id: 'a1' } as Record<string, unknown>,
};

describe('crewEventRouter — pure routers', () => {
  describe('routeHomeBaseUpdated', () => {
    it('routes a matching-crew event', () => {
      expect(routeHomeBaseUpdated(homeBasePayload, ACTIVE)).toEqual({
        kind: 'home-base-updated',
        crewId: ACTIVE,
        location: 'Main Gate',
        time: '20:00',
      });
    });

    it('rejects a different-crew event', () => {
      expect(routeHomeBaseUpdated(homeBasePayload, OTHER)).toBeNull();
    });

    it('rejects when no active crew', () => {
      expect(routeHomeBaseUpdated(homeBasePayload, null)).toBeNull();
    });

    it('passes null location/time through', () => {
      const intent = routeHomeBaseUpdated({ crewId: ACTIVE, location: null, time: null }, ACTIVE);
      expect(intent).toEqual({
        kind: 'home-base-updated',
        crewId: ACTIVE,
        location: null,
        time: null,
      });
    });
  });

  describe('routeMeetingPointUpsert', () => {
    it('resolves crewId from snake_case crew_id', () => {
      const intent = routeMeetingPointUpsert(mpRowSnake, ACTIVE);
      expect(intent).not.toBeNull();
      expect(intent!.kind).toBe('meeting-point-upsert');
      expect(intent!.crewId).toBe(ACTIVE);
      expect(intent!.meetingPoint).toBe(mpRowSnake);
    });

    it('falls back to camelCase crewId when crew_id absent', () => {
      const camel = { id: 'mp-2', crewId: ACTIVE } as unknown as CrewMeetingPoint;
      const intent = routeMeetingPointUpsert(camel, ACTIVE);
      expect(intent).not.toBeNull();
      expect(intent!.crewId).toBe(ACTIVE);
    });

    it('prefers snake_case crew_id over camelCase crewId', () => {
      const mixed = {
        id: 'mp-3',
        crew_id: ACTIVE,
        crewId: OTHER,
      } as unknown as CrewMeetingPoint;
      // crew_id (ACTIVE) wins -> matches active -> routes.
      expect(routeMeetingPointUpsert(mixed, ACTIVE)).not.toBeNull();
      // And with OTHER active, crew_id=ACTIVE means it does NOT match.
      expect(routeMeetingPointUpsert(mixed, OTHER)).toBeNull();
    });

    it('rejects a different-crew row', () => {
      expect(routeMeetingPointUpsert(mpRowSnake, OTHER)).toBeNull();
    });

    it('rejects when no active crew', () => {
      expect(routeMeetingPointUpsert(mpRowSnake, null)).toBeNull();
    });
  });

  describe('routeMeetingPointRemoved', () => {
    it('routes a matching-crew removal', () => {
      expect(routeMeetingPointRemoved(mpRemovedPayload, ACTIVE)).toEqual({
        kind: 'meeting-point-removed',
        crewId: ACTIVE,
        mpId: 'mp-1',
      });
    });

    it('rejects a different-crew removal', () => {
      expect(routeMeetingPointRemoved(mpRemovedPayload, OTHER)).toBeNull();
    });

    it('rejects when no active crew', () => {
      expect(routeMeetingPointRemoved(mpRemovedPayload, null)).toBeNull();
    });
  });

  describe('poll events (no crewId in payload — active-room scoped)', () => {
    it('routePollCreated stamps the active crewId', () => {
      expect(routePollCreated(pollCreatedPayload, ACTIVE)).toEqual({
        kind: 'poll-created',
        crewId: ACTIVE,
        pollId: 'poll-1',
        question: 'Where to meet?',
        options: ['Gate', 'Tent'],
        createdBy: 'user-1',
      });
    });

    it('routePollVoted passes through with active crewId', () => {
      expect(routePollVoted(pollVotedPayload, ACTIVE)).toEqual({
        kind: 'poll-voted',
        crewId: ACTIVE,
        pollId: 'poll-1',
        userId: 'user-2',
        optionIndex: 1,
      });
    });

    it('routePollClosed passes through with active crewId', () => {
      expect(routePollClosed(pollClosedPayload, ACTIVE)).toEqual({
        kind: 'poll-closed',
        crewId: ACTIVE,
        pollId: 'poll-1',
      });
    });

    it('all poll routers reject when no active crew', () => {
      expect(routePollCreated(pollCreatedPayload, null)).toBeNull();
      expect(routePollVoted(pollVotedPayload, null)).toBeNull();
      expect(routePollClosed(pollClosedPayload, null)).toBeNull();
    });
  });

  describe('expense / activity (camelCase crewId guard)', () => {
    it('routeExpensesChanged accepts added for active crew', () => {
      expect(routeExpensesChanged(expenseAddedPayload, ACTIVE)).toEqual({
        kind: 'expenses-changed',
        crewId: ACTIVE,
      });
    });

    it('routeExpensesChanged accepts deleted for active crew', () => {
      expect(routeExpensesChanged(expenseDeletedPayload, ACTIVE)).toEqual({
        kind: 'expenses-changed',
        crewId: ACTIVE,
      });
    });

    it('routeExpensesChanged rejects a different-crew event', () => {
      expect(routeExpensesChanged(expenseAddedPayload, OTHER)).toBeNull();
    });

    it('routeActivityLogged accepts active crew, rejects others / null', () => {
      expect(routeActivityLogged(activityPayload, ACTIVE)).toEqual({
        kind: 'activity-logged',
        crewId: ACTIVE,
      });
      expect(routeActivityLogged(activityPayload, OTHER)).toBeNull();
      expect(routeActivityLogged(activityPayload, null)).toBeNull();
    });
  });
});

// ── Store-sink integration: router output -> createStoreSink -> crewStore state.

function resetStore() {
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    crewOverlap: {},
    polls: [],
    meetingPoints: [],
    expenses: [],
    expenseBalances: [],
    activity: [],
    crewLoading: false,
    error: null,
  });
}

describe('crewEventRouter + createStoreSink integration', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    // Active crew so reload-style sinks proceed.
    useCrewStore.setState({
      activeCrew: {
        id: ACTIVE,
        name: 'Active',
        owner: 'user-1',
        members: [],
        inviteCode: 'X',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    });
  });

  const sink = () => createStoreSink(useCrewStore);

  it('home-base intent updates activeCrew home base', () => {
    const intent = routeHomeBaseUpdated(homeBasePayload, ACTIVE)!;
    sink().onHomeBaseUpdated(intent.crewId, {
      location: intent.location,
      time: intent.time,
    });
    const active = useCrewStore.getState().activeCrew!;
    expect((active as unknown as { homeBaseLocation: string }).homeBaseLocation).toBe('Main Gate');
    expect((active as unknown as { homeBaseTime: string }).homeBaseTime).toBe('20:00');
  });

  it('meeting-point upsert inserts then replaces in place', () => {
    const intent = routeMeetingPointUpsert(mpRowSnake, ACTIVE)!;
    sink().onMeetingPointUpsert(intent.crewId, intent.meetingPoint);
    expect(useCrewStore.getState().meetingPoints).toHaveLength(1);

    const updatedRow = { ...mpRowSnake, label: 'Tent v2' } as CrewMeetingPoint;
    const intent2 = routeMeetingPointUpsert(updatedRow, ACTIVE)!;
    sink().onMeetingPointUpsert(intent2.crewId, intent2.meetingPoint);
    const mps = useCrewStore.getState().meetingPoints;
    expect(mps).toHaveLength(1);
    expect(mps[0]!.label).toBe('Tent v2');
  });

  it('meeting-point removal drops it from state', () => {
    useCrewStore.setState({ meetingPoints: [mpRowSnake] });
    const intent = routeMeetingPointRemoved(mpRemovedPayload, ACTIVE)!;
    sink().onMeetingPointRemoved(intent.crewId, intent.mpId);
    expect(useCrewStore.getState().meetingPoints).toHaveLength(0);
  });

  it('poll-vote intent applies one-vote-per-user replacement', () => {
    const poll: CrewPoll = {
      id: 'poll-1',
      crew_id: ACTIVE,
      created_by: 'user-1',
      question: 'Q',
      options: ['A', 'B'],
      votes: [{ option: 0, user_id: 'user-2' }],
      closes_at: null,
      closed: false,
      created_at: '2026-01-01T00:00:00Z',
    };
    useCrewStore.setState({ polls: [poll] });
    const intent = routePollVoted(pollVotedPayload, ACTIVE)!;
    sink().onPollVoted(intent.crewId, intent.pollId, intent.userId, intent.optionIndex);
    const votes = useCrewStore.getState().polls[0]!.votes;
    expect(votes).toEqual([{ option: 1, user_id: 'user-2' }]);
  });

  it('poll-closed intent drops the poll', () => {
    const poll: CrewPoll = {
      id: 'poll-1',
      crew_id: ACTIVE,
      created_by: 'user-1',
      question: 'Q',
      options: ['A'],
      votes: [],
      closes_at: null,
      closed: false,
      created_at: '2026-01-01T00:00:00Z',
    };
    useCrewStore.setState({ polls: [poll] });
    const intent = routePollClosed(pollClosedPayload, ACTIVE)!;
    sink().onPollClosed(intent.crewId, intent.pollId);
    expect(useCrewStore.getState().polls).toHaveLength(0);
  });

  it('poll-created intent reloads the authoritative poll list', async () => {
    const reloaded = [
      {
        id: 'poll-1',
        crew_id: ACTIVE,
        created_by: 'user-1',
        question: 'Where to meet?',
        options: ['Gate', 'Tent'],
        votes: [],
        closes_at: null,
        closed: false,
        created_at: '2026-06-01T00:00:00Z',
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce({ polls: reloaded });
    const intent = routePollCreated(pollCreatedPayload, ACTIVE)!;
    sink().onPollCreated(intent.crewId, {
      pollId: intent.pollId,
      question: intent.question,
      options: intent.options,
      createdBy: intent.createdBy,
    });
    // loadPolls is async; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(api.get).toHaveBeenCalledWith(`/crews/${ACTIVE}/polls`);
    expect(useCrewStore.getState().polls).toHaveLength(1);
  });

  it('expenses-changed intent reloads expenses + balances', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([{ id: 'e1' }])
      .mockResolvedValueOnce([]);
    const intent = routeExpensesChanged(expenseAddedPayload, ACTIVE)!;
    sink().onExpensesChanged(intent.crewId);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.get).toHaveBeenCalledWith(`/crews/${ACTIVE}/expenses`);
    expect(useCrewStore.getState().expenses).toEqual([{ id: 'e1' }]);
  });

  it('activity-logged intent reloads activity', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [{ id: 'a1' }], nextCursor: null });
    const intent = routeActivityLogged(activityPayload, ACTIVE)!;
    sink().onActivityLogged(intent.crewId);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.get).toHaveBeenCalledWith(`/crews/${ACTIVE}/activity`);
    expect(useCrewStore.getState().activity).toEqual([{ id: 'a1' }]);
  });

  it('store-sink reload guards against a crew switch before flush', async () => {
    // Active crew is ACTIVE, but the intent targets OTHER (stale) -> no reload.
    sink().onExpensesChanged(OTHER);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.get).not.toHaveBeenCalled();
  });
});
