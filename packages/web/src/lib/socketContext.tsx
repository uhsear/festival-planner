import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

/**
 * SocketContext — exposes the single shared Socket.IO connection (owned by
 * useRealtimeSync, provided at the AppShell root) to feature components that need
 * to EMIT events, not just react to them.
 *
 * Most realtime data flows one-way (server → store via useRealtimeSync), so most
 * components never touch the socket directly. Live Location is the exception: the
 * publisher must emit `location:share` / `location:update` / `location:stop` from
 * deep in the crew UI. Rather than spinning up a second socket (a duplicate
 * connection + a second presence row), we thread the existing one through context.
 *
 * Value is null until the socket connects (and in tests / SSR), so consumers must
 * null-check before emitting.
 */
export const SocketContext = createContext<Socket | null>(null);

/** Read the shared app socket. Returns null when no socket is connected. */
export function useSharedSocket(): Socket | null {
  return useContext(SocketContext);
}
