import { io, Socket } from 'socket.io-client';
import { SOCKET_RECONNECTION_CONFIG } from '../constants/config';
import { SocketEvents } from '../types/domain';

export interface SocketOptions {
  auth?: {
    token: string;
  };
  transports?: string[];
  reconnection?: boolean;
  reconnectionDelay?: number;
  randomizationFactor?: number;
  reconnectionDelayMax?: number;
  reconnectionAttempts?: number;
}

export function createSocket(bearerToken?: string, baseUrl?: string): Socket {
  const opts: SocketOptions = {
    transports: ['websocket'],
    ...SOCKET_RECONNECTION_CONFIG,
  };

  if (bearerToken) {
    opts.auth = { token: bearerToken };
  }

  let url = baseUrl;
  if (!url && typeof window !== 'undefined') {
    try {
      const apiBase = window.__FP_API_BASE;
      if (apiBase) {
        url = new URL(apiBase).origin;
      }
    } catch {
      url = undefined;
    }
  }

  return io(url || undefined, opts);
}

export { Socket, SocketEvents };

export const SOCKET_EVENT_NAMES = {
  PICKS_UPDATED: 'picks:updated' as const,
  PROFILE_JOINED: 'profile:joined' as const,
  PROFILE_LEFT: 'profile:left' as const,
  CREW_UPDATED: 'crew:updated' as const,
  CREW_MEMBER_JOINED: 'crew:member:joined' as const,
  CREW_MEMBER_LEFT: 'crew:member:left' as const,
  PRESENCE_UPDATE: 'presence:update' as const,
  FESTIVAL_UPDATED: 'festival:updated' as const,
  SET_UPDATED: 'set:updated' as const,
  MESSAGE_CREATED: 'message:created' as const,
  NOTIFICATION: 'notification' as const,
  ERROR: 'error' as const,
};
