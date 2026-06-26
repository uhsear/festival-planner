// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * CrewSos — safety-critical SOS surface for the active crew.
 *
 * Two responsibilities:
 *  1. RAISE — a large, reachable SOS button (guarded by a confirm dialog to
 *     prevent accidental triggers). On confirm it attaches a one-shot location
 *     fix (best-effort; never blocks the SOS) and POSTs /crews/:crewId/sos. SOS
 *     is online-only by design (excluded from the offline write-queue): a queued
 *     rescue replayed hours later is dangerous, so an offline raise surfaces an
 *     explicit "No signal — SOS not sent" message instead of silently queuing.
 *  2. RECEIVE — when an `sos:raised` broadcast lands in the liveLocationStore,
 *     a prominent banner names the raiser (with a warning haptic), lets any crew
 *     member open the MeetingPointCompass pointed at the SOS coordinate to walk
 *     toward them, and lets the raiser (or anyone) clear it ("I'm safe").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { api, isApiClientError, mapErrorToUserMessage } from '@festie/shared/services';
import { useLiveLocationStore } from '@festie/shared/stores';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import MeetingPointCompass, { type MeetingPointTarget } from './MeetingPointCompass';

interface CrewSosProps {
  crewId: string;
  currentUserId: string;
}

export default function CrewSos({ crewId, currentUserId }: CrewSosProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  // Only surface the SOS for the crew this card belongs to (the store is scoped
  // to the active crew, but guard anyway so a stale entry never leaks across).
  const sos = useLiveLocationStore((s) => (s.sos && s.sos.crewId === crewId ? s.sos : null));

  const [raising, setRaising] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Warning haptic on each NEW incoming SOS (keyed on raisedAt so re-renders
  // don't re-buzz). The raiser already felt the confirm haptic, so only buzz for
  // SOS raised by someone else.
  const lastBuzzedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sos) {
      lastBuzzedRef.current = null;
      return;
    }
    if (sos.raisedAt !== lastBuzzedRef.current) {
      lastBuzzedRef.current = sos.raisedAt;
      if (sos.userId !== currentUserId) haptics.warning();
    }
  }, [sos, currentUserId, haptics]);

  const doRaise = useCallback(async () => {
    if (raising) return;
    setRaising(true);
    haptics.warning();
    // Best-effort one-shot fix so the crew can actually find the person. Never
    // let a slow/denied GPS read block the SOS itself.
    let position: { lat: number; lng: number; accuracy?: number; capturedAt: string } | undefined;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          capturedAt: new Date(pos.timestamp).toISOString(),
        };
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

  const doClear = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await api.post(`/crews/${crewId}/sos/clear`, {});
      // The sos:cleared broadcast dismisses the banner for the whole crew.
      haptics.success();
    } catch (err) {
      Alert.alert('Could not clear SOS', mapErrorToUserMessage(err, 'Try again.'));
    } finally {
      setClearing(false);
    }
  }, [crewId, clearing, haptics]);

  // Clearing kills a LIVE emergency for the whole crew and any member can do it,
  // so gate it behind a confirm (parity with the raise, which is already
  // confirm-gated) — one stray tap must not silently resolve a real SOS.
  const confirmClear = useCallback(() => {
    const mine = sos?.userId === currentUserId;
    Alert.alert(
      mine ? 'Clear your SOS?' : 'Mark this SOS resolved?',
      mine
        ? "This tells your whole crew you're safe and removes the alert for everyone. Only do this once you're actually OK."
        : 'This clears the active emergency alert for everyone in the crew. Only do this if you know they are safe.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: mine ? "I'm safe" : 'Mark resolved', style: 'destructive', onPress: () => void doClear() },
      ],
    );
  }, [doClear, sos?.userId, currentUserId]);

  const sosTarget: MeetingPointTarget | null =
    sos?.position && Number.isFinite(sos.position.lat) && Number.isFinite(sos.position.lng)
      ? { label: `${sos.username} (SOS)`, latitude: sos.position.lat, longitude: sos.position.lng }
      : null;

  const isMine = sos?.userId === currentUserId;

  return (
    <View style={styles.wrap}>
      {/* Active SOS banner (whole-crew) */}
      {sos ? (
        <View style={styles.banner} accessible accessibilityRole="alert">
          <View style={styles.bannerHead}>
            <Ionicons name="warning" size={22} color={t.colors.accent.coral} />
            <Text style={styles.bannerTitle}>{isMine ? 'You raised an SOS' : `${sos.username} raised an SOS`}</Text>
          </View>
          <Text style={styles.bannerBody}>
            {sos.message
              ? sos.message
              : sosTarget
                ? 'Tap “Get directions” to walk toward their last location.'
                : 'No location was attached — reach them by phone or radio.'}
          </Text>
          <View style={styles.bannerActions}>
            {sosTarget ? (
              <TouchableOpacity
                style={[styles.bannerButton, styles.bannerButtonPrimary]}
                onPress={() => setNavOpen(true)}
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
              onPress={confirmClear}
              disabled={clearing}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={isMine ? "I'm safe, clear my SOS" : 'Mark this SOS resolved'}
            >
              {clearing ? (
                <ActivityIndicator size="small" color={t.colors.accent.aqua} />
              ) : (
                <Text style={styles.bannerButtonOutlineText}>{isMine ? "I'm safe" : 'Mark resolved'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Raise SOS button — hidden while my own SOS is already active. */}
      {!isMine ? (
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
        visible={navOpen && !!sosTarget}
        animationType="slide"
        onRequestClose={() => setNavOpen(false)}
        presentationStyle="pageSheet"
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              Walk toward {sos?.username}
            </Text>
            <TouchableOpacity
              onPress={() => setNavOpen(false)}
              style={styles.modalClose}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close directions"
            >
              <Ionicons name="close" size={24} color={t.colors.text.primary} />
            </TouchableOpacity>
          </View>
          {sosTarget ? <MeetingPointCompass target={sosTarget} /> : null}
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
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
