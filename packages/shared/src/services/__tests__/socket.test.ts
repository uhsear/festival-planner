import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock socket.io-client ─────────────────────────────────────────────────
// We capture every `io()` call and its options so tests can inspect them.
// The returned mock socket tracks `.on()` listeners so we can simulate events.

type Listener = (...args: unknown[]) => void;

function createMockSocket() {
  const listeners = new Map<string, Listener[]>();
  const socket = {
    on: vi.fn((event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
      return socket;
    }),
    disconnect: vi.fn(),
    // Helper: emit an event from the "server" side so registered listeners fire
    __emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) {
        fn(...args);
      }
    },
    __listeners: listeners,
  };
  return socket;
}

let lastMockSocket: ReturnType<typeof createMockSocket>;

vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string | undefined, _opts: unknown) => {
    lastMockSocket = createMockSocket();
    return lastMockSocket;
  }),
}));

// Must import AFTER the mock so the module picks up the mocked `io`.
import { createSocket, SOCKET_EVENT_NAMES } from '../socket';
import { io } from 'socket.io-client';
import { SOCKET_RECONNECTION_CONFIG } from '../../constants/config';

describe('socket service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window globals
    (globalThis as Record<string, unknown>).__FP_API_BASE = undefined;
  });

  // ── createSocket ──────────────────────────────────────────────────────

  describe('createSocket', () => {
    it('calls io with websocket transport and reconnection config', () => {
      createSocket();
      expect(io).toHaveBeenCalledTimes(1);
      const [, opts] = vi.mocked(io).mock.calls[0]!;
      expect(opts).toMatchObject({
        transports: ['websocket'],
        ...SOCKET_RECONNECTION_CONFIG,
      });
    });

    it('passes auth token when bearerToken is provided', () => {
      createSocket('my-token-123');
      const [, opts] = vi.mocked(io).mock.calls[0]! as [unknown, { auth?: { token: string } }];
      expect(opts.auth).toEqual({ token: 'my-token-123' });
    });

    it('omits auth when bearerToken is undefined', () => {
      createSocket();
      const [, opts] = vi.mocked(io).mock.calls[0]! as [unknown, { auth?: unknown }];
      expect(opts.auth).toBeUndefined();
    });

    it('uses explicit baseUrl when provided', () => {
      createSocket(undefined, 'https://example.com');
      const [url] = vi.mocked(io).mock.calls[0]!;
      expect(url).toBe('https://example.com');
    });

    it('falls back to window.__FP_API_BASE origin when no baseUrl', () => {
      (globalThis as Record<string, unknown>).__FP_API_BASE = 'https://api.festie.us/api/v1';
      createSocket();
      const [url] = vi.mocked(io).mock.calls[0]!;
      expect(url).toBe('https://api.festie.us');
    });

    it('falls back to undefined url when __FP_API_BASE is not set', () => {
      (globalThis as Record<string, unknown>).__FP_API_BASE = undefined;
      createSocket();
      const [url] = vi.mocked(io).mock.calls[0]!;
      expect(url).toBeUndefined();
    });

    it('falls back to undefined url when __FP_API_BASE is invalid', () => {
      (globalThis as Record<string, unknown>).__FP_API_BASE = 'not-a-url';
      createSocket();
      const [url] = vi.mocked(io).mock.calls[0]!;
      expect(url).toBeUndefined();
    });

    it('returns the socket instance', () => {
      const socket = createSocket();
      expect(socket).toBe(lastMockSocket);
    });
  });

  // ── connect_error handling ────────────────────────────────────────────

  describe('connect_error auto-disconnect', () => {
    it('disconnects on 401 error via err.data.status', () => {
      createSocket();
      const err = Object.assign(new Error('Unauthorized'), { data: { status: 401 } });
      lastMockSocket.__emit('connect_error', err);
      expect(lastMockSocket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects on 403 error via err.status', () => {
      createSocket();
      const err = Object.assign(new Error('Forbidden'), { status: 403 });
      lastMockSocket.__emit('connect_error', err);
      expect(lastMockSocket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects on 401 error via err.status', () => {
      createSocket();
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      lastMockSocket.__emit('connect_error', err);
      expect(lastMockSocket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does NOT disconnect on non-auth errors', () => {
      createSocket();
      const err = Object.assign(new Error('Connection timeout'), { data: { status: 500 } });
      lastMockSocket.__emit('connect_error', err);
      expect(lastMockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('does NOT disconnect when error has no status', () => {
      createSocket();
      lastMockSocket.__emit('connect_error', new Error('generic'));
      expect(lastMockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('prefers err.data.status over err.status', () => {
      createSocket();
      // data.status=200 (safe), status=401 -- should NOT disconnect
      // because data.status is checked first via ??
      const err = Object.assign(new Error('mixed'), { data: { status: 200 }, status: 401 });
      lastMockSocket.__emit('connect_error', err);
      expect(lastMockSocket.disconnect).not.toHaveBeenCalled();
    });
  });

  // ── SOCKET_EVENT_NAMES ────────────────────────────────────────────────

  describe('SOCKET_EVENT_NAMES', () => {
    it('exports all expected event name constants', () => {
      expect(SOCKET_EVENT_NAMES.PICKS_UPDATED).toBe('picks:updated');
      expect(SOCKET_EVENT_NAMES.PROFILE_JOINED).toBe('profile:joined');
      expect(SOCKET_EVENT_NAMES.PROFILE_LEFT).toBe('profile:left');
      expect(SOCKET_EVENT_NAMES.CREW_UPDATED).toBe('crew:updated');
      expect(SOCKET_EVENT_NAMES.CREW_MEMBER_JOINED).toBe('crew:member:joined');
      expect(SOCKET_EVENT_NAMES.CREW_MEMBER_LEFT).toBe('crew:member:left');
      expect(SOCKET_EVENT_NAMES.PRESENCE_UPDATE).toBe('presence:update');
      expect(SOCKET_EVENT_NAMES.FESTIVAL_UPDATED).toBe('festival:updated');
      expect(SOCKET_EVENT_NAMES.SET_UPDATED).toBe('set:updated');
      expect(SOCKET_EVENT_NAMES.MESSAGE_CREATED).toBe('message:created');
      expect(SOCKET_EVENT_NAMES.NOTIFICATION).toBe('notification');
      expect(SOCKET_EVENT_NAMES.ERROR).toBe('error');
    });

    it('has exactly 12 event names', () => {
      expect(Object.keys(SOCKET_EVENT_NAMES)).toHaveLength(12);
    });
  });
});
