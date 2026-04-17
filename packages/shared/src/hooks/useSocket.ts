import { useEffect, useRef, useCallback } from 'react';
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
  const userToken = useAuthStore((state) => state.userToken);
  const connected = useUIStore((state) => state.connected);
  const setConnected = useUIStore((state) => state.setConnected);
  const setOnlineUsers = useUIStore((state) => state.setOnlineUsers);
  const addOnlineUser = useUIStore((state) => state.addOnlineUser);
  const removeOnlineUser = useUIStore((state) => state.removeOnlineUser);
  const onlineUsers = useUIStore((state) => state.onlineUsers);
  const currentFestivalId = useFestivalStore((state) => state.currentFestivalId);

  useEffect(() => {
    const socket = createSocket(userToken || undefined);
    const joinedFestivalId = festivalId || currentFestivalId;

    const handleConnect = () => {
      setConnected(true);
      if (joinedFestivalId) {
        socket.emit('join-festival', { festivalId: joinedFestivalId });
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

    const handleError = (error: any) => {
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
      // broadcasting picks to a room we no longer care about.
      if (joinedFestivalId && socket.connected) {
        socket.emit('leave-festival', { festivalId: joinedFestivalId });
      }
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('user:online', handleUserOnline);
      socket.off('user:offline', handleUserOffline);
      socket.off('error', handleError);
      socket.disconnect();
    };
  }, [userToken, festivalId, currentFestivalId, setConnected, setOnlineUsers, addOnlineUser, removeOnlineUser]);

  return {
    socket: socketRef.current,
    connected,
    onlineUsers,
  };
}
