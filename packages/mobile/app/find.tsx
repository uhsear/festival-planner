// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * find.tsx — "Find each other" hub (mobile-only).
 *
 * Co-locates the previously-scattered finding doors — the crew map (/map), the
 * meeting-point compass (/compass) and the saved meeting points — under ONE
 * destination so members have a single place to answer "where is everyone / where
 * do we meet?". It does NOT replace those routes: the cards push to the existing
 * /map and /compass screens, and meeting-point rows deep-link the compass at a
 * specific point. Zero network: everything reads from the persisted crewStore, so
 * it works on a cold offline launch.
 */
import { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import EmptyState from '../components/EmptyState';

/** A meeting point is navigable by the compass only if it carries finite coords. */
function hasCoords(mp: CrewMeetingPoint): mp is CrewMeetingPoint & { latitude: number; longitude: number } {
  return (
    typeof mp.latitude === 'number' &&
    typeof mp.longitude === 'number' &&
    Number.isFinite(mp.latitude) &&
    Number.isFinite(mp.longitude)
  );
}

export default function FindScreen() {
  const t = useTokens();
  const styles = useStyles();

  const activeCrew = useCrewStore((s) => s.activeCrew);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);

  const points = useMemo(() => (meetingPoints ?? []).filter((p) => p && p.active !== false), [meetingPoints]);

  if (!activeCrew) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Find each other', headerShown: true }} />
        <EmptyState
          icon="people-outline"
          title="No crew selected"
          message="Open the Crew tab and pick a crew to find each other on the map."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Find each other', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>See where your crew is and navigate to your meeting points. Works offline.</Text>

        <TouchableOpacity
          testID="find-action-map"
          style={[styles.card, styles.cardPrimary]}
          onPress={() => router.push('/map')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Open the live crew map"
        >
          <View style={styles.cardIcon}>
            <Ionicons name="map" size={22} color={t.colors.accent.aqua} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Live crew map</Text>
            <Text style={styles.cardSub}>Everyone sharing live, your meeting points, and any SOS.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.colors.accent.aqua} />
        </TouchableOpacity>

        <TouchableOpacity
          testID="find-action-compass"
          style={styles.card}
          onPress={() => router.push('/compass')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Open the meeting-point compass"
        >
          <View style={styles.cardIcon}>
            <Ionicons name="navigate" size={22} color={t.colors.accent.aqua} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Meeting-point compass</Text>
            <Text style={styles.cardSub}>On-device direction to a saved spot when signal is dead.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.colors.accent.aqua} />
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Meeting points</Text>

        {points.length === 0 ? (
          <Text style={styles.note}>
            No meeting points yet. Add one in the Crew tab and it'll show here and on the map.
          </Text>
        ) : (
          points.map((p) => {
            const navigable = hasCoords(p);
            return (
              <TouchableOpacity
                key={p.id}
                style={styles.mpRow}
                disabled={!navigable}
                onPress={() => router.push({ pathname: '/compass', params: { mpId: p.id } })}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={navigable ? `Point the compass to ${p.label}` : `${p.label} — no pinned location`}
              >
                <Ionicons
                  name={navigable ? 'location' : 'location-outline'}
                  size={18}
                  color={navigable ? t.colors.accent.coral : t.colors.text.muted}
                />
                <View style={styles.mpBody}>
                  <Text style={styles.mpLabel} numberOfLines={1}>
                    {p.label}
                  </Text>
                  {p.location ? (
                    <Text style={styles.mpSub} numberOfLines={1}>
                      {p.location}
                    </Text>
                  ) : null}
                  {!navigable ? <Text style={styles.mpMuted}>No pinned location</Text> : null}
                </View>
                {navigable ? <Ionicons name="navigate-outline" size={16} color={t.colors.accent.aqua} /> : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  intro: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[3],
    minHeight: 64,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  cardPrimary: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  cardIcon: {
    width: 28,
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  cardTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  cardSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  sectionLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingTop: t.spacing[2],
  },
  note: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  mpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  mpBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  mpLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    fontWeight: '600',
  },
  mpSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  mpMuted: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));
