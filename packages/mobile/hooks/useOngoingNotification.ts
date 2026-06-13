import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { useFestivalDataStore, useCrewStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import {
  artistDisplayName,
  buildOngoingNotificationModel,
  getSetTimeBounds,
  type OngoingSetInput,
} from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import { startOrUpdateLiveActivity, endLiveActivity } from '../lib/liveActivity';
import { NowNextWidgetInstance } from '../widgets/NowNextActivity';

/**
 * M6 — Android ongoing (sticky) notification.
 *
 * Presents a single, non-dismissable Android notification showing the user's
 * CURRENT (or NEXT) picked set + countdown and the active crew meeting point,
 * refreshed on a local 60s timer while the festival window is active. It is
 * driven ENTIRELY by the on-device timed-set model (shared getSetTimeBounds) and
 * the last-cached crew meeting points — NEVER from push. The meeting-point line
 * is framed "last-synced" so it never implies live/real-time data.
 *
 * Cross-platform: the Android sticky-notification effects are guarded by
 * Platform.OS === 'android'. On iOS the SAME model is presented as a Live
 * Activity via the optional native bridge (lib/liveActivity.ts) — a no-op until
 * the ActivityKit Widget Extension is built into the app (config-plugin + Swift,
 * see docs/plans/ios-live-activity-runbook.md), so the JS wiring ships safely
 * over-the-air and activates the moment the native widget lands in a build.
 *
 * Offline-honest + on-device: no network, no push. Cancels itself when the
 * festival window ends (or when the screen unmounts / festival is cleared).
 */

// Stable identifier so each refresh UPDATES the same notification rather than
// stacking new ones. Reusing the identifier in scheduleNotificationAsync
// replaces the existing notification in place.
const ONGOING_ID = 'festie-ongoing-festival';

// Dedicated Android channel. LOW importance keeps it persistent-but-quiet (no
// sound/heads-up each refresh) — appropriate for an always-present status card.
const CHANNEL_ID = 'ongoing';

const REFRESH_MS = 60_000;

async function ensureOngoingChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Festival status',
    importance: Notifications.AndroidImportance.LOW,
    // No sound/vibration: this is a sticky status card, not an alert.
    sound: null,
    vibrationPattern: null,
    showBadge: false,
  });
}

async function presentOngoing(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: ONGOING_ID,
    content: {
      title,
      body,
      sticky: true, // Android isOngoing — cannot be swiped away.
      priority: Notifications.AndroidNotificationPriority.LOW,
      sound: false,
      // Belt-and-suspenders: keep it out of the alerting path on every refresh.
      vibrate: [],
    },
    // null trigger = present immediately; channelId routes it to our LOW channel.
    trigger: { channelId: CHANNEL_ID } as Notifications.ChannelAwareTriggerInput,
  });
}

async function cancelOngoing(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Remove whether it is currently shown or (defensively) still scheduled.
  await Notifications.dismissNotificationAsync(ONGOING_ID).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(ONGOING_ID).catch(() => {});
}

/**
 * Mounts the ongoing-notification lifecycle. Call once from the festival/live
 * screen. Returns nothing — its effect is the Android notification.
 *
 * `enabled` lets the host gate the behavior (e.g. a settings toggle); defaults
 * to true. On non-Android platforms the hook short-circuits to a no-op.
 */
export function useOngoingNotification(enabled: boolean = true): void {
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const meetingPointsSyncedAt = useCrewStore((s) => s._cachedAt);
  const { getStageName } = useFestival();

  const picks = currentProfile?.picks;
  const b2bSeparator = currentFestival?.b2bSeparator;

  // Local 60s tick so the countdown / now-vs-next decision refreshes on-device
  // without any network. Runs on BOTH Android (ongoing notification) and iOS
  // (Live Activity) while enabled. Without this tick on iOS, the model never
  // recomputes and the Live Activity freezes on the initial state.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // Resolve picked sets to the shared model's input shape (name + stage). Done
  // in mobile because artist/stage naming is app-context (b2bSeparator, stage
  // lookup); the shared model stays naming-agnostic.
  const ongoingSets = useMemo<OngoingSetInput[]>(() => {
    if (!picks || !sets.length) return [];
    const out: OngoingSetInput[] = [];
    for (const s of sets) {
      if (!picks[s.id]) continue;
      out.push({
        set: s,
        name: artistDisplayName(s, b2bSeparator),
        stageName: getStageName(s.stageId) ?? null,
      });
    }
    return out;
  }, [picks, sets, b2bSeparator, getStageName]);

  const model = useMemo(
    () =>
      buildOngoingNotificationModel({
        sets: ongoingSets,
        days,
        meetingPoints,
        meetingPointSyncedAt: meetingPointsSyncedAt ?? null,
        now,
      }),
    [ongoingSets, days, meetingPoints, meetingPointsSyncedAt, now],
  );

  // Track what we last presented so we only re-issue the notification when the
  // rendered text actually changes (avoids churn every tick).
  const lastShownRef = useRef<string | null>(null);

  useEffect(() => {
    // Android-only: drive the ongoing (sticky) notification. iOS uses the Live
    // Activity effect below instead.
    if (Platform.OS !== 'android') return;
    let cancelled = false;

    (async () => {
      try {
        if (!enabled || !currentFestival || !model.active || !model.title || !model.body) {
          if (lastShownRef.current !== null) {
            await cancelOngoing();
            lastShownRef.current = null;
          }
          return;
        }
        await ensureOngoingChannel();
        const signature = `${model.title}${model.body}`;
        if (cancelled || signature === lastShownRef.current) return;
        await presentOngoing(model.title, model.body);
        lastShownRef.current = signature;
      } catch (e) {
        // A failure here means the status card is missing/stale — worth knowing,
        // but must never crash the screen.
        Sentry.captureException(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, currentFestival, model]);

  // iOS: drive the Live Activity from the SAME model via the optional native
  // bridge (lib/liveActivity.ts). No-op until the ActivityKit Widget Extension
  // is built into the app; the JS wiring ships safely over-the-air and activates
  // the moment the native widget lands in a build. Plumbs endsAt so the native
  // widget can render a live countdown timer (ActivityKit's Text.DateStyle).
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (enabled && currentFestival && model.active && model.title && model.body) {
      // Derive endsAt from the focus set's time bounds so the native widget can
      // render a live countdown. When the focus set is unavailable, omit it
      // (the widget falls back to the text body).
      let endsAt: string | null = null;
      if (model.focusSet) {
        const focusSetData = sets.find((s) => s.id === model.focusSet!.id);
        if (focusSetData && days) {
          const bounds = getSetTimeBounds(focusSetData, days);
          if (bounds) endsAt = new Date(bounds.endMs).toISOString();
        }
      }
      startOrUpdateLiveActivity({ title: model.title, body: model.body, endsAt });
      // Home-screen widget: push the same model snapshot so the WidgetKit
      // timeline reflects the current set without waiting for a background
      // refresh. updateSnapshot is a no-op when the native widget extension
      // is not present in the running binary (same safe pattern as the Live
      // Activity bridge).
      try {
        NowNextWidgetInstance.updateSnapshot({ title: model.title, subtitle: model.body });
      } catch {
        // Never let a widget-timeline failure surface to the user.
      }
    } else {
      endLiveActivity();
    }
  }, [enabled, currentFestival, model, sets, days]);

  // Final cleanup: when the hook unmounts (leave the screen / sign out), tear
  // down the sticky notification / Live Activity so it can't linger with stale data.
  useEffect(() => {
    return () => {
      void cancelOngoing();
      if (Platform.OS === 'ios') endLiveActivity();
    };
  }, []);
}
