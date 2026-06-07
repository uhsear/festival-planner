import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { useFestivalDataStore, useNotificationPrefsStore } from '@festie/shared/stores';
import { artistDisplayName, buildReminderPlan, diffReminderPlan, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { ReminderPlanEntry } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';

/**
 * M1 — Pre-computed LOCAL set reminders (on-device).
 *
 * Diffs the current profile's `reminders` map (`setId -> lead minutes`) into a
 * deterministic set of on-device notifications and reconciles them with what's
 * already scheduled. Each reminder uses the stable identifier
 * `festie-reminder-<setId>` and fires at the set's TZ-safe start (via the shared
 * `getSetTimeBounds`, incl. post-midnight rollover) minus the lead minutes.
 *
 * Local-first delivery: these fire even in airplane mode — the core value at a
 * festival with no signal. FCM (see `useMobilePush`) stays as the at-home
 * backstop and is untouched here; the server-side skip when a device is
 * locally-covered is a separate follow-up.
 *
 * Behavior:
 * - Reconciles on every change to picks/reminders/sets/days (and on app
 *   foreground, since the wall-clock advances and past reminders should drop).
 * - Caps to the next ≤64 upcoming reminders (iOS local-notification limit),
 *   prioritizing must > want-to-see > maybe (logic lives in `@festie/shared`).
 * - Cancels reminders for sets that were un-reminded, by deterministic id.
 * - Gated on the user's set-reminders preference (`notificationPrefs.setReminders`,
 *   the existing pref that controls schedule alerts). When off, all local
 *   reminders are cancelled.
 * - Requests notification permission once, gracefully — a denial just no-ops.
 *
 * The `expo-notifications` calls live here (mobile); the diff/cap/priority math
 * is in `@festie/shared/utils/reminderSchedule` so it stays testable and shared.
 */
export function useLocalReminders(): void {
  const reminders = useFestivalDataStore((s) => s.currentProfile?.reminders);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const b2bSeparator = useFestivalDataStore((s) => s.currentFestival?.b2bSeparator);
  // Anchor fire times in the FESTIVAL's zone when known (falls back to
  // device-local). Recomputed on every reconcile, so a schedule change or a
  // device-zone change re-derives the correct fire instants.
  const festivalTimeZone = useFestivalDataStore((s) => resolveFestivalTimeZone(s.currentFestival));

  const setRemindersPref = useNotificationPrefsStore((s) => s.prefs.setReminders);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);

  // Track whether we've already requested permission so we ask at most once per
  // mount, and whether permission was granted.
  const permissionRef = useRef<{ requested: boolean; granted: boolean }>({ requested: false, granted: false });

  // Pull the latest server prefs once so gating reflects the real value even if
  // the user never opened the account screen. Best-effort — defaults to enabled.
  useEffect(() => {
    loadPrefs().catch(() => {});
  }, [loadPrefs]);

  useEffect(() => {
    let cancelled = false;

    async function reconcile(): Promise<void> {
      // Gate: when set reminders are disabled, tear down any local reminders we
      // previously scheduled and stop. (Don't touch FCM — that's server-gated.)
      if (!setRemindersPref) {
        await cancelAllFestieReminders();
        return;
      }

      const plan = buildReminderPlan({ reminders, picks, sets, days, timeZone: festivalTimeZone });

      // Nothing to schedule and (likely) nothing scheduled — still reconcile so
      // un-reminded sets get cancelled. But avoid prompting for permission when
      // there's no work and we've never been granted it.
      if (plan.length > 0 && !permissionRef.current.granted) {
        const granted = await ensurePermission();
        if (cancelled) return;
        if (!granted) return; // permission denied — no-op gracefully
      }

      let scheduled: Notifications.NotificationRequest[];
      try {
        scheduled = await Notifications.getAllScheduledNotificationsAsync();
      } catch (e) {
        Sentry.captureException(e);
        return;
      }
      if (cancelled) return;

      const scheduledIds = scheduled.map((n) => n.identifier);
      const { toSchedule, toCancel } = diffReminderPlan(plan, scheduledIds);

      // Cancel removed reminders by identifier.
      await Promise.all(
        toCancel.map((id) =>
          Notifications.cancelScheduledNotificationAsync(id).catch((e) => Sentry.captureException(e)),
        ),
      );
      if (cancelled) return;

      // (Re)schedule plan entries. Deterministic identifiers make this
      // idempotent — re-scheduling the same id replaces the prior one, so an
      // edited lead time gets the corrected fire date.
      await Promise.all(toSchedule.map((entry) => scheduleReminder(entry, b2bSeparator)));
    }

    reconcile();

    // Re-run on foreground: the wall-clock has advanced, so already-fired or
    // now-past reminders should be dropped and the ≤64 window re-evaluated.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
    // permissionRef is a ref (stable); intentionally excluded.
  }, [reminders, picks, sets, days, b2bSeparator, setRemindersPref, festivalTimeZone]);

  /** Request notification permission at most once; returns whether granted. */
  async function ensurePermission(): Promise<boolean> {
    if (permissionRef.current.granted) return true;
    try {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted' && !permissionRef.current.requested) {
        permissionRef.current.requested = true;
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      const granted = status === 'granted';
      permissionRef.current.granted = granted;
      return granted;
    } catch (e) {
      Sentry.captureException(e);
      return false;
    }
  }
}

/**
 * Schedule a single reminder. On Android we route to the existing high-importance
 * 'updates' channel (created by useMobilePush) so local reminders match the
 * importance of FCM set reminders.
 */
async function scheduleReminder(entry: ReminderPlanEntry, b2bSeparator?: string): Promise<void> {
  const name = artistDisplayName(entry.set, b2bSeparator) || 'Your set';
  const startLabel = new Date(entry.startMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lead = entry.leadMinutes;
  const leadText = lead >= 60 ? `${Math.round(lead / 60)}h` : `${lead}m`;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: entry.identifier,
      content: {
        title: `${name} in ${leadText}`,
        body: `Starts at ${startLabel}. Heads up from your Festie picks.`,
        sound: true,
        data: { kind: 'local-set-reminder', setId: entry.setId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(entry.fireAtMs),
        // Android-only; routes to the existing HIGH-importance 'updates' channel
        // (created by useMobilePush). Ignored on iOS.
        channelId: 'updates',
      },
    });
  } catch (e) {
    Sentry.captureException(e);
  }
}

/** Cancel every Festie local reminder currently scheduled (gate-off teardown). */
async function cancelAllFestieReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith('festie-reminder-'))
        .map((n) =>
          Notifications.cancelScheduledNotificationAsync(n.identifier).catch((e) => Sentry.captureException(e)),
        ),
    );
  } catch (e) {
    Sentry.captureException(e);
  }
}
