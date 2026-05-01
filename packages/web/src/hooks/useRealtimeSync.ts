import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { useSocket } from '@festie/shared/hooks/useSocket';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useAuthStore } from '@festie/shared/stores/authStore';
import type { OnlineUser } from '@festie/shared/types';
import type {
  ProfileUpdatedPayload,
  ProfileDeletedPayload,
  FestivalIdPayload,
  PresenceUpdatePayload,
  CrewUpdatedPayload,
  CrewMemberEventPayload,
} from '@festie/shared/types/socket-events';

export interface UseRealtimeSyncReturn {
  connected: boolean;
  onlineUsers: OnlineUser[];
}

/**
 * Bridge Socket.IO events to local state. Each event has ONE source of
 * truth — either Zustand (when the data is mirrored in a store) or
 * TanStack Query (for data not modeled in Zustand). We previously
 * invalidated both for every event, causing double-fetches.
 *
 * Source-of-truth decisions:
 *   - pick:updated / pick:removed / note:saved  -> festivalStore.loadProfiles
 *   - profile:updated / profile:joined / profile:left -> festivalStore.loadProfiles
 *   - crew:updated / crew:member-joined / crew:member-left -> crewStore
 *   - festival:updated / festival:set-added / festival:set-updated
 *       -> festivalStore.selectFestival (full reload of festival + sets + stages)
 *   - presence:update -> uiStore (no refetch)
 *
 * Bursty events (festival/set bulk edits, rapid pick toggles) are
 * debounced with a 300ms trailing guard so we issue one reload per burst.
 */
export function useRealtimeSync(): UseRealtimeSyncReturn {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const currentFestivalId = useFestivalStore((state) => state.currentFestivalId);
  const connected = useUIStore((state) => state.connected);
  const setConnected = useUIStore((state) => state.setConnected);
  const onlineUsers = useUIStore((state) => state.onlineUsers);
  const setOnlineUsers = useUIStore((state) => state.setOnlineUsers);
  const user = useAuthStore((state) => state.user);

  // Debounce timers keyed by refetch path. setTimeout ids are numbers in
  // the browser; we store them in a ref to survive re-renders without
  // triggering effect restarts.
  const debouncersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const { socket } = useSocket(currentFestivalId || undefined);

  // Set up Socket.IO event listeners
  useEffect(() => {
    if (!socket) return;

    socketRef.current = socket;

    const schedule = (key: string, fn: () => void, delay = 300) => {
      const timers = debouncersRef.current;
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        delete timers[key];
        fn();
      }, delay);
    };

    const reloadProfiles = () => {
      if (!currentFestivalId) return;
      schedule(`profiles:${currentFestivalId}`, () => {
        useFestivalStore.getState().loadProfiles(currentFestivalId).catch(() => {});
      });
    };

    const reloadFestival = () => {
      if (!currentFestivalId) return;
      schedule(`festival:${currentFestivalId}`, () => {
        useFestivalStore.getState().selectFestival(currentFestivalId).catch(() => {});
      });
    };

    const reloadCrews = (crewId?: string) => {
      schedule('crews', () => {
        useCrewStore.getState().loadCrews().catch(() => {});
        const activeId = useCrewStore.getState().activeCrew?.id;
        const targetId = crewId || activeId;
        if (targetId && targetId === activeId) {
          useCrewStore.getState().selectCrew(targetId).catch(() => {});
        }
      });
    };

    // --- Picks / notes (festivalStore is authoritative) ---
    const handlePickUpdated = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handlePickRemoved = (_data: ProfileDeletedPayload) => reloadProfiles();
    const handleNoteSaved = (_data: ProfileUpdatedPayload) => reloadProfiles();
    // Legacy event name kept during transition (server still emits picks:updated).
    const handlePicksUpdated = (_data: ProfileUpdatedPayload) => reloadProfiles();

    // --- Profiles (festivalStore is authoritative) ---
    const handleProfileUpdated = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handleProfileJoined = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handleProfileLeft = (_data: ProfileDeletedPayload) => reloadProfiles();

    // --- Crews (crewStore is authoritative) ---
    const handleCrewUpdated = (data: CrewUpdatedPayload) => reloadCrews(data?.crewId ?? data?.id);
    const handleCrewMemberAdded = (data: CrewMemberEventPayload) => reloadCrews(data?.crewId);
    const handleCrewMemberRemoved = (data: CrewMemberEventPayload) => reloadCrews(data?.crewId);

    // --- Festival / sets (festivalStore selectFestival reloads everything) ---
    const handleFestivalUpdated = (_data: FestivalIdPayload) => reloadFestival();
    const handleSetAdded = (_data: FestivalIdPayload) => reloadFestival();
    const handleSetUpdated = (_data: FestivalIdPayload) => reloadFestival();

    // --- Presence (uiStore only; no refetch) ---
    const handlePresenceUpdate = (data: PresenceUpdatePayload) => {
      if (data.online) setOnlineUsers(data.online.map(u => ({ id: u.userId, name: u.username, avatar: u.avatarUrl, status: 'online' as const })));
    };

    const handleConnect = () => {
      setConnected(true);
      if (currentFestivalId) {
        socket.emit('join:festival', currentFestivalId, { _v: 1 }, () => {});
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    // Register listeners
    socket.on('pick:updated', handlePickUpdated);
    socket.on('pick:removed', handlePickRemoved);
    socket.on('note:saved', handleNoteSaved);
    socket.on('picks:updated', handlePicksUpdated);

    socket.on('profile:updated', handleProfileUpdated);
    socket.on('profile:joined', handleProfileJoined);
    socket.on('profile:left', handleProfileLeft);

    socket.on('crew:updated', handleCrewUpdated);
    socket.on('crew:member-joined', handleCrewMemberAdded);
    socket.on('crew:member-left', handleCrewMemberRemoved);

    socket.on('festival:updated', handleFestivalUpdated);
    socket.on('festival:set-added', handleSetAdded);
    socket.on('festival:set-updated', handleSetUpdated);

    socket.on('presence:update', handlePresenceUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('pick:updated', handlePickUpdated);
      socket.off('pick:removed', handlePickRemoved);
      socket.off('note:saved', handleNoteSaved);
      socket.off('picks:updated', handlePicksUpdated);

      socket.off('profile:updated', handleProfileUpdated);
      socket.off('profile:joined', handleProfileJoined);
      socket.off('profile:left', handleProfileLeft);

      socket.off('crew:updated', handleCrewUpdated);
      socket.off('crew:member-joined', handleCrewMemberAdded);
      socket.off('crew:member-left', handleCrewMemberRemoved);

      socket.off('festival:updated', handleFestivalUpdated);
      socket.off('festival:set-added', handleSetAdded);
      socket.off('festival:set-updated', handleSetUpdated);

      socket.off('presence:update', handlePresenceUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);

      // Cancel any pending debounced refetches so we don't fire after unmount.
      const timers = debouncersRef.current;
      for (const k of Object.keys(timers)) {
        clearTimeout(timers[k]);
        delete timers[k];
      }
    };
  }, [socket, currentFestivalId, queryClient, setConnected, setOnlineUsers]);

  return {
    connected,
    onlineUsers,
  };
}
