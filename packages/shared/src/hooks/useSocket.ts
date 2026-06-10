import { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket } from '../services/socket';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { useFestivalStore } from '../stores/festivalStore';
import { OnlineUser } from '../types';

export interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  onlineUsers: OnlineUser[];
}

export function useSocket(festivalId?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  // Invariant: joinedFestivalIdRef.current holds the festivalId that the
  // currently-live socket emitted `join:festival` for. Updated
  // synchronously at the top of each effect run and read in the cleanup.
  // Using a ref (rather than a closure-captured local) keeps the leave/
  // join sides in lockstep even under rapid festivalId switches
  // (A -> B -> C), so we never emit `leave:festival` against a socket
  // that has since joined C.
  const joinedFestivalIdRef = useRef<string | null>(null);
  const userToken = useAuthStore((state) => state.userToken);
  const connected = useUIStore((state) => state.connected);
  const setConnected = useUIStore((state) => state.setConnected);
  const setOnlineUsers = useUIStore((state) => state.setOnlineUsers);
  const addOnlineUser = useUIStore((state) => state.addOnlineUser);
  const removeOnlineUser = useUIStore((state) => state.removeOnlineUser);
  const onlineUsers = useUIStore((state) => state.onlineUsers);
  const currentFestivalId = useFestivalStore((state) => state.currentFestivalId);

  useEffect(() => {
    const socket = createSocket(userToken || undefined, undefined, () => {
      // Socket auth failed — attempt a single token refresh, then reconnect
      // with the new token. On failure stay disconnected (an HTTP request will
      // drive the refresh/logout path).
      useAuthStore
        .getState()
        .refreshToken()
        .then(() => {
          const t = useAuthStore.getState().userToken;
          if (t && socketRef.current) {
            socketRef.current.auth = { token: t };
            socketRef.current.connect();
          }
        })
        .catch(() => {});
    });
    const joinedFestivalId = festivalId || currentFestivalId;
    // Sync the ref BEFORE wiring handlers so handleConnect reads the
    // right id and cleanup can leave the right room.
    joinedFestivalIdRef.current = joinedFestivalId ?? null;

    const handleConnect = () => {
      setConnected(true);
      const joinId = joinedFestivalIdRef.current;
      if (joinId) {
        socket.emit('join:festival', joinId, {});
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    const handlePresenceUpdate = (data: { users: OnlineUser[] }) => {
      if (data.users) {
        setOnlineUsers(data.users);
      }
    };

    const handleUserOnline = (user: OnlineUser) => {
      addOnlineUser(user);
    };

    const handleUserOffline = (userId: string) => {
      removeOnlineUser(userId);
    };

    const handleError = (error: Error) => {
      console.error('Socket error:', error);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('error', handleError);

    socketRef.current = socket;

    return () => {
      // Leave the festival room before tearing down so the server stops
      // broadcasting picks to a room we no longer care about. Read the
      // ref rather than the closure-captured local to respect the
      // invariant documented above.
      const toLeave = joinedFestivalIdRef.current;
      if (toLeave && socket.connected) {
        socket.emit('leave:festival');
      }
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('user:online', handleUserOnline);
      socket.off('user:offline', handleUserOffline);
      socket.off('error', handleError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userToken, festivalId, currentFestivalId, setConnected, setOnlineUsers, addOnlineUser, removeOnlineUser]);

  return {
    socket: socketRef.current,
    connected,
    onlineUsers,
  };
}
