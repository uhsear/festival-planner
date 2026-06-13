// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * MeetingPointCompass.tsx — M5 proximity compass (mobile-only).
 *
 * Points an on-screen arrow at a SAVED meeting-point coord and shows the
 * straight-line distance. Direction comes from the device magnetometer
 * (expo-sensors) for heading + a one-shot GPS read (expo-location) for the
 * viewer's position; the bearing/distance math is the pure shared geo util.
 *
 * OFFLINE-HONEST: this is 100% on-device and uses ZERO network. The distance is
 * straight-line ("as the crow flies") to a point YOU saved, not a routed or
 * live position — the copy says so. It is never presented as real-time tracking
 * of another person.
 *
 * Graceful degradation: permission-denied, sensor-unavailable, and no-coords
 * (legacy free-text meeting point) states each render an honest explanation
 * instead of a spinning or bogus arrow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Magnetometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { bearing, haversineDistance, relativeArrowAngle, formatDistance } from '@festie/shared/utils';
import type { Coord } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';

/** A saved meeting-point target: a label plus its captured coords. */
export interface MeetingPointTarget {
  label: string;
  latitude: number;
  longitude: number;
}

interface MeetingPointCompassProps {
  target: MeetingPointTarget;
}

/**
 * Convert a raw magnetometer (x, y) reading into a heading in degrees clockwise
 * from magnetic north [0, 360). Assumes the phone is held flat-ish (portrait);
 * this is a coarse heading, good enough to point a "this way" arrow, not a
 * survey-grade bearing. Kept local because it is tied to the sensor's frame.
 */
function magnetometerHeading(x: number, y: number): number {
  let angle = Math.atan2(y, x) * (180 / Math.PI);
  angle = (angle + 360) % 360;
  return angle;
}

/**
 * Exponential low-pass smoothing of a heading in degrees, done on the unit
 * circle so it wraps correctly across the 0/360 seam (naive averaging would
 * jump halfway around when crossing north). alpha in (0,1]; smaller = smoother.
 */
function smoothHeading(prev: number | null, next: number, alpha: number): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  const pr = (prev * Math.PI) / 180;
  const nx = (next * Math.PI) / 180;
  const sinv = (1 - alpha) * Math.sin(pr) + alpha * Math.sin(nx);
  const cosv = (1 - alpha) * Math.cos(pr) + alpha * Math.cos(nx);
  const deg = (Math.atan2(sinv, cosv) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const SMOOTHING_ALPHA = 0.15; // low-pass factor — small = calm needle
const UPDATE_INTERVAL_MS = 100;

type Phase = 'init' | 'denied' | 'no-sensor' | 'no-coords' | 'ready';

export default function MeetingPointCompass({ target }: MeetingPointCompassProps) {
  const t = useTokens();
  const styles = useStyles();

  // Memoized on the coord primitives so its identity is stable across renders;
  // this lets the sensor/GPS effects depend on `targetCoord` directly (they only
  // re-subscribe when the actual lat/lng change, not on every render).
  const targetCoord: Coord | null = useMemo(
    () =>
      Number.isFinite(target.latitude) && Number.isFinite(target.longitude)
        ? { latitude: target.latitude, longitude: target.longitude }
        : null,
    [target.latitude, target.longitude],
  );

  const [phase, setPhase] = useState<Phase>(targetCoord ? 'init' : 'no-coords');
  const [heading, setHeading] = useState<number>(0); // smoothed, degrees CW from north
  const [origin, setOrigin] = useState<Coord | null>(null);
  const smoothedRef = useRef<number | null>(null);

  // ── Magnetometer subscription (heading) ──────────────────────────────────
  useEffect(() => {
    if (!targetCoord) return;
    let sub: ReturnType<typeof Magnetometer.addListener> | null = null;
    let cancelled = false;

    (async () => {
      const available = await Magnetometer.isAvailableAsync().catch(() => false);
      if (cancelled) return;
      if (!available) {
        setPhase((p) => (p === 'init' ? 'no-sensor' : p));
        return;
      }
      Magnetometer.setUpdateInterval(UPDATE_INTERVAL_MS);
      sub = Magnetometer.addListener(({ x, y }) => {
        const raw = magnetometerHeading(x, y);
        const next = smoothHeading(smoothedRef.current, raw, SMOOTHING_ALPHA);
        smoothedRef.current = next;
        setHeading(next);
      });
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      sub = null;
    };
  }, [targetCoord]);

  // ── One-shot GPS read (viewer position) ──────────────────────────────────
  useEffect(() => {
    if (!targetCoord) return;
    let cancelled = false;

    (async () => {
      let granted = false;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        granted = perm.granted;
      } catch {
        granted = false;
      }
      if (cancelled) return;
      if (!granted) {
        setPhase('denied');
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setOrigin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('denied');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetCoord]);

  // ── Derived bearing / distance / arrow rotation ──────────────────────────
  const brng = origin && targetCoord ? bearing(origin, targetCoord) : NaN;
  const distanceM = origin && targetCoord ? haversineDistance(origin, targetCoord) : NaN;
  const arrowAngle = relativeArrowAngle(brng, heading);
  const hasFix = Number.isFinite(arrowAngle);

  // ── Non-ready states ─────────────────────────────────────────────────────
  if (phase === 'no-coords') {
    return (
      <View style={styles.stateCard}>
        <Ionicons name="navigate-outline" size={40} color={t.colors.text.muted} />
        <Text style={styles.stateTitle}>No saved coordinates</Text>
        <Text style={styles.stateBody}>
          “{target.label}” is a text-only meeting point. Re-save it with a captured location to use the compass.
        </Text>
      </View>
    );
  }

  if (phase === 'denied') {
    return (
      <View style={styles.stateCard}>
        <Ionicons name="location-outline" size={40} color={t.colors.accent.amber} />
        <Text style={styles.stateTitle}>Location permission needed</Text>
        <Text style={styles.stateBody}>
          The compass needs your location to point toward “{target.label}”. Enable location access in Settings, then
          reopen this screen.
        </Text>
      </View>
    );
  }

  if (phase === 'no-sensor') {
    return (
      <View style={styles.stateCard}>
        <Ionicons name="compass-outline" size={40} color={t.colors.text.muted} />
        <Text style={styles.stateTitle}>No compass on this device</Text>
        <Text style={styles.stateBody}>
          This device has no magnetometer, so the arrow can’t track which way you’re facing. The distance below is still
          accurate.
        </Text>
        <Text
          style={styles.distance}
          accessibilityRole="text"
          accessibilityLabel={`${formatDistance(distanceM)} to ${target.label}, straight-line distance`}
        >
          {formatDistance(distanceM)}
        </Text>
      </View>
    );
  }

  if (phase === 'init' || !hasFix) {
    return (
      <View style={styles.stateCard}>
        <ActivityIndicator color={t.colors.accent.aqua} />
        <Text style={styles.stateBody}>Getting your bearings…</Text>
      </View>
    );
  }

  // ── Ready: arrow + distance ──────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={styles.label} numberOfLines={2}>
        {target.label}
      </Text>

      {/*
        a11y: The dial is a decorative, animated visual aid — the arrow rotates
        with the live magnetometer heading, which a static image role/label can
        neither convey nor keep current. So the dial itself is hidden from the
        a11y tree (importantForAccessibility/accessibilityElementsHidden) and the
        meaningful data — direction + distance — is surfaced together as a single
        live "status" region below, announced on each magnetometer tick.
      */}
      <View style={styles.dial} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[styles.arrow, { transform: [{ rotate: `${arrowAngle}deg` }] }]}>
          <Ionicons name="navigate" size={96} color={t.colors.accent.aqua} />
        </View>
      </View>

      <Text
        style={styles.distance}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${formatDistance(distanceM)} to ${target.label}, straight-line direction`}
      >
        {formatDistance(distanceM)}
      </Text>
      <Text style={styles.honest}>Straight-line direction to a point you saved · on-device, no live tracking</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'center',
    gap: t.spacing[4],
    paddingVertical: t.spacing[6],
    paddingHorizontal: t.spacing[5],
  },
  label: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  dial: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: {
    ...typeStyle('display-lg', 700),
    color: t.colors.text.primary,
  },
  honest: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  stateCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[6],
    paddingHorizontal: t.spacing[5],
  },
  stateTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  stateBody: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
}));
