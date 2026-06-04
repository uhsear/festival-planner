// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

//
// M3 "Re-engagement triggers" — after-festival growth loops.
//
// Three event-gated push/email notifications:
//   • lineup_drop    — a recurring (same-named) festival publishes its lineup →
//                      notify users who attended a PRIOR edition of that festival.
//   • crew_reformed  — a prior crew is reformed for a new festival → notify the
//                      INVITED prior members (handed in by the reform route).
//   • wrap_ready     — a festival is over → notify its attendees that the recap
//                      is ready (`sendWrapReady(festivalId)`).
//
// HARD RULES (enforced here + in send.ts):
//   - strictly event-gated (called from real events, never a cron sweep);
//   - per-type opt-out (PREF_MAP → notification_preferences columns, checked in send.ts);
//   - DND-respecting (isInDndWindow, checked in send.ts);
//   - deduped once-per-event-per-user via notification_log.existsForEvent on a
//     stable `eventKey` we stash in the notification data (data_json.eventKey).
//
// KNOWN LIMIT (lineup_drop): targeting prior-year attendees can exceed
// MAX_PUSH_BATCH (200) inside sendToOfflineUsers' single capped call. We honor
// the cap and emit a clear log + TODO for a real fan-out queue. We do NOT build
// the queue here. Email is best-effort and degrades when RESEND_API_KEY is unset.

import crypto from 'crypto';
import { sendWrapReadyEmail, sendLineupDropEmail, sendCrewReformEmail } from '../email.js';

const MAX_PUSH_BATCH = 200;

/**
 * Backend mirror of `@festie/shared` `isFestivalOver` (the SAME logic that gates
 * wrap.tsx): true once the festival's last day's 23:59 local has passed. Kept
 * inline rather than importing shared runtime code across the package boundary
 * (the backend runs via tsx and shared ships ESM with .js specifiers). `days`
 * is the festival's day array ([{date}], from festivals.getById).
 */
function isFestivalOver(days: Array<{ date?: string | null }> | null | undefined): boolean {
  const arr = days || [];
  if (!arr.length) return false;
  const last = arr[arr.length - 1];
  if (!last?.date) return false;
  const endDt = new Date(last.date + 'T23:59:59');
  return endDt < new Date();
}

/**
 * Build the re-engagement trigger surface.
 *
 * @param deps.stores  DB stores (profiles, users, notificationLog, pool, ...)
 * @param deps.config  App config (PUBLIC_ORIGIN, RESEND_API_KEY, ...)
 * @param deps.log     Logger
 * @param deps.notificationService  The push service ({ send, sendToOfflineUsers, isConfigured })
 * @param deps.pool    Optional pg Pool override (defaults to stores.pool) — handy for tests.
 */
export function createReengagementTriggers({ stores, config, log, notificationService, pool }: any) {
  const db = pool || stores?.pool;
  const notify = notificationService || {};

  /** Fetch {id, email, username} for a set of user ids that still have an email. */
  async function loadUsers(userIds: string[]): Promise<Map<string, any>> {
    if (!userIds.length || !stores?.users?.getByIds) return new Map();
    try {
      return await stores.users.getByIds(userIds);
    } catch (err: any) {
      log?.warn?.('reengagement: loadUsers failed', { error: err?.message });
      return new Map();
    }
  }

  /** Per-user dedup guard — true if this user has already seen this event. */
  async function alreadyNotified(userId: string, type: string, eventKey: string) {
    if (!stores?.notificationLog?.existsForEvent) return false;
    try {
      return await stores.notificationLog.existsForEvent(userId, type, eventKey);
    } catch (err: any) {
      log?.debug?.('reengagement: dedup check failed (treating as not-seen)', { error: err?.message });
      return false;
    }
  }

  // ── wrap_ready ──────────────────────────────────────────────────────────
  //
  // Fires when a festival is over. Reuses the SAME isFestivalOver logic that
  // gates wrap.tsx. Idempotent: deduped per user on eventKey `wrap:<festivalId>`.
  // The push goes through sendToOfflineUsers (capped + pref/DND-filtered); email
  // is best-effort to attendees with an address.
  async function sendWrapReady(festivalId: string) {
    if (!festivalId) return { sent: 0, reason: 'no_festival' };

    // Load the festival + its days to gate on isFestivalOver (same as wrap.tsx).
    let festival: any = null;
    try {
      festival = await stores?.festivals?.getById?.(festivalId);
    } catch (err: any) {
      log?.warn?.('sendWrapReady: festival load failed', { festivalId, error: err?.message });
    }
    if (!festival) return { sent: 0, reason: 'festival_not_found' };
    if (!isFestivalOver(festival.days)) {
      log?.debug?.('sendWrapReady: festival not over yet — skipping', { festivalId });
      return { sent: 0, reason: 'not_over' };
    }

    const festivalName = festival.name || 'your festival';
    const eventKey = `wrap:${festivalId}`;

    // Attendees of THIS festival.
    let attendeeIds: string[] = [];
    try {
      attendeeIds = (await stores?.profiles?.userIdsByFestival?.(festivalId)) || [];
    } catch (err: any) {
      log?.warn?.('sendWrapReady: attendee lookup failed', { festivalId, error: err?.message });
    }

    // Push (deduped per user). sendToOfflineUsers itself enforces pref+DND+cap.
    // We pre-filter dedup'd users so a re-run never re-pushes.
    const fresh: string[] = [];
    for (const uid of attendeeIds) {
      if (!(await alreadyNotified(uid, 'wrap_ready', eventKey))) fresh.push(uid);
    }

    let pushSent = 0;
    if (notify.isConfigured && typeof notify.sendToOfflineUsers === 'function' && fresh.length > 0) {
      const allAttendees = new Set(attendeeIds);
      const excludeUserIds = [...allAttendees].filter((u) => !fresh.includes(u));
      const r = await notify.sendToOfflineUsers({
        festivalId,
        type: 'wrap_ready',
        title: `${festivalName} — your wrap is ready`,
        body: 'Relive your top sets, crew superlatives, and the numbers.',
        data: { festivalId, eventKey, deepLink: `${origin()}/wrap?festival=${encodeURIComponent(festivalId)}` },
        excludeUserIds,
      });
      pushSent = r?.sent || 0;
      if (fresh.length > MAX_PUSH_BATCH) {
        log?.warn?.(
          'sendWrapReady: attendee fan-out exceeds MAX_PUSH_BATCH — capped single call. ' +
            'TODO: replace with a real fan-out queue for large festivals.',
          { festivalId, total: fresh.length, cap: MAX_PUSH_BATCH },
        );
      }
    }

    // Email (best-effort; degrades when RESEND_API_KEY unset).
    const emailSent = await emailFanout(fresh, 'wrap_ready', eventKey, async (user) =>
      sendWrapReadyEmail({
        to: user.email,
        username: user.username,
        festivalName,
        festivalId,
        config,
        log,
      }),
    );

    log?.info?.('sendWrapReady: done', { festivalId, attendees: attendeeIds.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey };
  }

  // ── lineup_drop ─────────────────────────────────────────────────────────
  //
  // Fires from the admin lineup-import path. Targets PRIOR-year attendees of the
  // SAME-NAMED recurring festival (the inverse of getAttendedFestivals: users
  // who attended an earlier edition but NOT the new one). Deduped per user on
  // eventKey `lineup:<festivalId>`.
  async function sendLineupDrop(festivalId: string) {
    if (!festivalId || !db) return { sent: 0, reason: 'no_festival' };

    // Resolve the new festival's name.
    let festivalName = '';
    try {
      const { rows } = await db.query('SELECT name FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
      festivalName = rows[0]?.name || '';
    } catch (err: any) {
      log?.warn?.('sendLineupDrop: name lookup failed', { festivalId, error: err?.message });
    }
    if (!festivalName) return { sent: 0, reason: 'festival_not_found' };

    // Prior-year attendees: users with a profile in an EARLIER same-named
    // festival, who do NOT already have a profile in THIS one. Excludes deleted.
    let priorIds: string[];
    try {
      const { rows } = await db.query(
        `
        SELECT DISTINCT p.user_id AS "userId"
        FROM festival_profiles p
        JOIN festivals fp ON fp.id = p.festival_id AND fp.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND p.user_id IS NOT NULL
          AND fp.id <> $1
          AND lower(fp.name) = (SELECT lower(name) FROM festivals WHERE id = $1)
          AND NOT EXISTS (
            SELECT 1 FROM festival_profiles cur
            WHERE cur.user_id = p.user_id AND cur.festival_id = $1 AND cur.deleted_at IS NULL
          )
        `,
        [festivalId],
      );
      priorIds = rows.map((r: any) => r.userId).filter(Boolean);
    } catch (err: any) {
      log?.warn?.('sendLineupDrop: prior-attendee query failed', { festivalId, error: err?.message });
      return { sent: 0, reason: 'query_failed' };
    }
    if (priorIds.length === 0) return { sent: 0, reason: 'no_prior_attendees' };

    const eventKey = `lineup:${festivalId}`;
    const fresh: string[] = [];
    for (const uid of priorIds) {
      if (!(await alreadyNotified(uid, 'lineup_drop', eventKey))) fresh.push(uid);
    }
    if (fresh.length === 0) return { sent: 0, reason: 'all_deduped' };

    // KNOWN LIMIT: prior-year fan-out can exceed MAX_PUSH_BATCH. sendToOfflineUsers
    // targets BY FESTIVAL membership, but these users are NOT in the new festival —
    // so we push to them directly per-user via notify.send (each respects pref+DND),
    // capped at MAX_PUSH_BATCH with a clear TODO for a real fan-out queue.
    let pushSent = 0;
    const capped = fresh.slice(0, MAX_PUSH_BATCH);
    if (fresh.length > MAX_PUSH_BATCH) {
      log?.warn?.(
        'sendLineupDrop: prior-attendee fan-out exceeds MAX_PUSH_BATCH — capped. ' +
          'TODO: replace with a real fan-out queue (this single capped call drops the tail).',
        { festivalId, total: fresh.length, cap: MAX_PUSH_BATCH },
      );
    }
    if (notify.isConfigured && typeof notify.send === 'function') {
      for (const uid of capped) {
        try {
          const r = await notify.send({
            userId: uid,
            type: 'lineup_drop',
            title: `${festivalName} lineup just dropped`,
            body: 'Start building your picks and rally the crew.',
            data: { festivalId, eventKey, deepLink: `${origin()}/festival/${encodeURIComponent(festivalId)}` },
          });
          if (r?.sent) pushSent += r.sent;
        } catch (err: any) {
          log?.debug?.('sendLineupDrop: push failed', { userId: uid, error: err?.message });
        }
      }
    }

    const emailSent = await emailFanout(capped, 'lineup_drop', eventKey, async (user) =>
      sendLineupDropEmail({ to: user.email, username: user.username, festivalName, festivalId, config, log }),
    );

    log?.info?.('sendLineupDrop: done', { festivalId, priorAttendees: priorIds.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey, priorAttendees: priorIds.length };
  }

  // ── crew_reformed ─────────────────────────────────────────────────────────
  //
  // Fires from the reform route. The route already computed the INVITED prior
  // members (who lack a target-festival profile). Notify exactly those users.
  // Deduped per user on eventKey `reform:<newCrewId>`.
  async function sendCrewReformed({ newCrewId, crewName, festivalName, invitedUserIds, inviteUrl }: any) {
    const invited = (invitedUserIds || []).filter(Boolean);
    if (!newCrewId || invited.length === 0) return { sent: 0, reason: 'no_invitees' };

    const eventKey = `reform:${newCrewId}`;
    const fresh: string[] = [];
    for (const uid of invited) {
      if (!(await alreadyNotified(uid, 'crew_reformed', eventKey))) fresh.push(uid);
    }
    if (fresh.length === 0) return { sent: 0, reason: 'all_deduped' };

    let pushSent = 0;
    const capped = fresh.slice(0, MAX_PUSH_BATCH);
    if (fresh.length > MAX_PUSH_BATCH) {
      log?.warn?.('sendCrewReformed: invitee fan-out exceeds MAX_PUSH_BATCH — capped (TODO: fan-out queue)', {
        newCrewId,
        total: fresh.length,
        cap: MAX_PUSH_BATCH,
      });
    }
    if (notify.isConfigured && typeof notify.send === 'function') {
      for (const uid of capped) {
        try {
          const r = await notify.send({
            userId: uid,
            type: 'crew_reformed',
            title: `${crewName || 'Your crew'} reformed`,
            body: festivalName ? `Back together for ${festivalName}. Jump in.` : 'Back together. Jump in.',
            data: {
              crewId: newCrewId,
              eventKey,
              deepLink: inviteUrl || `${origin()}/crew/${encodeURIComponent(newCrewId)}`,
            },
          });
          if (r?.sent) pushSent += r.sent;
        } catch (err: any) {
          log?.debug?.('sendCrewReformed: push failed', { userId: uid, error: err?.message });
        }
      }
    }

    const emailSent = await emailFanout(capped, 'crew_reformed', eventKey, async (user) =>
      sendCrewReformEmail({
        to: user.email,
        username: user.username,
        crewName,
        festivalName,
        crewId: newCrewId,
        inviteUrl,
        config,
        log,
      }),
    );

    log?.info?.('sendCrewReformed: done', { newCrewId, invited: invited.length, pushSent, emailSent });
    return { sent: pushSent, emailSent, eventKey };
  }

  // ── shared helpers ────────────────────────────────────────────────────────

  function origin() {
    return String(config?.PUBLIC_ORIGIN || 'https://festie.us').replace(/\/+$/, '');
  }

  /**
   * Send the per-type email to each user that has an address, deduping per user
   * on the same eventKey as the push (so a user opted out of push but kept email,
   * or vice-versa, still gets exactly one of each per event). Best-effort: a
   * failed send (incl. RESEND_API_KEY unset) is logged and counted as not-sent.
   */
  async function emailFanout(
    userIds: string[],
    type: string,
    eventKey: string,
    sendFn: (user: any) => Promise<boolean>,
  ): Promise<number> {
    if (!userIds.length) return 0;
    const users = await loadUsers(userIds);
    let sent = 0;
    for (const uid of userIds) {
      const user = users.get(uid);
      if (!user?.email) continue;
      // Email dedup shares the eventKey but uses a distinct type suffix so a push
      // log row does not suppress the email (and vice-versa).
      const emailEventKey = `${eventKey}#email`;
      if (await alreadyNotified(uid, type, emailEventKey)) continue;
      try {
        const ok = await sendFn(user);
        if (ok) {
          sent += 1;
          // Record an email-channel log row for dedup on re-runs.
          await stores?.notificationLog?.insert?.({
            id: crypto.randomUUID(),
            userId: uid,
            type,
            title: `${type} email`,
            body: '',
            dataJson: JSON.stringify({ eventKey: emailEventKey, channel: 'email' }),
            status: 'sent',
            platform: 'email',
            errorMessage: null,
          });
        }
      } catch (err: any) {
        log?.debug?.('reengagement: email send failed', { userId: uid, type, error: err?.message });
      }
    }
    return sent;
  }

  return { sendWrapReady, sendLineupDrop, sendCrewReformed };
}
