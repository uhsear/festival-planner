import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@festie/shared/hooks/useSocket';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useAuthStore } from '@festie/shared/stores/authStore';

export interface UseRealtimeSyncReturn {
  connected: boolean;
  onlineUsers: any[];
}

/**
 * Bridge Socket.IO events to TanStack Query cache invalidation.
 * Listens for real-time updates and syncs local state.
 * Mount in AppShell to keep sync active across route changes.
 */
export function useRealtimeSync(): UseRealtimeSyncReturn {
  const queryClient = useQueryClient();
  const socketRef = useRef<any>(null);
  const currentFestivalId = useFestivalStore((state) => state.currentFestivalId);
  const connected = useUIStore((state) => state.connected);
  const setConnected = useUIStore((state) => state.setConnected);
  const onlineUsers = useUIStore((state) => state.onlineUsers);
  const setOnlineUsers = useUIStore((state) => state.setOnlineUsers);
  const user = useAuthStore((state) => state.user);

  const { socket } = useSocket(currentFestivalId || undefined);

  // Set up Socket.IO event listeners
  useEffect(() => {
    if (!socket) return;

    socketRef.current = socket;

    const handlePicksUpdated = (data: any) => {
      // Invalidate picks queries
      queryClient.invalidateQueries({ queryKey: ['picks', currentFestivalId] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      // Also refresh Zustand profiles so currentProfile.picks stays in sync
      if (currentFestivalId) {
        useFestivalStore.getState().loadProfiles(currentFestivalId).catch(() => {});
      }
    };

    const handleProfileJoined = (data: any) => {
      // User joined the current festival
      queryClient.invalidateQueries({ queryKey: ['profiles', currentFestivalId] });
      if (currentFestivalId) {
        useFestivalStore.getState().loadProfiles(currentFestivalId).catch(() => {});
      }
    };

    const handleProfileLeft = (data: any) => {
      // User left the current festival
      queryClient.invalidateQueries({ queryKey: ['profiles', currentFestivalId] });
      if (currentFestivalId) {
        useFestivalStore.getState().loadProfiles(currentFestivalId).catch(() => {});
      }
    };

    const handleCrewUpdated = (data: any) => {
      // Crew membership or details changed
      queryClient.invalidateQueries({ queryKey: ['crews', currentFestivalId] });
    };

    const handleFestivalUpdated = (data: any) => {
      // Festival data changed (lineup, stages, etc.)
      queryClient.invalidateQueries({ queryKey: ['festival', currentFestivalId] });
      queryClient.invalidateQueries({ queryKey: ['sets', currentFestivalId] });
      // Reload festival + days + sets + stages into Zustand
      if (currentFestivalId) {
        useFestivalStore.getState().selectFestival(currentFestivalId).catch(() => {});
      }
    };

    const handlePresenceUpdate = (data: { users: any[] }) => {
      // Update online users list
      if (data.users) {
        setOnlineUsers(data.users);
      }
    };

    const handleConnect = () => {
      setConnected(true);
      if (currentFestivalId) {
        socket.emit('join-festival', { festivalId: currentFestivalId });
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    // Register listeners
    socket.on('picks:updated', handlePicksUpdated);
    socket.on('profile:joined', handleProfileJoined);
    socket.on('profile:left', handleProfileLeft);
    socket.on('crew:updated', handleCrewUpdated);
    socket.on('festival:updated', handleFestivalUpdated);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('picks:updated', handlePicksUpdated);
      socket.off('profile:joined', handleProfileJoined);
      socket.off('profile:left', handleProfileLeft);
      socket.off('crew:updated', handleCrewUpdated);
      socket.off('festival:updated', handleFestivalUpdated);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, currentFestivalId, queryClient, setConnected, setOnlineUsers]);

  return {
    connected,
    onlineUsers,
  };
}
