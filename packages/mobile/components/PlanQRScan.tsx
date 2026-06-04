// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalDataStore } from '@festie/shared/stores';
import { decodePlanSnapshot, fromPickPriority, type PlanSnapshot } from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import EmptyState from './EmptyState';

// ── Untrusted import (offline-native) ──────────────────────────────────────
// A scanned QR string is fully untrusted, cross-device input. We hand it
// STRAIGHT to the shared codec, which size-bounds + Zod-validates it and never
// throws — we only ever act on `{ ok: true }`. We never eval/JSON.parse it
// ourselves. On success we merge the snapshot into the LOCAL cache through the
// stores' existing setters (the same offline-queued write paths the rest of the
// app uses), so this works with no signal on either phone.

interface ImportSummary {
  festivalName: string;
  picksImported: number;
  picksSkipped: number;
  meetingPointImported: boolean;
  festivalMismatch: boolean;
}

/**
 * Merge a validated snapshot into the local cache and report what landed.
 *
 * Picks only import when the snapshot's festival matches the user's CURRENT
 * profile (a profile is festival-scoped — we must not write another festival's
 * picks into this one) AND the set id exists in the loaded schedule. Both
 * guards keep junk out of the cache. The meeting point imports into the active
 * crew when one is selected. Every write goes through an existing store setter,
 * so offline it queues + reconciles like any other change.
 */
async function importSnapshot(data: PlanSnapshot): Promise<ImportSummary> {
  const fest = useFestivalDataStore.getState();
  const crew = useCrewStore.getState();

  const summary: ImportSummary = {
    festivalName: data.festivalName,
    picksImported: 0,
    picksSkipped: 0,
    meetingPointImported: false,
    festivalMismatch: false,
  };

  // Picks: only when the snapshot is for the festival this profile belongs to.
  const profile = fest.currentProfile;
  const festivalMatches = !!profile && fest.currentFestivalId === data.festivalId;
  if (!festivalMatches) {
    summary.festivalMismatch = true;
    summary.picksSkipped = data.picks.length;
  } else {
    const knownSetIds = new Set((fest.sets as FestivalSet[]).map((s) => s.id));
    // Group importable picks by their app priority so each priority is one
    // coalesced write (bulkSavePicks issues a single queued PUT per call).
    const byPriority = new Map<Priority, string[]>();
    for (const pick of data.picks) {
      if (!knownSetIds.has(pick.setId)) {
        summary.picksSkipped += 1;
        continue;
      }
      const appPriority = fromPickPriority(pick.priority) as Priority;
      const list = byPriority.get(appPriority) ?? [];
      list.push(pick.setId);
      byPriority.set(appPriority, list);
      summary.picksImported += 1;
    }
    for (const [priority, setIds] of byPriority) {
      if (setIds.length > 0) {
        // Offline-queued, idempotent, one PUT per priority group.
        await fest.bulkSavePicks(setIds, priority);
      }
    }
  }

  // Meeting point: import into the active crew (offline-queued optimistic create).
  if (data.meetingPoint && crew.activeCrew) {
    const mp = data.meetingPoint;
    // Avoid an obvious duplicate if the same coord+label is already present.
    const dup = crew.meetingPoints.some((p) => p.label === mp.label && p.latitude === mp.lat && p.longitude === mp.lng);
    if (!dup) {
      await crew.createMeetingPoint(crew.activeCrew.id, {
        label: mp.label,
        location: mp.label,
        type: 'shared',
        latitude: mp.lat,
        longitude: mp.lng,
      });
      summary.meetingPointImported = true;
    }
  }

  return summary;
}

type Phase = 'scanning' | 'importing' | 'done' | 'error';

/**
 * Scans a plan-snapshot QR with the device camera and imports it into the local
 * cache. Treats the scanned string as untrusted (decoded by the shared codec).
 */
export default function PlanQRScan() {
  const t = useTokens();
  const styles = useStyles();

  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  // Guard against the camera firing the scan callback repeatedly for one code.
  const handledRef = useRef(false);

  const handleScanned = useCallback(async (result: BarcodeScanningResult) => {
    if (handledRef.current) return;
    handledRef.current = true;

    const decoded = decodePlanSnapshot(result?.data);
    if (!decoded.ok) {
      setErrorMsg(friendlyError(decoded.error));
      setPhase('error');
      return;
    }

    setPhase('importing');
    try {
      const s = await importSnapshot(decoded.data);
      setSummary(s);
      setPhase('done');
    } catch {
      setErrorMsg("Couldn't save the plan to this device. Try again.");
      setPhase('error');
    }
  }, []);

  const reset = useCallback(() => {
    handledRef.current = false;
    setErrorMsg(null);
    setSummary(null);
    setPhase('scanning');
  }, []);

  // Permission still loading.
  if (!permission) {
    return <View style={styles.screen} />;
  }

  // Permission not granted — ask, honestly.
  if (!permission.granted) {
    return (
      <EmptyState
        icon="camera-outline"
        title="Camera access needed"
        message="To scan a friend's plan, Festie needs your camera. Nothing is uploaded — scanning happens on-device."
        action={{ label: 'Allow camera', onPress: () => void requestPermission() }}
      />
    );
  }

  if (phase === 'error') {
    return (
      <EmptyState
        icon="alert-circle-outline"
        title="Couldn't read that code"
        message={errorMsg ?? "That doesn't look like a Festie plan. Make sure you're scanning a plan QR."}
        action={{ label: 'Try again', onPress: reset }}
      />
    );
  }

  if (phase === 'importing') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="download-outline" title="Saving plan…" message="Adding these picks to your device." />
      </View>
    );
  }

  if (phase === 'done' && summary) {
    return (
      <ScrollView contentContainerStyle={styles.doneContent}>
        <Ionicons name="checkmark-circle" size={56} color={t.colors.accent.aqua} />
        <Text style={styles.doneTitle}>Plan imported</Text>
        <Text style={styles.doneSub}>{summary.festivalName}</Text>

        <View style={styles.summaryCard}>
          <SummaryRow
            icon="star"
            label={`${summary.picksImported} pick${summary.picksImported === 1 ? '' : 's'} added`}
          />
          {summary.meetingPointImported ? (
            <SummaryRow icon="location" label="Meeting point added to your crew" />
          ) : null}
          {summary.picksSkipped > 0 ? (
            <SummaryRow
              icon="information-circle"
              muted
              label={
                summary.festivalMismatch
                  ? "Picks skipped — they're for a different festival than the one you're in"
                  : `${summary.picksSkipped} pick${summary.picksSkipped === 1 ? '' : 's'} skipped (not in this lineup)`
              }
            />
          ) : null}
        </View>

        <Text style={styles.honest}>
          Imported as a snapshot from your friend's phone. Queued changes sync when signal returns.
        </Text>

        <TouchableOpacity style={styles.scanAgain} onPress={reset} accessibilityRole="button">
          <Ionicons name="qr-code-outline" size={18} color={t.colors.text.onLightAccent} />
          <Text style={styles.scanAgainText}>Scan another</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Scanning.
  return (
    <View style={styles.screen}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handledRef.current ? undefined : (e) => void handleScanned(e)}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.reticle} />
        <Text style={styles.hint}>Point at your friend's plan QR</Text>
      </View>
    </View>
  );
}

function SummaryRow({ icon, label, muted }: { icon: keyof typeof Ionicons.glyphMap; label: string; muted?: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={16} color={muted ? t.colors.text.muted : t.colors.accent.coral} />
      <Text style={[styles.summaryText, muted && styles.summaryMuted]}>{label}</Text>
    </View>
  );
}

/** Map a codec error code to friendly, non-technical copy. */
function friendlyError(error: string): string {
  if (error === 'unsupported snapshot version') {
    return 'This plan was made with a newer version of Festie. Update the app and try again.';
  }
  if (error === 'input exceeds maximum size') {
    return 'That code is too big to be a Festie plan — it might be a different kind of QR.';
  }
  return "That doesn't look like a Festie plan QR. Try scanning again.";
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[4],
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: t.radii.default,
    backgroundColor: 'transparent',
  },
  hint: {
    ...typeStyle('label'),
    color: '#FFFFFF',
    backgroundColor: 'rgba(8,8,16,0.8)',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    overflow: 'hidden',
  },
  doneContent: {
    padding: t.spacing[4],
    gap: t.spacing[3],
    alignItems: 'center',
  },
  doneTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  doneSub: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  summaryCard: {
    width: '100%',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  summaryText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  summaryMuted: {
    color: t.colors.text.muted,
  },
  honest: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  scanAgain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[5],
    paddingVertical: t.spacing[3],
    marginTop: t.spacing[2],
  },
  scanAgainText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
