// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * ongoingNotification.ts — pure model for the M6 "ongoing notification" surface
 * (Android sticky notification today; iOS Live Activity is a deferred native
 * spike). All the *decisions* live here so web/native/test share one source of
 * truth and the platform hook stays a thin side-effect shell:
 *
 *   - which of the user's picked sets is playing NOW (or, if none, what's NEXT),
 *   - which cached meeting point is the "active" one to surface,
 *   - whether we are still inside the festival window at all (so the hook knows
 *     when to cancel),
 *   - the exact title/body strings to render.
 *
 * Offline-honest by construction: this is driven entirely by the ON-DEVICE timed
 * set model (getSetTimeBounds) plus the LAST-CACHED meeting point — never from a
 * live push. The strings therefore never imply real-time data; the meeting-point
 * line is explicitly framed as "last-synced" by the caller-supplied freshness.
 *
 * Pure + platform-agnostic: no React, no expo, no Date.now() — `now` is injected
 * so the same function is trivially testable and behaves identically on web/RN.
 */

import type { FestivalSet, FestivalDay, CrewMeetingPoint } from '../types/domain';
import { getSetTimeBounds } from './setStatus';

/**
 * Minimal shape the ongoing-notification model needs about a picked set. The
 * caller resolves the human-facing `name` (artist display name, already
 * B2B-joined) so this module never re-implements artist formatting.
 */
export interface OngoingSetInput {
  set: Pick<FestivalSet, 'id' | 'startTime' | 'endTime' | 'date' | 'dayIndex'>;
  /** Display name for the set (resolved artist label). */
  name: string;
  /** Optional stage label, surfaced after the set name when present. */
  stageName?: string | null;
}

/** A picked set resolved to absolute epoch-ms bounds + its display fields. */
interface TimedSet {
  id: string;
  name: string;
  stageName: string | null;
  startMs: number;
  endMs: number;
}

export interface OngoingNotificationModelInput {
  /** The user's picked sets (already filtered to picks) + resolved names. */
  sets: OngoingSetInput[];
  /** Festival days for TZ-safe date resolution (same array getSetStatus uses). */
  days?: FestivalDay[];
  /** Last-cached crew meeting points (offline read-cache; may be empty). */
  meetingPoints?: CrewMeetingPoint[];
  /** Current time, injected for purity/testability. */
  now: number;
  /**
   * Epoch-ms the meeting-point cache was last synced from the server, if known.
   * Used only to frame the meeting-point line as "last-synced" — never to imply
   * the point is live. Omit when unknown (the caller then shows a generic
   * "last-synced" qualifier).
   */
  meetingPointSyncedAt?: number | null;
}

export interface OngoingNotificationModel {
  /**
   * True while we are inside the festival's overall set window (from the first
   * picked set's start to the last picked set's end, with a small lead-in so the
   * notification appears shortly BEFORE the first set). When false the caller
   * cancels the ongoing notification.
   */
  active: boolean;
  /** Title line, e.g. "Now: Anyma" or "Next: Anyma in 25m". Null when inactive. */
  title: string | null;
  /**
   * Body line combining the set's stage/countdown context and the active
   * meeting-point label (offline-honest, "last-synced"). Null when inactive.
   */
  body: string | null;
  /** The set the title refers to, for callers that want structured access. */
  focusSet: { id: string; name: string; kind: 'now' | 'next' } | null;
  /** The meeting point surfaced, if any. */
  meetingPointLabel: string | null;
}

/**
 * How long before the first picked set the notification should appear, and how
 * long after the last set ends it lingers. Keeps the sticky notification from
 * popping up days early or hanging forever after the festival.
 */
const LEAD_IN_MS = 60 * 60_000; // 1h before first set
const LINGER_MS = 30 * 60_000; // 30m after last set

/** Resolve picked sets to epoch-ms bounds, dropping TBA/unparseable ones. */
function toTimedSets(sets: OngoingSetInput[], days: FestivalDay[]): TimedSet[] {
  const out: TimedSet[] = [];
  for (const entry of sets) {
    const bounds = getSetTimeBounds(entry.set, days);
    if (!bounds) continue;
    out.push({
      id: entry.set.id,
      name: entry.name,
      stageName: entry.stageName ?? null,
      startMs: bounds.startMs,
      endMs: bounds.endMs,
    });
  }
  return out;
}

/**
 * Choose the "active" meeting point from the last-cached list. Preference order:
 *   1. an explicitly `active` point,
 *   2. otherwise the most recently created point
 * Optimistic-offline placeholders are eligible (they ARE the user's cached
 * intent). Returns null when there are no usable points.
 */
export function pickActiveMeetingPoint(meetingPoints: CrewMeetingPoint[] = []): CrewMeetingPoint | null {
  if (!meetingPoints.length) return null;
  const flagged = meetingPoints.filter((m) => m.active);
  const pool = flagged.length ? flagged : meetingPoints;
  // Most recently created wins (created_at is an ISO string; lexicographic
  // compare is chronological for ISO-8601, and a safe fallback if parse fails).
  return [...pool].sort((a, b) => {
    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
    return (b.created_at || '').localeCompare(a.created_at || '');
  })[0]!;
}

/** Compact countdown for the notification body, e.g. "25m" or "1h 5m". */
function fmtCountdown(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "until 23:30"-style end label in the device's local frame. */
function fmtClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Build the ongoing-notification model from the on-device set + meeting-point
 * data. Pure: no I/O, no clock read. See OngoingNotificationModel for the shape
 * the platform hook renders.
 */
export function buildOngoingNotificationModel(input: OngoingNotificationModelInput): OngoingNotificationModel {
  const { now, days = [], meetingPoints = [] } = input;
  const timed = toTimedSets(input.sets, days);

  const inactive: OngoingNotificationModel = {
    active: false,
    title: null,
    body: null,
    focusSet: null,
    meetingPointLabel: null,
  };

  if (!timed.length) return inactive;

  // Festival window = first start (minus lead-in) → last end (plus linger).
  const windowStart = Math.min(...timed.map((s) => s.startMs)) - LEAD_IN_MS;
  const windowEnd = Math.max(...timed.map((s) => s.endMs)) + LINGER_MS;
  if (now < windowStart || now > windowEnd) return inactive;

  // What's playing now (earliest-ending current set, if multiple overlap).
  const current = timed.filter((s) => s.startMs <= now && s.endMs > now).sort((a, b) => a.endMs - b.endMs)[0];

  // Otherwise the soonest upcoming set.
  const next = timed.filter((s) => s.startMs > now).sort((a, b) => a.startMs - b.startMs)[0];

  const focus = current ?? next ?? null;

  const mp = pickActiveMeetingPoint(meetingPoints);
  const meetingPointLabel = mp ? mp.label : null;

  // Offline-honest meeting-point line. NEVER implies the point is live.
  let mpLine: string | null = null;
  if (mp) {
    const where = mp.location ? ` (${mp.location})` : '';
    mpLine = `Meet: ${mp.label}${where} · last-synced`;
  }

  if (!focus) {
    // Inside the window but between sets with nothing left to show: keep the
    // notification alive (window still active) but show only the meeting point.
    return {
      active: true,
      title: 'Festival mode',
      body: mpLine ?? 'No more picks coming up.',
      focusSet: null,
      meetingPointLabel,
    };
  }

  const isNow = current != null;
  const setLine = focus.stageName ? `${focus.name} · ${focus.stageName}` : focus.name;

  let title: string;
  let setContext: string;
  if (isNow) {
    title = `Now: ${focus.name}`;
    setContext = `${setLine} · until ${fmtClock(focus.endMs)}`;
  } else {
    const inLabel = fmtCountdown(focus.startMs - now);
    title = `Next: ${focus.name} in ${inLabel}`;
    setContext = `${setLine} · ${fmtClock(focus.startMs)} (in ${inLabel})`;
  }

  const body = mpLine ? `${setContext}\n${mpLine}` : setContext;

  return {
    active: true,
    title,
    body,
    focusSet: { id: focus.id, name: focus.name, kind: isNow ? 'now' : 'next' },
    meetingPointLabel,
  };
}
