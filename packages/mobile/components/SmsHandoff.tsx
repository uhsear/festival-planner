// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import * as SMS from 'expo-sms';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import type { CrewMeetingPoint } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import EmptyState from './EmptyState';

// ── SMS handoff (last-resort P2P) ──────────────────────────────────────────
// When QR/in-app sharing isn't possible (no shared app, friend across the
// venue), fall back to a plain text. We prefill the composer with the meeting
// point label + a universal Google Maps link (works in any messaging app, no
// Festie required) + an optional festie:// deep link for crew who DO have the
// app. We open the native composer only — we never send, and the OS does not
// tell us if the message was delivered. The copy says so honestly.

/** Soonest active meeting point with a coord; falls back to any active+coord one. */
function pickMeetingPoint(points: CrewMeetingPoint[], nowMs: number): CrewMeetingPoint | null {
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
 * Build the SMS body: meeting point label, a Google Maps link to the coord, an
 * optional meet time, and an optional festie:// deep link. Plain text so it
 * renders in any SMS client with no escaping concerns.
 */
function buildMessage(mp: CrewMeetingPoint, festivalId: string | null): string {
  const lines: string[] = [];
  lines.push(`Meet at: ${mp.label}`);
  if (typeof mp.latitude === 'number' && typeof mp.longitude === 'number') {
    lines.push(`https://maps.google.com/?q=${mp.latitude},${mp.longitude}`);
  }
  if (mp.meet_at) {
    const when = new Date(mp.meet_at);
    if (!Number.isNaN(when.getTime())) {
      lines.push(`When: ${when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
    }
  }
  if (festivalId) {
    // Opens the festival in Festie for crew who have the app installed.
    lines.push(`Open in Festie: festie://festival/${festivalId}`);
  }
  lines.push('(Sent via Festie)');
  return lines.join('\n');
}

/**
 * Renders the SMS-handoff CTA. Guards on SMS.isAvailableAsync so we never offer
 * a dead button on a device without SMS (tablet / simulator).
 */
export default function SmsHandoff() {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset();

  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);

  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    SMS.isAvailableAsync()
      .then((ok) => {
        if (active) setAvailable(ok);
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const meetingPoint = useMemo(() => pickMeetingPoint(meetingPoints, Date.now()), [meetingPoints]);
  const message = useMemo(
    () => (meetingPoint ? buildMessage(meetingPoint, currentFestivalId) : ''),
    [meetingPoint, currentFestivalId],
  );

  const openComposer = async () => {
    if (!meetingPoint) return;
    setStatus(null);
    try {
      // No recipients — let the user pick from their contacts in the composer.
      const { result } = await SMS.sendSMSAsync([], message);
      if (result === 'sent') {
        setStatus("Composer handed off. We can't confirm if it was delivered.");
      } else if (result === 'cancelled') {
        setStatus('Cancelled — nothing was sent.');
      } else {
        setStatus('Composer closed.');
      }
    } catch {
      setStatus("Couldn't open your messaging app.");
    }
  };

  if (available === false) {
    return (
      <EmptyState
        icon="chatbubble-ellipses-outline"
        title="Texting isn't available"
        message="This device can't send SMS. Try the QR share instead — it works fully offline."
      />
    );
  }

  if (!meetingPoint) {
    return (
      <EmptyState
        icon="location-outline"
        title="No meeting point to text"
        message="Set an active meeting point for your crew first, then you can text it to anyone."
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="navigate" size={18} color={t.colors.accent.coral} />
          <Text style={styles.cardTitle}>Text the crew our meetup</Text>
        </View>
        <Text style={styles.previewLabel}>This message will be prefilled:</Text>
        <View style={styles.preview}>
          <Text style={styles.previewText}>{message}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, available == null && styles.buttonDisabled]}
        onPress={openComposer}
        disabled={available == null}
        accessibilityRole="button"
        accessibilityLabel="Open the SMS composer prefilled with the meeting point"
      >
        <Ionicons name="send" size={18} color={t.colors.text.onLightAccent} />
        <Text style={styles.buttonText}>Open messages</Text>
      </TouchableOpacity>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.disclaimer}>
        Last resort: this opens your phone's messaging app with the meetup prefilled. You still pick who to send it to
        and hit send — and Festie can't confirm it was delivered. The maps link works in any app, no Festie needed.
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  cardTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  previewLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  preview: {
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.primary,
    padding: t.spacing[3],
  },
  previewText: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
  status: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
    textAlign: 'center',
  },
  disclaimer: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
}));
