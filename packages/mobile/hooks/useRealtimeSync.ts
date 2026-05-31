import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createSocket } from '@festie/shared/services';
// Import the Socket type from the shared barrel (which re-exports it) rather
// than from 'socket.io-client' directly: socket.io-client is a dependency of
// @festie/shared, not of packages/mobile, so a direct import resolves locally
// (hoisted) but fails the CI mobile typecheck (TS2307) where mobile deps aren't
// installed.
import type { Socket } from '@festie/shared/services';
import { useAuthStore , useUIStore , useFestivalDataStore , useCrewStore } from '@festie/shared/stores';



import type { OnlineUser , CrewMeetingPoint } from '@festie/shared/types';
import type {
  ProfileUpdatedPayload,
  ProfileDeletedPayload,
  FestivalIdPayload,
  PresenceUpdatePayload,
  PresenceUser,
  CrewUpdatedPayload,
  CrewMemberEventPayload,
  CrewHomeBaseUpdatedPayload,
  CrewMeetingPointPayload,
  CrewMeetingPointRemovedPayload,
  CrewPollCreatedPayload,
  CrewPollVotedPayload,
  CrewPollClosedPayload,
  CrewExpensePayload,
  CrewExpenseDeletedPayload,
  CrewActivityPayload,
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
  // Active crew drives which crew:* room we join; re-run the effect on change
  // so we leave the old room and join the new one (crew sub-feature events are
  // scoped to the `crew:${crewId}` room server-side).
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);
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

    // Resolve the crewId a crew sub-feature event applies to. Poll events do
    // not carry crewId in the payload; since join:crew scopes us to a single
    // crew room, the active crew is the authoritative resolution. Returns null
    // when there is no active crew (nothing to update).
    const getActiveCrewId = () => useCrewStore.getState().activeCrew?.id ?? null;

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
    const handleCrewUpdated = (data: CrewUpdatedPayload) =>
      reloadCrews(data?.crewId ?? data?.id);
    const handleCrewMemberAdded = (data: CrewMemberEventPayload) =>
      reloadCrews(data?.crewId);
    const handleCrewMemberRemoved = (data: CrewMemberEventPayload) =>
      reloadCrews(data?.crewId);

    // Crew sub-features (home base / meeting points / polls). These mutate the
    // crewStore in place via additive socket-driven setters so the open crew
    // screen reflects remote changes live. Every handler guards on the active
    // crew: the screen only ever shows the active crew's sub-data.
    const handleCrewHomeBaseUpdated = (data: CrewHomeBaseUpdatedPayload) => {
      const activeId = getActiveCrewId();
      if (!activeId || data?.crewId !== activeId) return;
      useCrewStore
        .getState()
        .applyHomeBaseUpdate(data.crewId, {
          location: data.location,
          time: data.time,
        });
    };

    const handleMeetingPointUpserted = (data: CrewMeetingPointPayload) => {
      const activeId = getActiveCrewId();
      // The created/updated payload is the raw serialized row, whose crew id is
      // snake_case (`crew_id`); only fall back to camelCase for safety.
      const mpCrewId =
        (data as { crew_id?: string; crewId?: string })?.crew_id ??
        (data as { crewId?: string })?.crewId;
      if (!activeId || mpCrewId !== activeId) return;
      useCrewStore
        .getState()
        .applyMeetingPointUpsert(data as unknown as CrewMeetingPoint);
    };

    const handleMeetingPointRemoved = (data: CrewMeetingPointRemovedPayload) => {
      const activeId = getActiveCrewId();
      if (!activeId || data?.crewId !== activeId) return;
      useCrewStore.getState().applyMeetingPointRemoval(data.id);
    };

    const handlePollCreated = (_data: CrewPollCreatedPayload) => {
      const activeId = getActiveCrewId();
      if (!activeId) return;
      // Poll-created payload lacks crewId; the active crew room scopes it. The
      // payload also lacks the full poll shape, so reload the authoritative
      // list (debounced) to pick up created_at / closed / votes consistently.
      schedule(`crew-polls:${activeId}`, () => {
        const id = useCrewStore.getState().activeCrew?.id;
        if (!id) return;
        useCrewStore.getState().loadPolls(id).catch(() => {});
      });
    };

    const handlePollVoted = (data: CrewPollVotedPayload) => {
      const activeId = getActiveCrewId();
      if (!activeId) return;
      useCrewStore
        .getState()
        .applyPollVote(data.pollId, data.userId, data.optionIndex);
    };

    const handlePollClosed = (data: CrewPollClosedPayload) => {
      const activeId = getActiveCrewId();
      if (!activeId) return;
      useCrewStore.getState().applyPollClosed(data.pollId);
    };

    // Expenses + activity (added with the Phase 2 crew features). These carry an
    // explicit camelCase crewId. Reload the authoritative lists (debounced) so
    // balances/feed stay consistent without trusting partial payloads.
    const handleExpenseChanged = (
      data: CrewExpensePayload | CrewExpenseDeletedPayload,
    ) => {
      const activeId = getActiveCrewId();
      if (!activeId || data?.crewId !== activeId) return;
      schedule(`crew-expenses:${activeId}`, () => {
        const id = useCrewStore.getState().activeCrew?.id;
        if (id) useCrewStore.getState().loadExpenses(id).catch(() => {});
      });
    };

    const handleActivityLogged = (data: CrewActivityPayload) => {
      const activeId = getActiveCrewId();
      if (!activeId || data?.crewId !== activeId) return;
      schedule(`crew-activity:${activeId}`, () => {
        const id = useCrewStore.getState().activeCrew?.id;
        if (id) useCrewStore.getState().loadActivity(id).catch(() => {});
      });
    };

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
      // Join the active crew room so crew sub-feature events (home base /
      // meeting points / polls) — all emitted to `crew:${crewId}` — reach us.
      const crewId = useCrewStore.getState().activeCrew?.id;
      if (crewId) {
        socket.emit('join:crew', { _v: 1, crewId }, () => {});
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

    socket.on('crew:home-base-updated', handleCrewHomeBaseUpdated);
    socket.on('crew:meeting-point-created', handleMeetingPointUpserted);
    socket.on('crew:meeting-point-updated', handleMeetingPointUpserted);
    socket.on('crew:meeting-point-removed', handleMeetingPointRemoved);
    socket.on('crew:poll-created', handlePollCreated);
    socket.on('crew:poll-voted', handlePollVoted);
    socket.on('crew:poll-closed', handlePollClosed);
    socket.on('crew:expense-added', handleExpenseChanged);
    socket.on('crew:expense-deleted', handleExpenseChanged);
    socket.on('crew:activity', handleActivityLogged);

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

      socket.off('crew:home-base-updated', handleCrewHomeBaseUpdated);
      socket.off('crew:meeting-point-created', handleMeetingPointUpserted);
      socket.off('crew:meeting-point-updated', handleMeetingPointUpserted);
      socket.off('crew:meeting-point-removed', handleMeetingPointRemoved);
      socket.off('crew:poll-created', handlePollCreated);
      socket.off('crew:poll-voted', handlePollVoted);
      socket.off('crew:poll-closed', handlePollClosed);
      socket.off('crew:expense-added', handleExpenseChanged);
      socket.off('crew:expense-deleted', handleExpenseChanged);
      socket.off('crew:activity', handleActivityLogged);

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

      // Leave the crew room before tearing down (no-op if not joined).
      const leftCrewId = useCrewStore.getState().activeCrew?.id;
      if (socket.connected && leftCrewId) {
        socket.emit('leave:crew', { _v: 1, crewId: leftCrewId });
      }

      socket.disconnect();
      socketRef.current = null;
    };
  }, [userToken, currentFestivalId, activeCrewId, setConnected, setOnlineUsers]);

  return { connected, onlineUsers };
}
