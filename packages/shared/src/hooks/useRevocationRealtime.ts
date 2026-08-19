// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * useRevocationRealtime — the client half of the server's authorization
 * revocation events.
 *
 * The server emits `session:revoked`, `crew:access-revoked` and
 * `crew:member-kicked` from routes/auth.ts, routes/crew-members.ts and
 * routes/admin-bulk.ts. Without these listeners a kicked member keeps a phantom
 * crew on screen and a revoked session keeps looking live until a manual
 * refresh — it reads as a security failure.
 *
 * It does NOT own a socket: the caller passes the single shared one (web's
 * useSocket, mobile's useRealtimeSync). It is deliberately NOT gated behind the
 * crew-realtime feature flags — revocation must apply on every surface.
 *
 * `onSessionRevoked` is the platform navigation escape hatch (web: navigate to
 * /login, mobile: router.replace('/(auth)/login')). All state teardown lives in
 * @festie/shared so web and mobile stay in parity.
 */

import { useEffect, useRef } from 'react';
import type { Socket } from '../services/socket';
import { applyCrewAccessRevoked, applyCrewMemberKicked, applySessionRevoked } from '../realtime/revocationHandlers';

export interface UseRevocationRealtimeOptions {
  /** The shared socket. Null while disconnected — the hook then does nothing. */
  socket: Socket | null;
  /** Platform navigation to the auth surface, run after local state is purged. */
  onSessionRevoked?: () => void;
}

export function useRevocationRealtime({ socket, onSessionRevoked }: UseRevocationRealtimeOptions): void {
  // Held in a ref so an inline callback from the caller does not re-register
  // listeners on every render.
  const onSessionRevokedRef = useRef(onSessionRevoked);
  onSessionRevokedRef.current = onSessionRevoked;

  useEffect(() => {
    if (!socket) return;

    const handleSessionRevoked = () => {
      // logout() swallows its own network failure, but a rejection here would
      // become an unhandled rejection — the navigation already ran in `finally`.
      void applySessionRevoked(() => onSessionRevokedRef.current?.()).catch(() => {});
    };

    const handleCrewAccessRevoked = (data: { crewId: string }) => {
      applyCrewAccessRevoked(data?.crewId);
    };

    const handleCrewMemberKicked = (data: { crewId: string; userId: string }) => {
      applyCrewMemberKicked(data?.crewId, data?.userId);
    };

    socket.on('session:revoked', handleSessionRevoked);
    socket.on('crew:access-revoked', handleCrewAccessRevoked);
    socket.on('crew:member-kicked', handleCrewMemberKicked);

    return () => {
      socket.off('session:revoked', handleSessionRevoked);
      socket.off('crew:access-revoked', handleCrewAccessRevoked);
      socket.off('crew:member-kicked', handleCrewMemberKicked);
    };
  }, [socket]);
}
