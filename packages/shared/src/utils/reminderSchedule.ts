import type { FestivalSet, FestivalDay, Priority } from '../types/domain';
import { getSetTimeBounds } from './setStatus';

/**
 * Platform-agnostic local-reminder planner.
 *
 * Pure scheduling logic shared by the mobile `useLocalReminders` hook (which
 * performs the actual `expo-notifications` calls). Kept here — not in mobile —
 * so the diff/cap/priority math lives once in `@festie/shared` and stays
 * testable without a native runtime.
 *
 * It turns the current profile's `reminders` map (`setId -> lead minutes`) into
 * a deterministic list of notifications to schedule: each entry has a stable
 * identifier `festie-reminder-<setId>` and an absolute `fireAtMs` computed from
 * the set's TZ-safe start (via the single-source `getSetTimeBounds`, incl.
 * post-midnight rollover) minus the lead minutes.
 *
 * Local-first delivery: these on-device notifications fire even in airplane
 * mode. FCM remains the at-home backstop and is unaffected by this planner.
 */

/** A single notification the device should have scheduled. */
export interface ReminderPlanEntry {
  /** Deterministic id — `festie-reminder-<setId>`. Stable across reschedules. */
  identifier: string;
  setId: string;
  /** Absolute fire time, epoch-ms (set start − lead). */
  fireAtMs: number;
  /** Lead time in minutes the reminder was set for. */
  leadMinutes: number;
  /** Set start, epoch-ms (for building the notification body). */
  startMs: number;
  priority: Priority;
  set: FestivalSet;
}

/**
 * iOS caps an app at 64 pending local notifications; anything beyond is silently
 * dropped. We honor the same cap on both platforms so behavior is identical.
 */
export const MAX_LOCAL_REMINDERS = 64;

/**
 * Default lead time (minutes) for a set reminder — the canonical "remind me 30
 * minutes before" used as the suggested default across the UI (Woov pattern).
 * Reminders are stored RELATIVE to the set (lead minutes, not an absolute
 * timestamp) so fire times can be recomputed whenever the schedule changes.
 */
export const DEFAULT_REMINDER_LEAD_MINUTES = 30;

/** Deterministic identifier for a set's reminder. */
export function reminderIdentifier(setId: string): string {
  return `festie-reminder-${setId}`;
}

// must > want-to-see > maybe. Lower rank = higher priority (kept first when
// the 64-notification cap forces us to drop the long tail).
const PRIORITY_RANK: Record<Priority, number> = {
  must: 0,
  'want-to-see': 1,
  maybe: 2,
};

export interface BuildReminderPlanArgs {
  /** `setId -> lead minutes` from `currentProfile.reminders`. */
  reminders: Record<string, number> | undefined | null;
  /** `setId -> priority` from `currentProfile.picks` (drives cap tie-breaks). */
  picks: Record<string, Priority> | undefined | null;
  sets: FestivalSet[];
  days: FestivalDay[];
  /** Injected clock (epoch-ms). Defaults to `Date.now()`. */
  nowMs?: number;
  /** Override the cap (testing); defaults to the iOS 64 limit. */
  max?: number;
  /**
   * Festival IANA time zone (e.g. `America/New_York`). When supplied, fire times
   * are computed from the set's wall-clock in the FESTIVAL's zone rather than the
   * device's local frame — so a reminder fires at the right real-world moment for
   * an attendee whose phone is set to another zone. Omit to keep device-local.
   */
  timeZone?: string;
}

/**
 * Build the deterministic set of reminders to schedule.
 *
 * Drops reminders whose fire time is already in the past (no point scheduling
 * them), sorts the remaining upcoming reminders by priority (must > want >
 * maybe) then by fire time, and caps to the next `max` (default 64). Sets with
 * no usable start time (TBA) are skipped.
 */
export function buildReminderPlan(args: BuildReminderPlanArgs): ReminderPlanEntry[] {
  const { reminders, picks, sets, days, timeZone } = args;
  const nowMs = args.nowMs ?? Date.now();
  const max = args.max ?? MAX_LOCAL_REMINDERS;

  if (!reminders) return [];

  const bySetId = new Map<string, FestivalSet>();
  for (const s of sets) bySetId.set(s.id, s);

  const entries: ReminderPlanEntry[] = [];
  for (const [setId, lead] of Object.entries(reminders)) {
    const leadMinutes = Number(lead);
    if (!Number.isFinite(leadMinutes) || leadMinutes < 0) continue;

    const set = bySetId.get(setId);
    if (!set) continue;

    const bounds = getSetTimeBounds(set, days, timeZone);
    if (!bounds) continue;

    const fireAtMs = bounds.startMs - leadMinutes * 60_000;
    // Skip reminders that would fire in the past — they can never deliver and
    // would just burn one of the 64 slots.
    if (fireAtMs <= nowMs) continue;

    const priority = (picks?.[setId] as Priority) || 'maybe';

    entries.push({
      identifier: reminderIdentifier(setId),
      setId,
      fireAtMs,
      leadMinutes,
      startMs: bounds.startMs,
      priority,
      set,
    });
  }

  entries.sort((a, b) => {
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank !== 0) return rank;
    return a.fireAtMs - b.fireAtMs;
  });

  return entries.slice(0, max);
}

export interface ReminderDiff {
  /** Entries whose schedule is new or changed — (re)schedule these. */
  toSchedule: ReminderPlanEntry[];
  /** Identifiers that were scheduled before but should no longer exist. */
  toCancel: string[];
}

/**
 * Diff a freshly-built plan against the identifiers currently scheduled on the
 * device. Anything in `scheduledIds` that the plan no longer contains is
 * cancelled; everything in the plan is (re)scheduled. We always reschedule plan
 * entries rather than trying to detect per-field changes — `scheduleNotification`
 * with a deterministic identifier is idempotent, and the set of upcoming
 * reminders is tiny, so a full reconcile is simpler and avoids stale fire times
 * after a lead-minutes edit.
 */
export function diffReminderPlan(plan: ReminderPlanEntry[], scheduledIds: string[]): ReminderDiff {
  const planIds = new Set(plan.map((e) => e.identifier));
  const toCancel = scheduledIds.filter((id) => id.startsWith('festie-reminder-') && !planIds.has(id));
  return { toSchedule: plan, toCancel };
}
