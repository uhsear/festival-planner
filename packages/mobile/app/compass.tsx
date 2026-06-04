// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * compass.tsx — M5 proximity-compass route (mobile-only, NEW route).
 *
 * Resolves a target meeting point and hands it to <MeetingPointCompass />.
 * Target source, in order:
 *   1. Explicit route params (?label=&latitude=&longitude=) — e.g. deep link
 *      or a "navigate here" tap on a specific point.
 *   2. ?mpId= — look up that meeting point in the persisted crewStore.
 *   3. Fall back to the active crew's soonest active meeting point that has
 *      captured coords.
 *
 * Zero network: everything is read from params or the already-hydrated
 * crewStore. The compass itself is on-device + offline-honest.
 */
import { useMemo } from 'react';
import { View, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCrewStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { makeStyles } from '../hooks/useTokens';
import EmptyState from '../components/EmptyState';
import MeetingPointCompass, { type MeetingPointTarget } from '../components/MeetingPointCompass';

/** Parse a route param that may be string | string[] | undefined into a finite number. */
function paramNumber(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function paramString(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s != null && s.length > 0 ? s : undefined;
}

/** A meeting point usable by the compass — active and carrying finite coords. */
function hasCoords(mp: CrewMeetingPoint): mp is CrewMeetingPoint & { latitude: number; longitude: number } {
  return (
    typeof mp.latitude === 'number' &&
    typeof mp.longitude === 'number' &&
    Number.isFinite(mp.latitude) &&
    Number.isFinite(mp.longitude)
  );
}

/** The soonest still-active meeting point that has captured coords. */
function pickActiveWithCoords(points: CrewMeetingPoint[]): CrewMeetingPoint | null {
  const usable = points.filter((p) => p.active && hasCoords(p));
  if (usable.length === 0) return null;
  const timed = usable
    .filter((p) => p.meet_at)
    .map((p) => ({ p, ms: new Date(p.meet_at as string).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms))
    .sort((a, b) => a.ms - b.ms);
  if (timed.length > 0) return timed[0]!.p;
  return usable[0]!;
}

export default function CompassScreen() {
  const styles = useStyles();
  const params = useLocalSearchParams<{
    label?: string;
    latitude?: string;
    longitude?: string;
    mpId?: string;
  }>();
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const activeCrew = useCrewStore((s) => s.activeCrew);

  const target: MeetingPointTarget | null = useMemo(() => {
    // 1. Explicit coords in params.
    const lat = paramNumber(params.latitude);
    const lng = paramNumber(params.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { label: paramString(params.label) ?? 'Meeting point', latitude: lat, longitude: lng };
    }
    // 2. mpId → look up in the persisted store.
    const mpId = paramString(params.mpId);
    if (mpId) {
      const mp = meetingPoints.find((p) => p.id === mpId);
      if (mp && hasCoords(mp)) {
        return { label: mp.label, latitude: mp.latitude, longitude: mp.longitude };
      }
    }
    // 3. Fall back to the active crew's soonest coord-bearing meeting point.
    const fallback = pickActiveWithCoords(meetingPoints);
    if (fallback && hasCoords(fallback)) {
      return { label: fallback.label, latitude: fallback.latitude, longitude: fallback.longitude };
    }
    return null;
  }, [params.label, params.latitude, params.longitude, params.mpId, meetingPoints]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Compass', headerShown: true }} />
      {target ? (
        <ScrollView contentContainerStyle={styles.content}>
          <MeetingPointCompass target={target} />
        </ScrollView>
      ) : (
        <EmptyState
          icon="navigate-outline"
          title="No meeting point to point at"
          message={
            activeCrew
              ? 'Save a meeting point with a captured location (the map pin), then open the compass to walk toward it.'
              : 'Pick a crew and save a meeting point with a captured location to use the compass.'
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: t.spacing[4],
  },
}));
