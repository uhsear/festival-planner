import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveLocationPublisher, type GeoFix, type GeoWatcher } from './useLiveLocationPublisher';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { LIVE_LOCATION } from '../constants/config';
import type { Socket } from '../services/socket';

/** Minimal fake socket capturing emits. */
function makeSocket(connected = true) {
  const emit = vi.fn();
  return { socket: { connected, emit } as unknown as Socket, emit };
}

/**
 * A controllable injected geolocation watcher. `push` feeds fixes to the hook;
 * `teardown` is the spy returned by the watcher (cleanup).
 */
function makeWatcher() {
  const teardown = vi.fn();
  let emitFix: ((fix: GeoFix) => void) | undefined;
  let emitError: ((err: unknown) => void) | undefined;
  const watchPosition: GeoWatcher = (onFix, onError) => {
    emitFix = onFix;
    emitError = onError;
    return teardown;
  };
  return {
    watchPosition,
    teardown,
    push: (fix: GeoFix) => emitFix?.(fix),
    pushError: (err: unknown) => emitError?.(err),
    get started() {
      return emitFix !== undefined;
    },
  };
}

function resetStore() {
  useLiveLocationStore.setState({
    crewId: null,
    sharingCrewId: null,
    lastSentAt: null,
    lastSentCoord: null,
    peers: {},
    sos: null,
  });
}

describe('useLiveLocationPublisher', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when disabled', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: false, watchPosition: w.watchPosition }),
    );
    expect(w.started).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(useLiveLocationStore.getState().sharingCrewId).toBeNull();
  });

  it('does nothing without a socket or crewId', () => {
    const w1 = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket: null, crewId: 'crew-1', enabled: true, watchPosition: w1.watchPosition }),
    );
    expect(w1.started).toBe(false);

    const { socket } = makeSocket();
    const w2 = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: null, enabled: true, watchPosition: w2.watchPosition }),
    );
    expect(w2.started).toBe(false);
  });

  it('on enable: emits location:share, starts the watcher, sets sharing state', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );
    expect(emit).toHaveBeenCalledWith('location:share', { _v: 1, crewId: 'crew-1' }, expect.any(Function));
    expect(w.started).toBe(true);
    const s = useLiveLocationStore.getState();
    expect(s.sharingCrewId).toBe('crew-1');
    expect(s.crewId).toBe('crew-1');
  });

  it('publishes the first fix and records it (location:update)', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );

    vi.setSystemTime(5_000);
    w.push({ lat: 40.0, lng: -74.0, accuracy: 7 });

    expect(emit).toHaveBeenCalledWith(
      'location:update',
      expect.objectContaining({ _v: 1, crewId: 'crew-1', lat: 40.0, lng: -74.0, accuracy: 7 }),
    );
    const s = useLiveLocationStore.getState();
    expect(s.lastSentCoord).toEqual({ lat: 40.0, lng: -74.0 });
    expect(s.lastSentAt).toBe(5_000);
  });

  it('defaults capturedAt to now when the fix omits it', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );
    vi.setSystemTime(8_000);
    w.push({ lat: 1, lng: 2 });
    const updateCall = emit.mock.calls.find((c) => c[0] === 'location:update');
    expect(updateCall![1].capturedAt).toBe(new Date(8_000).toISOString());
  });

  it('throttles a stationary follow-up fix within the interval', () => {
    const { socket, emit } = makeSocket();
    const w = makeWatcher();
    renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );
    vi.setSystemTime(1_000);
    w.push({ lat: 40.0, lng: -74.0 });
    const after1 = emit.mock.calls.filter((c) => c[0] === 'location:update').length;

    // Same spot, well within UPDATE_INTERVAL_MS -> dropped.
    vi.setSystemTime(2_000);
    w.push({ lat: 40.0, lng: -74.0 });
    const after2 = emit.mock.calls.filter((c) => c[0] === 'location:update').length;
    expect(after2).toBe(after1);
  });

  it('forwards watcher errors to onError', () => {
    const { socket } = makeSocket();
    const w = makeWatcher();
    const onError = vi.fn();
    renderHook(() =>
      useLiveLocationPublisher({
        socket,
        crewId: 'crew-1',
        enabled: true,
        watchPosition: w.watchPosition,
        onError,
      }),
    );
    const boom = new Error('permission revoked');
    w.pushError(boom);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('auto-stops after MAX_SESSION_MS: tears down, emits stop, calls onAutoStop', () => {
    const { socket, emit } = makeSocket(true);
    const w = makeWatcher();
    const onAutoStop = vi.fn();
    renderHook(() =>
      useLiveLocationPublisher({
        socket,
        crewId: 'crew-1',
        enabled: true,
        watchPosition: w.watchPosition,
        onAutoStop,
      }),
    );

    vi.advanceTimersByTime(LIVE_LOCATION.MAX_SESSION_MS);

    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(w.teardown).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('location:stop', { _v: 1, crewId: 'crew-1' });
    expect(useLiveLocationStore.getState().sharingCrewId).toBeNull();
  });

  it('cleanup on unmount: tears down watcher, emits stop, clears sharing', () => {
    const { socket, emit } = makeSocket(true);
    const w = makeWatcher();
    const { unmount } = renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );

    unmount();

    expect(w.teardown).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('location:stop', { _v: 1, crewId: 'crew-1' });
    expect(useLiveLocationStore.getState().sharingCrewId).toBeNull();
  });

  it('does not emit location:stop when the socket is disconnected, but still clears state', () => {
    const { socket, emit } = makeSocket(false); // disconnected
    const w = makeWatcher();
    const { unmount } = renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );
    unmount();
    expect(emit).not.toHaveBeenCalledWith('location:stop', expect.anything());
    expect(w.teardown).toHaveBeenCalledTimes(1);
    expect(useLiveLocationStore.getState().sharingCrewId).toBeNull();
  });

  it('does not publish fixes after teardown (stopped guard)', () => {
    const { socket, emit } = makeSocket(true);
    const w = makeWatcher();
    const { unmount } = renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );
    unmount();
    const before = emit.mock.calls.length;
    w.push({ lat: 1, lng: 2 }); // late fix after stop
    expect(emit.mock.calls.length).toBe(before);
  });

  it('survives a watcher teardown that throws', () => {
    const { socket } = makeSocket(true);
    const w = makeWatcher();
    w.teardown.mockImplementation(() => {
      throw new Error('already torn down');
    });
    const { unmount } = renderHook(() =>
      useLiveLocationPublisher({ socket, crewId: 'crew-1', enabled: true, watchPosition: w.watchPosition }),
    );
    expect(() => unmount()).not.toThrow();
    expect(useLiveLocationStore.getState().sharingCrewId).toBeNull();
  });
});
