import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useRouter } from 'expo-router';
import { createSocket } from '@festie/shared/services';
// Import the Socket type from the shared barrel (which re-exports it) rather
// than from 'socket.io-client' directly: socket.io-client is a dependency of
// @festie/shared, not of packages/mobile, so a direct import resolves locally
// (hoisted) but fails the CI mobile typecheck (TS2307) where mobile deps aren't
// installed.
import type { Socket } from '@festie/shared/services';
import {
  useAuthStore,
  useUIStore,
  useFestivalDataStore,
  useCrewStore,
  useLiveLocationStore,
} from '@festie/shared/stores';
import { useCrewRealtime, useRevocationRealtime } from '@festie/shared/hooks';
// createStoreSink lives in @festie/shared's realtime module, re-exported by the
// package root barrel (src/index.ts). There is no dedicated `./realtime` subpath
// export, so it is imported from the bare '@festie/shared' entry, which the
// package `exports` map resolves. It is the package itself (not a transitive
// dep), so it is safe for the mobile typecheck and the Metro bundle.
import { createStoreSink } from '@festie/shared';
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
import { setLiveSocket, useLiveSocket } from '../lib/liveSocket';

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
  // Active crew drives which crew:* room we join; re-run the effect on change
  // so we leave the old room and join the new one (crew sub-feature events are
  // scoped to the `crew:${crewId}` room server-side).
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  const connected = useUIStore((s) => s.connected);
  const setConnected = useUIStore((s) => s.setConnected);
  const onlineUsers = useUIStore((s) => s.onlineUsers);
  const setOnlineUsers = useUIStore((s) => s.setOnlineUsers);

  // ── Crew sub-feature + Live Location/SOS realtime ────────────────────────
  // Delegate crew:* / location:* / sos:* socket routing to the shared hook (the
  // same one web consumes) instead of hand-rolling ~160 lines here. It reads the
  // socket this hook owns — published via setLiveSocket, read back via
  // useLiveSocket — registers its own crew:*/location:*/sos:* listeners, runs
  // each payload through the pure router + crew guards, and (joinRoom) owns the
  // join/leave:crew emits. Mobile keeps only what the shared hook does NOT own:
  // socket construction/teardown, AppState lifecycle, join/leave:festival,
  // presence, picks/profiles/festival reloads, and the liveLocationStore crew
  // scoping in the effect below (setActiveCrew) — the sole reset of peer/SOS
  // state on a crew switch, which neither the shared hook nor the sink performs.
  const liveSocket = useLiveSocket();
  const getActiveCrewId = useCallback(() => useCrewStore.getState().activeCrew?.id ?? null, []);
  const crewSink = useMemo(() => createStoreSink(useCrewStore, useLiveLocationStore), []);
  useCrewRealtime({ socket: liveSocket, getActiveCrewId, sink: crewSink, joinRoom: true });

  // ── Authorization revocation ────────────────────────────────────────────
  // session:revoked / crew:access-revoked / crew:member-kicked. State teardown
  // lives in @festie/shared; only the route-out is mobile-specific (mirrors the
  // account screen's sign-out, which also router.replace's to the auth stack).
  const router = useRouter();
  useRevocationRealtime({
    socket: liveSocket,
    onSessionRevoked: () => router.replace('/(auth)/login'),
  });

  // Debounce timers to coalesce bursty socket events into single store reloads.
  const debouncersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Socket connection lifecycle ─────────────────────────────────────────
  useEffect(() => {
    // Keep the ephemeral live-location store scoped to the active crew so peer/
    // SOS guards (and the publisher) target the right crew. A crew change resets
    // peers + SOS + any in-flight sharing (no silent cross-crew bleed).
    useLiveLocationStore.getState().setActiveCrew(useCrewStore.getState().activeCrew?.id ?? null);

    // Don't connect without auth or a selected festival.
    if (!userToken || !currentFestivalId) {
      // Tear down any existing socket from a previous render.
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      setLiveSocket(null);
      return;
    }

    const socket = createSocket(userToken, 'https://festie.us', () => {
      // Socket auth failed — attempt a single refresh, then reconnect with the
      // new token. On failure stay disconnected (HTTP/foreground path recovers).
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
    socketRef.current = socket;
    // Expose this socket to the Live Location publisher (crew screen) which emits
    // location:* on it. Cleared on teardown so a torn-down socket isn't reused.
    setLiveSocket(socket);

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
        useFestivalDataStore
          .getState()
          .loadProfiles(festivalId)
          .catch(() => {});
      });
    };

    const reloadFestival = () => {
      const festivalId = useFestivalDataStore.getState().currentFestivalId;
      if (!festivalId) return;
      schedule(`festival:${festivalId}`, () => {
        useFestivalDataStore
          .getState()
          .selectFestival(festivalId)
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

    // ── Event handlers ─────────────────────────────────────────────────
    // Patch a single profile's picks in place from the socket payload (carries
    // the full picks map); fall back to a full reload only for an unloaded
    // profile (new joiner). Avoids refetching every profile per remote pick. (B-6)
    const patchOrReload = (data: ProfileUpdatedPayload) => {
      const patched = useFestivalDataStore.getState().applyProfilePatch({
        profileId: data?.profileId,
        picks: data?.picks,
      });
      if (!patched) reloadProfiles();
    };

    // Picks / notes -> festivalDataStore
    const handlePickUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);
    const handlePickRemoved = (_data: ProfileDeletedPayload) => reloadProfiles();
    const handleNoteSaved = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handlePicksUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);

    // Profiles -> festivalDataStore
    const handleProfileUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);
    const handleProfileJoined = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handleProfileLeft = (_data: ProfileDeletedPayload) => reloadProfiles();

    // Crews -> crewStore
    const handleCrewUpdated = (data: CrewUpdatedPayload) => reloadCrews(data?.crewId ?? data?.id);
    const handleCrewMemberAdded = (data: CrewMemberEventPayload) => reloadCrews(data?.crewId);
    const handleCrewMemberRemoved = (data: CrewMemberEventPayload) => reloadCrews(data?.crewId);

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
      // The active crew room join is owned by useCrewRealtime (joinRoom: true),
      // which registers its own 'connect' handler and emits join:crew — so it is
      // deliberately NOT emitted here (doing both would double-join per connect).
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
        // FOREGROUND BACKFILL: the socket was disconnected while backgrounded, so
        // any festival/pick/crew events emitted meanwhile were missed. Fire the
        // same debounced reloads the socket-event handlers use so state catches
        // up automatically (debounce coalesces these with each other).
        reloadFestival();
        reloadProfiles();
        reloadCrews();
      } else if (nextAppState.match(/inactive|background/) && prev === 'active') {
        // Going to background — disconnect to save battery / bandwidth.
        if (socket.connected) {
          // Foreground-only live location: stop sharing the moment we background.
          // The server also force-stops on the disconnect below; this explicit
          // stop is immediate + clears local sharing state so there's no ghost
          // marker and no silent re-share when we return (user must re-opt-in).
          const sharingCrewId = useLiveLocationStore.getState().sharingCrewId;
          if (sharingCrewId) {
            socket.emit('location:stop', { _v: 1, crewId: sharingCrewId });
            useLiveLocationStore.getState().stopSharing();
          }
          const festivalId = useFestivalDataStore.getState().currentFestivalId;
          if (festivalId) {
            socket.emit('leave:festival');
          }
          const crewId = useCrewStore.getState().activeCrew?.id;
          if (crewId) {
            socket.emit('leave:crew', { _v: 1, crewId });
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

      // Stop any in-flight live-location sharing before tearing down the socket
      // (no ghost markers; server also auto-stops on disconnect).
      const sharingCrewId = useLiveLocationStore.getState().sharingCrewId;
      if (socket.connected && sharingCrewId) {
        socket.emit('location:stop', { _v: 1, crewId: sharingCrewId });
      }
      useLiveLocationStore.getState().stopSharing();

      // Leave the crew room before tearing down (no-op if not joined).
      const leftCrewId = useCrewStore.getState().activeCrew?.id;
      if (socket.connected && leftCrewId) {
        socket.emit('leave:crew', { _v: 1, crewId: leftCrewId });
      }

      socket.disconnect();
      socketRef.current = null;
      setLiveSocket(null);
    };
  }, [userToken, currentFestivalId, activeCrewId, setConnected, setOnlineUsers]);

  return { connected, onlineUsers };
}
