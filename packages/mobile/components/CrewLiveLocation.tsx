// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * CrewLiveLocation — opt-in "Share my live location" control for the active crew.
 *
 * PRIVACY MODEL (see liveLocationStore header): OFF by default, explicit
 * per-session opt-in, scoped to ONE crew, fully ephemeral, foreground-only, and
 * aggressively auto-expiring.
 *  - The toggle is local state that resets to OFF on mount and on every crew
 *    change — nothing is persisted (the store has no persist middleware).
 *  - Enabling requests FOREGROUND location permission only (no background
 *    tracking), then streams Balanced-accuracy fixes through the shared
 *    useLiveLocationPublisher (throttled ~10s / 15m, 60-min hard cap).
 *  - A non-dismissible "You are sharing your live location" banner with a
 *    one-tap Stop is always visible while sharing.
 *  - Backgrounding the app stops sharing (handled here + in useRealtimeSync);
 *    returning requires the user to opt in again (no silent re-share).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, AppState, Alert, Linking, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useLiveLocationPublisher, type GeoWatcher } from '@festie/shared/hooks';
import {
  LIVE_LOCATION,
  LIVE_SHARE_DURATIONS,
  LIVE_SHARE_DEFAULT_DURATION_ID,
  resolveLiveShareMs,
  type LiveShareDuration,
} from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useLiveSocket } from '../lib/liveSocket';

interface CrewLiveLocationProps {
  crewId: string;
}

/** Short local clock label for the auto-expiry, e.g. "3:45 PM". */
function clockLabel(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function CrewLiveLocation({ crewId }: CrewLiveLocationProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const socket = useLiveSocket();

  // Local per-session intent — OFF by default and reset on crew change. This is
  // the source of truth the publisher's `enabled` reads from.
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The opt-in duration sheet is open (picking a time-box before sharing starts).
  const [choosing, setChoosing] = useState(false);
  // The chosen time-box (ms) + the wall-clock instant it auto-expires, for the
  // banner copy and the publisher's auto-stop. Null while not sharing.
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const resetShare = useCallback(() => {
    setSharing(false);
    setChoosing(false);
    setDurationMs(null);
    setExpiresAt(null);
  }, []);

  // Reset sharing whenever the crew changes — you must re-opt-in per crew.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient share state on crew change
    resetShare();
  }, [crewId, resetShare]);

  // Foreground-only: stop sharing the moment the app backgrounds so the toggle
  // is OFF when the user returns (useRealtimeSync emits the server-side stop).
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next.match(/inactive|background/)) resetShare();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [resetShare]);

  // expo-location → GeoFix adapter for the shared publisher. watchPositionAsync
  // is async; we hold the subscription and tear it down synchronously.
  const watchPosition = useCallback<GeoWatcher>((onFix, onError) => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: LIVE_LOCATION.UPDATE_INTERVAL_MS,
        distanceInterval: LIVE_LOCATION.MIN_MOVE_METERS,
      },
      (pos) => {
        onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          heading: pos.coords.heading ?? undefined,
          speed: pos.coords.speed ?? undefined,
          capturedAt: new Date(pos.timestamp).toISOString(),
        });
      },
    )
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch((err) => onError?.(err));
    return () => {
      cancelled = true;
      sub?.remove();
      sub = null;
    };
  }, []);

  const handleAutoStop = useCallback(() => {
    resetShare();
    Alert.alert(
      'Sharing stopped',
      'Your live location sharing reached its time limit and stopped. Turn it back on if you still want your crew to see you.',
    );
  }, [resetShare]);

  // Keep one ref so the error handler can flip the toggle without re-subscribing.
  const sharingRef = useRef(sharing);
  useEffect(() => {
    sharingRef.current = sharing;
  }, [sharing]);
  const handleError = useCallback(() => {
    if (!sharingRef.current) return;
    resetShare();
    Alert.alert(
      'Location unavailable',
      "Couldn't read your location, so sharing stopped. Check that location is enabled and try again.",
    );
  }, [resetShare]);

  useLiveLocationPublisher({
    socket,
    crewId,
    enabled: sharing,
    watchPosition,
    durationMs: durationMs ?? undefined,
    onAutoStop: handleAutoStop,
    onError: handleError,
  });

  // Pick a time-box → request permission → start sharing for that duration.
  const startSharing = useCallback(
    async (duration: LiveShareDuration) => {
      if (busy) return;
      setBusy(true);
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          // canAskAgain === false means the OS won't re-prompt (permanently
          // denied / "Don't allow"); a "try again" here is a dead end, so route
          // the user to Settings instead. Otherwise the next attempt re-prompts.
          if (perm.canAskAgain === false) {
            Alert.alert(
              'Location permission needed',
              'Location is turned off for Festie. Open Settings to allow location access while using the app, then turn sharing back on.',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
            );
          } else {
            Alert.alert(
              'Location permission needed',
              'To share your live location with this crew, allow location access while using the app, then try again.',
            );
          }
          return;
        }
        const ms = resolveLiveShareMs(duration);
        setDurationMs(ms);
        setExpiresAt(Date.now() + ms);
        setChoosing(false);
        setSharing(true);
        haptics.select();
      } catch {
        Alert.alert('Location unavailable', "Couldn't start location sharing. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, haptics],
  );

  const disableSharing = useCallback(() => {
    resetShare();
    haptics.tap();
  }, [resetShare, haptics]);

  // The Switch opens the duration sheet (sharing only starts once a time-box is
  // picked — value stays OFF until then); switching off cancels/stops.
  const onToggle = useCallback(
    (next: boolean) => {
      if (next) {
        setChoosing(true);
        haptics.tap();
      } else {
        setChoosing(false);
        disableSharing();
      }
    },
    [disableSharing, haptics],
  );

  const untilLabel = useMemo(() => (expiresAt ? clockLabel(expiresAt) : ''), [expiresAt]);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="navigate-circle-outline" size={20} color={t.colors.accent.aqua} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Share my live location</Text>
          <Text style={styles.rowSub}>
            Only this crew can see it, only while the app is open. Off by default — it stops when you close the app.
          </Text>
        </View>
        <Switch
          value={sharing || choosing}
          onValueChange={onToggle}
          disabled={busy}
          trackColor={{ false: t.colors.border.light, true: t.colors.aquaAlpha[30] }}
          thumbColor={sharing || choosing ? t.colors.accent.aqua : t.colors.text.muted}
          accessibilityRole="switch"
          accessibilityLabel="Share my live location with this crew"
          accessibilityState={{ checked: sharing, disabled: busy }}
        />
      </View>

      {/* Duration sheet — explicit opt-in time-box before any sharing starts. */}
      {choosing && !sharing ? (
        <View style={styles.chooser} accessible accessibilityLabel="Choose how long to share your live location">
          <Text style={styles.chooserTitle}>Share your location for…</Text>
          <View style={styles.chooserOptions}>
            {LIVE_SHARE_DURATIONS.map((d) => {
              const isDefault = d.id === LIVE_SHARE_DEFAULT_DURATION_ID;
              return (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => startSharing(d)}
                  disabled={busy}
                  style={[styles.durationChip, isDefault && styles.durationChipDefault]}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Share for ${d.label}`}
                >
                  <Text style={[styles.durationChipText, isDefault && styles.durationChipTextDefault]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            onPress={() => setChoosing(false)}
            style={styles.chooserCancel}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel sharing"
          >
            <Text style={styles.chooserCancelText}>Not now</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {sharing ? (
        <View
          style={styles.banner}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={
            untilLabel
              ? `You are sharing your live location with this crew until ${untilLabel}`
              : 'You are sharing your live location with this crew'
          }
        >
          <View style={styles.bannerDot} />
          <View style={styles.bannerBody}>
            <Text style={styles.bannerText}>You are sharing your live location</Text>
            {untilLabel ? <Text style={styles.bannerSub}>Until {untilLabel} · stops if you leave the app</Text> : null}
          </View>
          <TouchableOpacity
            onPress={disableSharing}
            style={styles.stopButton}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Stop sharing my live location"
          >
            <Text style={styles.stopButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  rowIcon: {
    width: 28,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  rowSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  bannerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.colors.accent.aqua,
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  bannerSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  chooser: {
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chooserTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  chooserOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  durationChip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
  },
  durationChipDefault: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  durationChipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  durationChipTextDefault: {
    color: t.colors.accent.aqua,
  },
  chooserCancel: {
    alignSelf: 'flex-start',
    paddingVertical: t.spacing[1],
    minHeight: 44,
    justifyContent: 'center',
  },
  chooserCancelText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  stopButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  stopButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
