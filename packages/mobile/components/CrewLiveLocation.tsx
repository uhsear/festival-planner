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

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, AppState, Alert, Linking, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useLiveLocationPublisher, type GeoWatcher } from '@festie/shared/hooks';
import { LIVE_LOCATION } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useLiveSocket } from '../lib/liveSocket';

interface CrewLiveLocationProps {
  crewId: string;
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

  // Reset sharing whenever the crew changes — you must re-opt-in per crew.
  useEffect(() => {
    setSharing(false);
  }, [crewId]);

  // Foreground-only: stop sharing the moment the app backgrounds so the toggle
  // is OFF when the user returns (useRealtimeSync emits the server-side stop).
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next.match(/inactive|background/)) setSharing(false);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

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
    setSharing(false);
    Alert.alert(
      'Sharing stopped',
      'Live location sharing auto-stopped after an hour. Turn it back on if you still want your crew to see you.',
    );
  }, []);

  // Keep one ref so the error handler can flip the toggle without re-subscribing.
  const sharingRef = useRef(sharing);
  sharingRef.current = sharing;
  const handleError = useCallback(() => {
    if (!sharingRef.current) return;
    setSharing(false);
    Alert.alert(
      'Location unavailable',
      "Couldn't read your location, so sharing stopped. Check that location is enabled and try again.",
    );
  }, []);

  useLiveLocationPublisher({
    socket,
    crewId,
    enabled: sharing,
    watchPosition,
    onAutoStop: handleAutoStop,
    onError: handleError,
  });

  const enableSharing = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        // canAskAgain === false means the OS won't re-prompt (permanently denied
        // / "Don't allow"); a "try again" here is a dead end, so route the user
        // to Settings instead. Otherwise the next toggle will re-prompt.
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
      setSharing(true);
      haptics.select();
    } catch {
      Alert.alert('Location unavailable', "Couldn't start location sharing. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, haptics]);

  const disableSharing = useCallback(() => {
    setSharing(false);
    haptics.tap();
  }, [haptics]);

  const onToggle = useCallback(
    (next: boolean) => {
      if (next) enableSharing();
      else disableSharing();
    },
    [enableSharing, disableSharing],
  );

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
          value={sharing}
          onValueChange={onToggle}
          disabled={busy}
          trackColor={{ false: t.colors.border.light, true: t.colors.aquaAlpha[30] }}
          thumbColor={sharing ? t.colors.accent.aqua : t.colors.text.muted}
          accessibilityRole="switch"
          accessibilityLabel="Share my live location with this crew"
          accessibilityState={{ checked: sharing, disabled: busy }}
        />
      </View>

      {sharing ? (
        <View
          style={styles.banner}
          accessible
          accessibilityRole="alert"
          accessibilityLabel="You are sharing your live location with this crew"
        >
          <View style={styles.bannerDot} />
          <Text style={styles.bannerText}>You are sharing your live location</Text>
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
  bannerText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
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
