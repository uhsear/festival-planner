// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

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
import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useCrewStore, useLiveLocationStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useReduceMotion } from '../hooks/useReduceMotion';
import EmptyState from '../components/EmptyState';
import SectionLabel from '../components/SectionLabel';

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
  const bottomPad = useListBottomInset({ base: t.spacing[4] });

  const activeCrew = useCrewStore((s) => s.activeCrew);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);

  // R24: show pulsing coral ring on SOS FAB while an active SOS exists for
  // this crew. Continuous animation is justified (emergency). Ring stops when
  // SOS clears. Reduce-motion: static high-contrast coral ring, no animation.
  const sos = useLiveLocationStore((s) => (s.sos && activeCrew && s.sos.crewId === activeCrew.id ? s.sos : null));
  const reduceMotion = useReduceMotion();
  const sosFabGlow = useSharedValue(0);
  const sosActive = !!sos;
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
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

        <SectionLabel style={{ marginTop: t.spacing[2] }}>Meeting points</SectionLabel>

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
                // Mirror the disabled prop into a11y so VoiceOver doesn't announce
                // a non-coord row as an actionable button.
                accessibilityState={{ disabled: !navigable }}
                accessibilityLabel={navigable ? `Point the compass to ${p.label}` : `${p.label} — no pinned location`}
              >
                <Ionicons
                  name={navigable ? 'location' : 'location-outline'}
                  size={18}
                  // Aqua = navigable/active (accent rule); coral on find/map is
                  // reserved for the SOS layer, not routine meeting points (F16).
                  color={navigable ? t.colors.accent.aqua : t.colors.text.muted}
                />
                <View style={styles.mpBody}>
                  <Text style={styles.mpLabel}>{p.label}</Text>
                  {p.location ? <Text style={styles.mpSub}>{p.location}</Text> : null}
                  {!navigable ? <Text style={styles.mpMuted}>No pinned location</Text> : null}
                </View>
                {navigable ? <Ionicons name="navigate-outline" size={16} color={t.colors.accent.aqua} /> : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* DC2 + R24: raise-SOS shortcut. The FAB lives in an outer absolutely-
          positioned wrapper so its placement never depends on the parent's flex
          flow — an absolute child of a relative-flow parent collapses to 0x0 on
          Android New Arch. Pulsing coral RING (a real View, not shadow*) while
          an active SOS exists for this crew; reduce-motion shows a static ring. */}
      <View style={styles.sosFabWrap} pointerEvents="box-none">
        {sosActive ? <Animated.View pointerEvents="none" style={[styles.sosRing, sosRingStyle]} /> : null}
        <TouchableOpacity
          testID="find-sos-fab"
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
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  mpSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  mpMuted: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
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
    // Safety FAB: coralStrong (~6.04:1 vs white) passes WCAG AA; plain coral
    // (#ff3366) only reaches ~3.55:1. Coral here is on-rule — this is the danger
    // surface.
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
