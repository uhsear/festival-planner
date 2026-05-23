import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Socket } from 'socket.io-client';
import { createSocket } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores';
import type { OnlineUser } from '@festie/shared/types';
import type {
  ProfileUpdatedPayload,
  ProfileDeletedPayload,
  FestivalIdPayload,
  PresenceUpdatePayload,
  PresenceUser,
  CrewUpdatedPayload,
  CrewMemberEventPayload,
} from '@festie/shared/types/socket-events';

export interface UseRealtimeSyncReturn {
  connected: boolean;
  onlineUsers: OnlineUser[];
}

/**
 * Mobile real-time sync hook. Mirrors the web `useRealtimeSync` behavior but
 * adds React Native AppState lifecycle management:
 * - Connects when a festival is selected and user is authenticated
 * - Disconnects when the app moves to background
 * - Reconnects when the app returns to foreground
 * - Disconnects on logout (userToken becomes null)
 *
 * Socket events flow into the shared Zustand stores (festivalDataStore,
 * crewStore, uiStore) so the rest of the app reacts automatically.
 */
export function useRealtimeSync(): UseRealtimeSyncReturn {
  const socketRef = useRef<Socket | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const userToken = useAuthStore((s) => s.userToken);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const connected = useUIStore((s) => s.connected);
  const setConnected = useUIStore((s) => s.setConnected);
  const onlineUsers = useUIStore((s) => s.onlineUsers);
  const setOnlineUsers = useUIStore((s) => s.setOnlineUsers);

  // Debounce timers to coalesce bursty socket events into single store reloads.
  const debouncersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Socket connection lifecycle ─────────────────────────────────────────
  useEffect(() => {
    // Don't connect without auth or a selected festival.
    if (!userToken || !currentFestivalId) {
      // Tear down any existing socket from a previous render.
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    const socket = createSocket(userToken, 'https://festie.us');
    socketRef.current = socket;

    const timersSnapshot = debouncersRef.current;

    // ── Debounced store reloaders ───────────────────────────────────────
    const schedule = (key: string, fn: () => void, delay = 300) => {
      const timers = debouncersRef.current;
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        delete timers[key];
        fn();
      }, delay);
    };

    const reloadProfiles = () => {
      const festivalId = useFestivalDataStore.getState().currentFestivalId;
      if (!festivalId) return;
      schedule(`profiles:${festivalId}`, () => {
        useFestivalDataStore.getState().loadProfiles(festivalId).catch(() => {});
      });
    };

    const reloadFestival = () => {
      const festivalId = useFestivalDataStore.getState().currentFestivalId;
      if (!festivalId) return;
      schedule(`festival:${festivalId}`, () => {
        useFestivalDataStore.getState().selectFestival(festivalId).catch(() => {});
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

    // ── Event handlers ─────────────────────────────────────────────────
    // Picks / notes -> festivalDataStore
    const handlePickUpdated = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handlePickRemoved = (_data: ProfileDeletedPayload) => reloadProfiles();
    const handleNoteSaved = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handlePicksUpdated = (_data: ProfileUpdatedPayload) => reloadProfiles();

    // Profiles -> festivalDataStore
    const handleProfileUpdated = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handleProfileJoined = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handleProfileLeft = (_data: ProfileDeletedPayload) => reloadProfiles();

    // Crews -> crewStore
    const handleCrewUpdated = (data: CrewUpdatedPayload) =>
      reloadCrews(data?.crewId ?? data?.id);
    const handleCrewMemberAdded = (data: CrewMemberEventPayload) =>
      reloadCrews(data?.crewId);
    const handleCrewMemberRemoved = (data: CrewMemberEventPayload) =>
      reloadCrews(data?.crewId);

    // Festival / sets -> festivalDataStore full reload
    const handleFestivalUpdated = (_data: FestivalIdPayload) => reloadFestival();
    const handleSetAdded = (_data: FestivalIdPayload) => reloadFestival();
    const handleSetUpdated = (_data: FestivalIdPayload) => reloadFestival();

    // Presence -> uiStore only (no API refetch)
    const handlePresenceUpdate = (data: PresenceUpdatePayload) => {
      if (data.online) {
        setOnlineUsers(
          data.online.map((u: PresenceUser) => ({
            id: u.userId,
            name: u.username,
            avatar: u.avatarUrl,
            status: 'online' as const,
          })),
        );
      }
    };

    const handleConnect = () => {
      setConnected(true);
      const festivalId = useFestivalDataStore.getState().currentFestivalId;
      if (festivalId) {
        socket.emit('join:festival', festivalId, { _v: 1 }, () => {});
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    // ── Register listeners ─────────────────────────────────────────────
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

    // ── AppState lifecycle (background / foreground) ───────────────────
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextAppState;

      if (nextAppState === 'active' && prev.match(/inactive|background/)) {
        // Returning to foreground — reconnect if disconnected.
        if (!socket.connected) {
          socket.connect();
        }
      } else if (nextAppState.match(/inactive|background/) && prev === 'active') {
        // Going to background — disconnect to save battery / bandwidth.
        if (socket.connected) {
          const festivalId = useFestivalDataStore.getState().currentFestivalId;
          if (festivalId) {
            socket.emit('leave:festival');
          }
          socket.disconnect();
        }
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // ── Cleanup ────────────────────────────────────────────────────────
    return () => {
      appStateSub.remove();

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

      // Cancel pending debounced reloads.
      for (const k of Object.keys(timersSnapshot)) {
        clearTimeout(timersSnapshot[k]);
        delete timersSnapshot[k];
      }

      socket.disconnect();
      socketRef.current = null;
    };
  }, [userToken, currentFestivalId, setConnected, setOnlineUsers]);

  return { connected, onlineUsers };
}
