import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuthStore, useCrewStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { makeStyles } from '../hooks/useTokens';
import OfflineMap from '../components/OfflineMap';
import FreshnessChip from '../components/FreshnessChip';
import EmptyState from '../components/EmptyState';

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
      <Stack.Screen options={{ title: `${activeCrew.name} · Map`, headerShown: true }} />
      <View style={styles.chipBar}>
        <FreshnessChip surface="crew" />
      </View>
      <OfflineMap meetingPoints={meetingPoints} />
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
