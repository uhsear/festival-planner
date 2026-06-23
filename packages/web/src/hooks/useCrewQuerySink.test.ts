import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { useCrewRealtime } from '@festie/shared/hooks/useCrewRealtime';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { buildCrewQuerySink } from './useCrewQuerySink';

/**
 * These tests exercise the WEB crew-realtime wiring end to end:
 * the real shared `useCrewRealtime` event router + our `buildCrewQuerySink`,
 * driven by a fake socket. We assert that snake_case crew:* payloads scoped to
 * the active crew invalidate the matching TanStack Query keys (and that home
 * base applies to the crewStore instead of a query invalidation).
 */

const ACTIVE_CREW = 'crew-active-123';

// A minimal socket double: records handlers registered via `.on`, lets the test
// emit events, and reports `connected` so the join:crew lifecycle is exercised.
function makeFakeSocket() {
  const handlers: Record<string, (data: unknown) => void> = {};
  const emit = vi.fn();
  const socket = {
    connected: true,
    on: (event: string, fn: (data: unknown) => void) => {
      handlers[event] = fn;
    },
    off: (event: string) => {
      delete handlers[event];
    },
    emit,
  } as unknown as Socket;
  const fire = (event: string, data: unknown) => handlers[event]?.(data);
  return { socket, fire, emit, handlers };
}

function setActiveCrew(id: string | null) {
  useCrewStore.setState({
    activeCrew: id ? ({ id } as never) : null,
  });
}

describe('web crew-realtime query sink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActiveCrew(ACTIVE_CREW);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    setActiveCrew(null);
  });

  function renderWired(queryClient: QueryClient, fakeSocket: ReturnType<typeof makeFakeSocket>) {
    const sink = buildCrewQuerySink(queryClient);
    return renderHook(() =>
      useCrewRealtime({
        socket: fakeSocket.socket,
        getActiveCrewId: () => useCrewStore.getState().activeCrew?.id ?? null,
        sink,
        joinRoom: true,
      }),
    );
  }

  it('invalidates ["meeting-points", crewId] on crew:meeting-point-created (snake_case crew_id)', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    // Raw DB row shape: crew_id (snake_case) === the active crew.
    fakeSocket.fire('crew:meeting-point-created', {
      id: 'mp-1',
      crew_id: ACTIVE_CREW,
      created_by: 'u1',
      label: 'Main gate',
      location: 'North entrance',
      type: 'during',
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meeting-points', ACTIVE_CREW] });
  });

  it('invalidates ["polls", crewId] on crew:poll-voted', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    // poll-voted payload carries pollId, not crewId — the router scopes it to
    // the active crew, and the sink invalidates ['polls', <activeCrewId>].
    fakeSocket.fire('crew:poll-voted', { pollId: 'poll-9', userId: 'u2', optionIndex: 1 });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['polls', ACTIVE_CREW] });
  });

  it('invalidates expenses + expense-balances on crew:expense-added (after debounce)', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:expense-added', { _v: 1, crewId: ACTIVE_CREW, expense: { id: 'e1' } });
    // Expense events are debounced (300ms) inside the shared hook.
    vi.advanceTimersByTime(300);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expenses', ACTIVE_CREW] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-balances', ACTIVE_CREW] });
  });

  it('ignores events scoped to a different crew', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:meeting-point-created', { id: 'mp-x', crew_id: 'some-other-crew' });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('routes crew:home-base-updated to crewStore.applyHomeBaseUpdate (not a query invalidation)', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:home-base-updated', {
      crewId: ACTIVE_CREW,
      location: 'Camp 42',
      time: '2026-06-02T18:00:00.000Z',
    });

    const crew = useCrewStore.getState().activeCrew as unknown as {
      homeBaseLocation: string | null;
      homeBaseTime: string | null;
    };
    expect(crew.homeBaseLocation).toBe('Camp 42');
    expect(crew.homeBaseTime).toBe('2026-06-02T18:00:00.000Z');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('buildCrewQuerySink (direct mapping)', () => {
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  });

  it('maps each sink method to the expected query key(s)', () => {
    const sink = buildCrewQuerySink(queryClient);
    const crewId = 'c1';

    sink.onMeetingPointUpsert(crewId, {} as never);
    sink.onMeetingPointRemoved(crewId, 'mp1');
    sink.onPollCreated(crewId, { pollId: 'p', question: 'q', options: [], createdBy: 'u' });
    sink.onPollVoted(crewId, 'p', 'u', 0);
    sink.onPollClosed(crewId, 'p');
    sink.onExpensesChanged(crewId);
    sink.onActivityLogged(crewId); // no-op

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meeting-points', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['polls', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expenses', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-balances', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settlement-plan', crewId] });
    expect(invalidate).toHaveBeenCalledTimes(8);
  });
});
