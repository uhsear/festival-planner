import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuthStore, useCrewStore, useLiveLocationStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { makeStyles } from '../hooks/useTokens';
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
  const styles = useStyles();

  const user = useAuthStore((s) => s.user);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const meetingPoints = useCrewStore((s) => s.meetingPoints) as CrewMeetingPoint[];

  // Ephemeral live location + SOS (never persisted). The record is a stable ref
  // unless it changes, so derive the array via memo to avoid render churn.
  const peersRecord = useLiveLocationStore((s) => s.peers);
  const sos = useLiveLocationStore((s) => s.sos);
  const sweepStale = useLiveLocationStore((s) => s.sweepStale);
  const setActiveCrew = useLiveLocationStore((s) => s.setActiveCrew);
  const peers = useMemo(() => Object.values(peersRecord), [peersRecord]);

  // Scope the live store to this crew on mount/crew change.
  useEffect(() => {
    setActiveCrew(activeCrew?.id ?? null);
  }, [activeCrew?.id, setActiveCrew]);

  // Self-heal: drop peers older than the TTL even if a peer-stopped never arrives.
  useEffect(() => {
    const id = setInterval(() => sweepStale(Date.now()), SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sweepStale]);

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
      <OfflineMap meetingPoints={meetingPoints} peers={peers} sos={sos} />
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
}));
