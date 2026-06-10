// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * useLiveLocationPublisher — platform-agnostic live-location publisher.
 *
 * Given a connected socket, an active crewId, and an INJECTED geolocation
 * watcher (navigator.geolocation.watchPosition on web; Location.watchPositionAsync
 * on mobile), this hook:
 *   1. emits `location:share` on enable (server sets sharingCrewId),
 *   2. starts the injected watcher,
 *   3. throttles fixes via shouldPublishLocation and emits `location:update`,
 *   4. auto-stops after MAX_SESSION_MS (forgotten sharing can't run forever),
 *   5. emits `location:stop` + stops the watcher on disable / unmount / teardown.
 *
 * The actual GPS source is injected so this stays free of platform deps. All
 * coordinate state flows through the non-persisted liveLocationStore — nothing
 * touches disk.
 */

import { useEffect } from 'react';
import type { Socket } from '../services/socket';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { shouldPublishLocation } from '../utils/liveLocation';
import { LIVE_LOCATION } from '../constants/config';

/** A single GPS fix as the injected watcher reports it. */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  /** ISO timestamp at fix time. Defaults to now if the watcher omits it. */
  capturedAt?: string;
}

/**
 * The injected geolocation source. Called once on start; must invoke `onFix` for
 * every new position and return a teardown function that stops watching.
 */
export type GeoWatcher = (onFix: (fix: GeoFix) => void, onError?: (err: unknown) => void) => () => void;

export interface UseLiveLocationPublisherOptions {
  /** A connected (or connecting) socket. */
  socket: Socket | null;
  /** The crew to share to, or null. */
  crewId: string | null;
  /** Master on/off — OFF by default; the UI flips this on explicit opt-in. */
  enabled: boolean;
  /** Injected platform geolocation watcher (navigator / expo-location). */
  watchPosition: GeoWatcher;
  /**
   * Explicit time-box for this session in ms (the user's chosen duration). When
   * omitted, falls back to MAX_SESSION_MS. Sharing auto-stops after this elapses
   * even if the app stays foregrounded — no silent indefinite sharing.
   */
  durationMs?: number;
  /** Called when sharing auto-stops (hit the session time-box) so UI can update. */
  onAutoStop?: () => void;
  /** Called if the geolocation source errors (permission revoked, etc.). */
  onError?: (err: unknown) => void;
}

export function useLiveLocationPublisher({
  socket,
  crewId,
  enabled,
  watchPosition,
  durationMs,
  onAutoStop,
  onError,
}: UseLiveLocationPublisherOptions): void {
  useEffect(() => {
    if (!enabled || !socket || !crewId) return;

    const store = useLiveLocationStore;
    let stopped = false;

    // 1. Declare intent to share. Send the first fix inline once we have it.
    store.getState().startSharing(crewId);
    socket.emit('location:share', { _v: 1, crewId }, () => {});

    // Re-announce on reconnect: the server keeps the share grant on
    // per-connection state (socket.data.sharingCrewId), so a disconnect/
    // reconnect silently kills sharing — every location:update is rejected
    // NOT_SHARING until we re-emit the intent.
    const onReconnect = () => {
      if (!stopped) {
        socket.emit('location:share', { _v: 1, crewId }, () => {});
      }
    };
    socket.on('connect', onReconnect);

    // 2. Start watching. Each fix is throttled before publishing.
    const teardownWatcher = watchPosition(
      (fix) => {
        if (stopped) return;
        const now = Date.now();
        const { lastSentCoord, lastSentAt } = store.getState();
        const next = { lat: fix.lat, lng: fix.lng };
        if (!shouldPublishLocation(lastSentCoord, next, lastSentAt, now)) return;

        socket.emit('location:update', {
          _v: 1,
          crewId,
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy,
          heading: fix.heading,
          speed: fix.speed,
          capturedAt: fix.capturedAt ?? new Date(now).toISOString(),
        });
        store.getState().recordSent(next, now);
      },
      (err) => {
        onError?.(err);
      },
    );

    // 4. Hard session cap: auto-stop at the chosen time-box (or the default
    //    MAX_SESSION_MS when no explicit duration was picked). A non-finite /
    //    non-positive duration falls back to the default rather than never firing.
    const cap =
      typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : LIVE_LOCATION.MAX_SESSION_MS;
    const sessionTimer = setTimeout(() => {
      stop();
      onAutoStop?.();
    }, cap);

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(sessionTimer);
      socket!.off('connect', onReconnect);
      try {
        teardownWatcher();
      } catch {
        /* watcher already torn down */
      }
      // 5. Tell the server + peers we stopped, then clear local sharing state.
      if (socket && socket.connected) socket.emit('location:stop', { _v: 1, crewId: crewId as string });
      store.getState().stopSharing();
    }

    return stop;
    // crewId / enabled / socket / durationMs identity changes re-run the effect
    // (cleanup stops the old session). watchPosition is assumed stable by the
    // caller. onAutoStop / onError are read lazily so they need not be stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, crewId, enabled, durationMs]);
}
