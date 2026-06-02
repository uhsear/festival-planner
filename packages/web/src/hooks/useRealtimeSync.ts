import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { useSocket } from '@festie/shared/hooks/useSocket';
import { useCrewRealtime } from '@festie/shared/hooks/useCrewRealtime';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import type { OnlineUser } from '@festie/shared/types';
import { useCrewQuerySink } from './useCrewQuerySink';
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
 * Opt-in flag for the shared crew sub-feature realtime path (polls / meeting
 * points / expenses / home base over `crew:*` socket events). Default OFF — when
 * `VITE_CREW_REALTIME` is unset (or anything other than '1') the shared hook is
 * still called for stable hook order but is fed a null socket, so it registers
 * no listeners, joins no room, and produces zero behavior change.
 */
const CREW_REALTIME = import.meta.env.VITE_CREW_REALTIME === '1';

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

  // Debounce timers keyed by refetch path. setTimeout ids are numbers in
  // the browser; we store them in a ref to survive re-renders without
  // triggering effect restarts.
  const debouncersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const { socket } = useSocket(currentFestivalId || undefined);

  // ── Crew sub-feature realtime (flag-gated; default OFF) ──────────────────
  // Web crew tabs are TanStack-Query backed, so the sink invalidates query keys
  // (home base is the exception — it applies to the crewStore). Resolve the
  // active crew live so guards reflect the latest open crew. The shared hook is
  // always called (stable hook order); passing socket=null when the flag is off
  // makes it a no-op that registers no listeners and joins no room.
  const crewSink = useCrewQuerySink();
  const getActiveCrewId = useCallback(() => useCrewStore.getState().activeCrew?.id ?? null, []);
  useCrewRealtime({
    socket: CREW_REALTIME ? socket : null,
    getActiveCrewId,
    sink: crewSink,
    joinRoom: true,
  });

  // Set up Socket.IO event listeners
  useEffect(() => {
    if (!socket) return;

    socketRef.current = socket;
    // Copy ref value so the cleanup function uses the snapshot captured at
    // effect-creation time (satisfies react-hooks/exhaustive-deps).
    const timersSnapshot = debouncersRef.current;

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
        useFestivalStore
          .getState()
          .loadProfiles(currentFestivalId)
          .catch(() => {});
      });
    };

    const reloadFestival = () => {
      if (!currentFestivalId) return;
      schedule(`festival:${currentFestivalId}`, () => {
        useFestivalStore
          .getState()
          .selectFestival(currentFestivalId)
          .catch(() => {});
      });
    };

    const reloadCrews = (crewId?: string) => {
      schedule('crews', () => {
        useCrewStore
          .getState()
          .loadCrews()
          .catch(() => {});
        const activeId = useCrewStore.getState().activeCrew?.id;
        const targetId = crewId || activeId;
        if (targetId && targetId === activeId) {
          useCrewStore
            .getState()
            .selectCrew(targetId)
            .catch(() => {});
        }
      });
    };

    // Patch a single profile's picks in place from the socket payload (which
    // carries the full picks map); only fall back to a full /profiles refetch
    // when the profile isn't loaded yet (a brand-new joiner). Avoids re-fetching
    // and re-serializing every profile on each remote pick. (B-6)
    const patchOrReload = (data: ProfileUpdatedPayload) => {
      const patched = useFestivalStore.getState().applyProfilePatch({
        profileId: data?.profileId,
        picks: data?.picks,
      });
      if (!patched) reloadProfiles();
    };

    // --- Picks / notes (festivalStore is authoritative) ---
    const handlePickUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);
    const handlePickRemoved = (_data: ProfileDeletedPayload) => reloadProfiles();
    // note:saved payload carries no notes (notes are per-viewer) — full reload.
    const handleNoteSaved = (_data: ProfileUpdatedPayload) => reloadProfiles();
    // Legacy event name kept during transition (server still emits picks:updated).
    const handlePicksUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);

    // --- Profiles (festivalStore is authoritative) ---
    const handleProfileUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);
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
      if (data.online)
        setOnlineUsers(
          data.online.map((u) => ({ id: u.userId, name: u.username, avatar: u.avatarUrl, status: 'online' as const })),
        );
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
      for (const k of Object.keys(timersSnapshot)) {
        clearTimeout(timersSnapshot[k]);
        delete timersSnapshot[k];
      }
    };
  }, [socket, currentFestivalId, queryClient, setConnected, setOnlineUsers]);

  return {
    connected,
    onlineUsers,
  };
}
