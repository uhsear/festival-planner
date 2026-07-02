// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * CrewSos — safety-critical SOS surface for the active crew.
 *
 * Two responsibilities:
 *  1. RAISE — a large, reachable SOS button (guarded by a confirm dialog to
 *     prevent accidental triggers). On confirm it attaches a location fix and
 *     POSTs /crews/:crewId/sos. The fix is bounded: we seed from the cached
 *     last-known position (instant) and race a fresh reading against a 4s
 *     timeout, so the POST fires within ~4s at worst with the freshest coords
 *     available — a slow/denied GPS never delays the alert. SOS is online-only
 *     by design (excluded from the offline write-queue): a queued
 *     rescue replayed hours later is dangerous, so an offline raise surfaces an
 *     explicit "No signal — SOS not sent" message instead of silently queuing.
 *  2. RECEIVE — when `sos:raised` broadcasts land in the liveLocationStore, a
 *     prominent banner names the raiser (with a warning haptic), lets any crew
 *     member open the MeetingPointCompass pointed at the SOS coordinate to walk
 *     toward them, and lets the raiser (or anyone) clear it ("I'm safe").
 *
 * MULTIPLE SOS: the store exposes `activeSosList` (newest first); more than one
 * crew member can have an SOS up at once. We render EVERY active SOS as its own
 * banner (each with its raiser + a confirm-gated clear). With exactly one active
 * SOS the surface is visually identical to the original single-SOS banner.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { SosEntry } from '@festie/shared/types';
import { api, isApiClientError, mapErrorToUserMessage } from '@festie/shared/services';
import { useLiveLocationStore } from '@festie/shared/stores';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import MeetingPointCompass, { type MeetingPointTarget } from './MeetingPointCompass';

interface CrewSosProps {
  crewId: string;
  currentUserId: string;
}

function sosTargetFor(sos: SosEntry): MeetingPointTarget | null {
  return sos.position && Number.isFinite(sos.position.lat) && Number.isFinite(sos.position.lng)
    ? { label: `${sos.username} (SOS)`, latitude: sos.position.lat, longitude: sos.position.lng }
    : null;
}

export default function CrewSos({ crewId, currentUserId }: CrewSosProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  // Render ALL active SOS for this crew. Select the stable array from the store
  // (its reference only changes when an SOS mutates) and crew-filter via useMemo
  // so we never return a fresh array from the selector (which would thrash the
  // useSyncExternalStore snapshot). The store is already scoped to the active
  // crew, but guard anyway so a stale entry never leaks across crews.
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const sosList = useMemo(
    () => activeSosList.filter((e) => e.crewId === crewId),
    [activeSosList, crewId],
  );

  const [raising, setRaising] = useState(false);
  // Which raiser's clear is currently in flight (per-SOS, so one clear's spinner
  // doesn't disable every banner's button).
  const [clearingId, setClearingId] = useState<string | null>(null);
  // The SOS we're currently navigating toward (drives the single compass modal).
  const [navTarget, setNavTarget] = useState<{ name: string; target: MeetingPointTarget } | null>(null);

  const myActiveSos = sosList.some((s) => s.userId === currentUserId);

  // Warning haptic on each NEW incoming SOS from someone else. Keyed on
  // `userId|raisedAt` so re-renders don't re-buzz and a second crew member's SOS
  // still buzzes even while the first is up. The raiser already felt the confirm
  // haptic, so we only buzz for SOS raised by others.
  const buzzedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (sosList.length === 0) {
      buzzedRef.current.clear();
      return;
    }
    const liveKeys = new Set(sosList.map((s) => `${s.userId}|${s.raisedAt}`));
    // Forget cleared SOS so a re-raise by the same person buzzes again.
    for (const key of buzzedRef.current) {
      if (!liveKeys.has(key)) buzzedRef.current.delete(key);
    }
    let sawNew = false;
    for (const s of sosList) {
      const key = `${s.userId}|${s.raisedAt}`;
      if (buzzedRef.current.has(key)) continue;
      buzzedRef.current.add(key);
      if (s.userId !== currentUserId) sawNew = true;
    }
    if (sawNew) haptics.warning();
  }, [sosList, currentUserId, haptics]);

  const doRaise = useCallback(async () => {
    if (raising) return;
    setRaising(true);
    haptics.warning();
    // Best-effort one-shot fix so the crew can actually find the person. The
    // fix is bounded so it never delays the SOS: seed from the cached
    // last-known position (returns instantly), then race a fresh reading
    // against a 4s timeout and use whichever is freshest. The POST fires after
    // the race regardless of outcome.
    let position: { lat: number; lng: number; accuracy?: number; capturedAt: string } | undefined;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const seed = await Location.getLastKnownPositionAsync();
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        const pos = fresh ?? seed;
        if (pos) {
          position = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            capturedAt: new Date(pos.timestamp).toISOString(),
          };
        }
      }
    } catch {
      // No location — still raise the SOS (the alert + push are the priority).
    }
    try {
      await api.post(`/crews/${crewId}/sos`, position ? { position } : {});
      // The sos:raised broadcast populates the banner for the whole crew (incl. us).
    } catch (err) {
      const offline = isApiClientError(err) && (err.isNetworkError || err.status === 0);
      Alert.alert(
        'SOS not sent',
        offline
          ? 'No signal — your SOS was NOT sent. Use your phone or radio to reach your crew directly.'
          : mapErrorToUserMessage(err, 'Could not send your SOS. Try again.'),
      );
    } finally {
      setRaising(false);
    }
  }, [crewId, raising, haptics]);

  const confirmRaise = useCallback(() => {
    Alert.alert(
      'Send an SOS to your crew?',
      'Everyone in this crew gets an alert with your last location so they can find you. Use this for emergencies.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: () => void doRaise() },
      ],
    );
  }, [doRaise]);

  const doClear = useCallback(
    async (raiserId: string) => {
      if (clearingId) return;
      setClearingId(raiserId);
      try {
        // Pass the raiser so the clear targets that SOS; the broadcast then
        // dismisses just that banner for the whole crew.
        await api.post(`/crews/${crewId}/sos/clear`, { raiserId });
        haptics.success();
      } catch (err) {
        Alert.alert('Could not clear SOS', mapErrorToUserMessage(err, 'Try again.'));
      } finally {
        setClearingId(null);
      }
    },
    [crewId, clearingId, haptics],
  );

  // Clearing kills a LIVE emergency and any member can do it, so gate it behind a
  // confirm (parity with the raise) — one stray tap must not silently resolve a
  // real SOS.
  const confirmClear = useCallback(
    (sos: SosEntry) => {
      const mine = sos.userId === currentUserId;
      Alert.alert(
        mine ? 'Clear your SOS?' : `Mark ${sos.username}'s SOS resolved?`,
        mine
          ? "This tells your whole crew you're safe and removes the alert for everyone. Only do this once you're actually OK."
          : `This clears ${sos.username}'s active emergency alert for everyone in the crew. Only do this if you know they are safe.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: mine ? "I'm safe" : 'Mark resolved',
            style: 'destructive',
            onPress: () => void doClear(sos.userId),
          },
        ],
      );
    },
    [doClear, currentUserId],
  );

  const renderBanner = (sos: SosEntry) => {
    const isMine = sos.userId === currentUserId;
    const target = sosTargetFor(sos);
    const clearing = clearingId === sos.userId;
    return (
      <View key={`${sos.userId}|${sos.raisedAt}`} style={styles.banner} accessible accessibilityRole="alert">
        <View style={styles.bannerHead}>
          <Ionicons name="warning" size={t.iconSize.md} color={t.colors.accent.coral} />
          <Text style={styles.bannerTitle}>{isMine ? 'You raised an SOS' : `${sos.username} raised an SOS`}</Text>
        </View>
        <Text style={styles.bannerBody}>
          {sos.message
            ? sos.message
            : target
              ? 'Tap “Get directions” to walk toward their last location.'
              : 'No location was attached — reach them by phone or radio.'}
        </Text>
        <View style={styles.bannerActions}>
          {target ? (
            <TouchableOpacity
              style={[styles.bannerButton, styles.bannerButtonPrimary]}
              onPress={() => setNavTarget({ name: sos.username, target })}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${sos.username}`}
            >
              <Ionicons name="navigate" size={16} color={t.colors.text.onAccent} />
              <Text style={styles.bannerButtonPrimaryText}>Get directions</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.bannerButton, styles.bannerButtonOutline]}
            onPress={() => confirmClear(sos)}
            disabled={clearing}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={isMine ? "I'm safe, clear my SOS" : `Mark ${sos.username}'s SOS resolved`}
          >
            {clearing ? (
              <ActivityIndicator size="small" color={t.colors.accent.aqua} />
            ) : (
              <Text style={styles.bannerButtonOutlineText}>{isMine ? "I'm safe" : 'Mark resolved'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      {/* When two or more SOS are live, label the stack so the count is obvious.
          A single SOS stays visually identical to the original banner. */}
      {sosList.length > 1 ? (
        <Text style={styles.stackCount} accessibilityRole="header">
          {sosList.length} active SOS
        </Text>
      ) : null}

      {/* Active SOS banner(s) — whole-crew, newest first. */}
      {sosList.map(renderBanner)}

      {/* Raise SOS button — hidden while my own SOS is already active. */}
      {!myActiveSos ? (
        <TouchableOpacity
          style={styles.sosButton}
          onPress={confirmRaise}
          disabled={raising}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Send an SOS to your crew"
          accessibilityHint="Asks for confirmation before sending"
        >
          {raising ? (
            <ActivityIndicator color={t.colors.text.onAccent} />
          ) : (
            <>
              <Ionicons name="alert-circle" size={20} color={t.colors.text.onAccent} />
              <Text style={styles.sosButtonText}>Send SOS</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      <Text style={styles.note}>For emergencies — alerts your whole crew. Needs signal to send.</Text>

      {/* Navigate-to-SOS compass modal (reuses the on-device meeting-point compass). */}
      <Modal
        visible={!!navTarget}
        animationType="slide"
        onRequestClose={() => setNavTarget(null)}
        presentationStyle="pageSheet"
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              Walk toward {navTarget?.name}
            </Text>
            <TouchableOpacity
              onPress={() => setNavTarget(null)}
              style={styles.modalClose}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close directions"
            >
              <Ionicons name="close" size={24} color={t.colors.text.primary} />
            </TouchableOpacity>
          </View>
          {navTarget ? <MeetingPointCompass target={navTarget.target} /> : null}
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
  },
  stackCount: {
    ...typeStyle('label', 700),
    color: t.colors.accent.coral,
  },
  banner: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  bannerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  bannerTitle: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
    flex: 1,
  },
  bannerBody: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  bannerActions: {
    flexDirection: 'row',
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  bannerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
  },
  bannerButtonPrimary: {
    // Deepened coral so the white label text clears WCAG AA (4.5:1). Plain
    // accent.coral behind white only reaches ~3.55:1 and FAILS AA; coralStrong
    // reaches ~6.04:1. Keeps the urgent red of a safety action while readable.
    backgroundColor: t.colors.accent.coralStrong,
  },
  bannerButtonPrimaryText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
  },
  bannerButtonOutline: {
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  bannerButtonOutlineText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    minHeight: 52,
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    // Safety-critical: deepened coral (coralStrong, ~6.04:1 vs the white label)
    // passes WCAG AA. Plain coral (#ff3366) only reaches ~3.55:1 and fails AA.
    backgroundColor: t.colors.accent.coralStrong,
  },
  sosButtonText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
  note: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  modal: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  modalTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    flex: 1,
  },
  modalClose: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
