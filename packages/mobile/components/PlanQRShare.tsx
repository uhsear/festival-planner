// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import {
  encodePlanSnapshot,
  toPickPriority,
  MAX_PICKS,
  MAX_ENCODED_LENGTH,
  PICK_PRIORITIES,
  type PlanSnapshotInput,
} from '@festie/shared/utils';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import EmptyState from './EmptyState';

// ── Snapshot assembly (offline-native, zero network) ───────────────────────
// Builds the compact P2P snapshot ENTIRELY from the persisted stores already in
// memory — currentFestival + currentProfile.picks (festivalDataStore) and the
// active meeting point (crewStore). No fetches: this works on a dead-signal
// device. Picks are priority-ranked (must > want > maybe) and capped to MAX_PICKS
// so an over-long plan still produces a single scannable code; the codec also
// truncates defensively.

const PRIORITY_RANK: Record<string, number> = { must: 3, 'want-to-see': 2, maybe: 1 };

/** Soonest active, future meeting point with a coord; falls back to any active+coord one. */
function pickShareMeetingPoint(points: CrewMeetingPoint[], nowMs: number): CrewMeetingPoint | null {
  const withCoord = points.filter((p) => p.active && typeof p.latitude === 'number' && typeof p.longitude === 'number');
  const future = withCoord
    .filter((p) => p.meet_at)
    .map((p) => ({ p, ms: new Date(p.meet_at as string).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (future.length > 0) return future[0]!.p;
  return withCoord[0] ?? null;
}

/**
 * Renders a QR code of the encoded plan snapshot. A nearby crew member scans it
 * (PlanQRScan) to import the plan onto their own device with NO internet on
 * either phone.
 */
export default function PlanQRShare() {
  const t = useTokens();
  const styles = useStyles();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);

  const { encoded, picksCount, meetingPoint, tooLong } = useMemo(() => {
    if (!currentFestival || !currentProfile) {
      return {
        encoded: null as string | null,
        picksCount: 0,
        meetingPoint: null as CrewMeetingPoint | null,
        tooLong: false,
      };
    }

    // Rank picks must > want > maybe, then cap to MAX_PICKS so the most
    // important picks survive the bound (the codec truncates the tail).
    const picks = Object.entries(currentProfile.picks || {})
      .map(([setId, priority]) => ({ setId, priority: priority as string }))
      .sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))
      .slice(0, MAX_PICKS)
      .map((p) => ({ setId: p.setId, priority: toPickPriority(p.priority) }));

    const mp = pickShareMeetingPoint(meetingPoints, Date.now());

    const input: PlanSnapshotInput = {
      festivalId: currentFestival.id,
      festivalName: currentFestival.name,
      picks,
      ...(mp && typeof mp.latitude === 'number' && typeof mp.longitude === 'number'
        ? { meetingPoint: { label: mp.label, lat: mp.latitude, lng: mp.longitude } }
        : {}),
    };

    const enc = encodePlanSnapshot(input);
    return {
      encoded: enc,
      picksCount: picks.length,
      meetingPoint: mp,
      tooLong: enc.length > MAX_ENCODED_LENGTH,
    };
  }, [currentFestival, currentProfile, meetingPoints]);

  if (!currentFestival || !currentProfile) {
    return (
      <EmptyState
        icon="qr-code-outline"
        title="No plan to share yet"
        message="Open a festival and add a few picks, then come back to share them."
      />
    );
  }

  // Defensive: the codec is size-bounded, but if a plan somehow exceeds the
  // scannable limit, say so honestly rather than render an unscannable code.
  if (!encoded || tooLong) {
    return (
      <EmptyState
        icon="warning-outline"
        title="Plan too big for one code"
        message="Trim a few picks and try again — a QR code can only hold so much."
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{currentFestival.name}</Text>
      <Text style={styles.sub}>
        {picksCount} pick{picksCount === 1 ? '' : 's'}
        {meetingPoint ? ` · meet at ${meetingPoint.label}` : ''}
      </Text>

      <View style={styles.qrCard}>
        <QRCode
          value={encoded}
          size={240}
          // High-contrast on a light tile so cameras lock fast in low festival light.
          color="#0A0E1A"
          backgroundColor="#FFFFFF"
          // L error correction keeps the code small/dense-free for our bounded payload.
          ecl="M"
        />
      </View>

      <Text style={styles.instructions}>
        Have your friend open Festie → Plan share → Scan QR and point their camera here. Works with both phones offline
        — nothing is sent over the internet.
      </Text>

      <View style={styles.legend}>
        {PICK_PRIORITIES.map((p) => (
          <Text key={p} style={styles.legendItem}>
            {p}
          </Text>
        ))}
      </View>
      <Text style={[styles.instructions, { color: t.colors.text.muted }]}>
        This shares your current picks{meetingPoint ? ' and the active meeting point' : ''} as a snapshot — not a live
        link. Your friend gets a copy as it stands now.
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
    alignItems: 'center',
  },
  heading: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  sub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    padding: t.spacing[4],
    borderRadius: t.radii.default,
  },
  instructions: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  legendItem: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
}));
