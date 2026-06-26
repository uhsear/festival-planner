import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useAuthStore, useCrewStore, useLiveLocationStore, useFestivalDataStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import OfflineMap from '../components/OfflineMap';
import FreshnessChip from '../components/FreshnessChip';
import EmptyState from '../components/EmptyState';
import HeaderTitle from '../components/HeaderTitle';

/** Sweep stale peers off the map on this cadence while the screen is mounted. */
const SWEEP_INTERVAL_MS = 15_000;

/**
 * /map — M6 offline map for the active crew/festival.
 *
 * Renders meeting-point pins (F4 coords) over a WebView-hosted MapLibre map, with
 * a graceful offline fallback list when the map can't load (see OfflineMap). All
 * data comes from the persisted crewStore — no fetch — so it works on a cold
 * offline launch. Honest copy throughout: the map is an online enhancement; the
 * pinned-points list is the offline path until the festival is downloaded (F5).
 */
export default function MapScreen() {
  const t = useTokens();
  const styles = useStyles();

  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const meetingPoints = useCrewStore((s) => s.meetingPoints) as CrewMeetingPoint[];

  // Festival map data: currentFestival carries `mapConfig` (amenities + camera);
  // stages live as a separate top-level array in the store. Fold them together so
  // OfflineMap can plot stage + amenity pins. Null when no festival is selected —
  // OfflineMap keeps its meeting-points-only behaviour + "not mapped yet" note.
  // Read from festivalDataStore — the SAME store selectFestival writes (and the
  // schedule reads). map.tsx previously read useFestivalStore.currentFestival,
  // a different store that selection never updates, so the map showed a stale/
  // wrong festival (e.g. it kept FK 2K26 after switching to another festival).
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const festivalStages = useFestivalDataStore((s) => s.stages);
  const mapFestival = useMemo(
    () => (currentFestival ? { ...currentFestival, stages: festivalStages } : null),
    [currentFestival, festivalStages],
  );

  // Ephemeral live location + SOS (never persisted). The record is a stable ref
  // unless it changes, so derive the array via memo to avoid render churn.
  const peersRecord = useLiveLocationStore((s) => s.peers);
  const sos = useLiveLocationStore((s) => s.sos);
  const sweepStale = useLiveLocationStore((s) => s.sweepStale);
  const setActiveCrew = useLiveLocationStore((s) => s.setActiveCrew);
  const peers = useMemo(() => Object.values(peersRecord), [peersRecord]);

  // R24: pulsing coral ring on SOS FAB while an active SOS exists for this crew.
  // Continuous animation justified (emergency context). Reduce-motion: static ring.
  const sosCurrent = sos && activeCrew && sos.crewId === activeCrew.id ? sos : null;
  const reduceMotion = useReduceMotion();
  const sosFabGlow = useSharedValue(0);
  const sosActive = !!sosCurrent;
  useEffect(() => {
    if (!sosActive || reduceMotion) {
      sosFabGlow.value = 0;
      return;
    }
    sosFabGlow.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) }), -1, true);
  }, [sosActive, reduceMotion, sosFabGlow]);
  // Cross-platform pulse: an actual coral ring View whose opacity/scale animate
  // (works on Android, unlike shadow* which is iOS-only). Reduce-motion: static
  // ring at a fixed mid value, no animation.
  const sosRingStyle = useAnimatedStyle(() => {
    const v = reduceMotion ? 0.5 : sosFabGlow.value;
    return {
      opacity: 0.15 + v * 0.35,
      transform: [{ scale: 1 + v * 0.18 }],
    };
  });

  // Scope the live store to this crew on mount/crew change.
  useEffect(() => {
    setActiveCrew(activeCrew?.id ?? null);
  }, [activeCrew?.id, setActiveCrew]);

  // Self-heal: drop peers older than the TTL even if a peer-stopped never arrives.
  useEffect(() => {
    const id = setInterval(() => sweepStale(Date.now()), SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sweepStale]);

  // Tap-to-create: a long-press on the map deep-links into the crew Logistics
  // tab with the pressed coords, where CrewMeetingPoints opens its create form
  // prefilled with them. No write happens here — the user still confirms "Add".
  const handleMapPress = useCallback((coord: { latitude: number; longitude: number }) => {
    router.push({
      pathname: '/(tabs)/crew',
      params: {
        tab: 'logistics',
        mpLat: String(coord.latitude),
        mpLng: String(coord.longitude),
      },
    });
  }, []);

  if (!user) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Map', headerShown: true }} />
        <EmptyState icon="lock-closed" title="Sign in required" message="Log in to see the crew map." />
      </View>
    );
  }

  if (!activeCrew) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Map', headerShown: true }} />
        <EmptyState
          icon="people-outline"
          title="No crew selected"
          message="Open the Crew tab and pick a crew to see its meeting points on the map."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Drop the " · Map" suffix and shrink-to-fit: the screen context already
          makes "Map" obvious, and a long crew name + suffix used to clip in the
          notch-narrowed native title region. */}
      <Stack.Screen options={{ headerShown: true, headerTitle: () => <HeaderTitle>{activeCrew.name}</HeaderTitle> }} />
      <View style={styles.chipBar}>
        <FreshnessChip surface="crew" />
      </View>
      <OfflineMap
        meetingPoints={meetingPoints}
        peers={peers}
        sos={sos}
        onMapPress={handleMapPress}
        festival={mapFestival}
      />

      {/* DC2 + R24: raise-SOS shortcut on the map. The FAB lives in an outer
          absolutely-positioned wrapper so its placement never depends on the
          parent's flex flow — an absolute child of a relative-flow parent
          collapses to 0x0 on Android New Arch. Pulsing coral RING (a real View,
          not shadow*) while an active SOS exists for this crew; reduce-motion
          shows a static ring. */}
      <View style={styles.sosFabWrap} pointerEvents="box-none">
        {sosActive ? <Animated.View pointerEvents="none" style={[styles.sosRing, sosRingStyle]} /> : null}
        <TouchableOpacity
          testID="map-sos-fab"
          style={styles.sosFab}
          onPress={() => router.push({ pathname: '/(tabs)/crew', params: { tab: 'logistics' } })}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Raise an SOS to your crew"
          accessibilityHint="Opens the crew safety screen to send an SOS"
        >
          <Ionicons name="alert-circle" size={20} color={t.colors.text.onAccent} />
          <Text style={styles.sosFabText}>SOS</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  chipBar: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
  },
  // Outer wrapper is the only absolutely-positioned node — pins the FAB to the
  // bottom-right regardless of parent flow so it reliably renders on Android.
  sosFabWrap: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Coral pulse ring behind the FAB. Centered absolutely on the wrapper and
  // sized to overhang the pill; animated opacity/scale carry the pulse.
  sosRing: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    left: -8,
    right: -8,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.coralStrong,
  },
  sosFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 52,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.coralStrong,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  sosFabText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
}));
