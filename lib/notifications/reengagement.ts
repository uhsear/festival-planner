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
// FAN-OUT: all three triggers push to EVERY eligible (deduped, pref/DND-passing)
// recipient via `pushFanout` — bounded-concurrency chunks (25 at a time) so a
// large prior-year/attendee fan-out neither drops the tail nor stampedes the
// push provider. Email is best-effort and degrades when RESEND_API_KEY is unset.

import crypto from 'crypto';
import { sendWrapReadyEmail, sendLineupDropEmail, sendCrewReformEmail } from '../email.js';
import { zonedWallTimeToMs } from '../time-zone.js';

/**
 * Backend mirror of `@festie/shared` `isFestivalOver`: true once the festival's
 * last day's 23:59 has passed. Kept inline rather than importing shared runtime
 * code across the package boundary (the backend runs via tsx and shared ships
 * ESM with .js specifiers). `days` is the festival's day array ([{date}], from
 * festivals.getById).
 *
 * The end-of-day cutoff is anchored in the festival's IANA `timeZone` (the same
 * `zonedWallTimeToMs` the reminder scheduler uses) so "over" reflects the
 * festival's actual local end-of-day, not the server's zone. When `timeZone` is
 * null/absent — or invalid — it falls back to UTC (NOT server-local), so the
 * cutoff is deterministic across deployments.
 */
function isFestivalOver(days: Array<{ date?: string | null }> | null | undefined, timeZone?: string | null): boolean {
  const arr = days || [];
  if (!arr.length) return false;
  const last = arr[arr.length - 1];
  if (!last?.date) return false;
  const parts = String(last.date).split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return false;
  let cutoffMs: number;
  if (timeZone) {
    cutoffMs = zonedWallTimeToMs(y, mo, d, 23, 59, timeZone);
    if (Number.isNaN(cutoffMs)) {
      // Invalid zone → fall back to UTC end-of-day.
      cutoffMs = Date.UTC(y, mo - 1, d, 23, 59, 59);
    }
  } else {
    // No festival zone → UTC end-of-day (deterministic, not server-local).
    cutoffMs = Date.UTC(y, mo - 1, d, 23, 59, 59);
  }
  return cutoffMs < Date.now();
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

  /**
   * Batch dedup: return ONLY the user ids that have NOT already seen this event,
   * using a single existsForEvents query (no N+1). Intentionally does NOT
   * fail-open — if the dedup read throws it PROPAGATES so the BullMQ worker marks
   * the job failed and retries later (safe: retries are idempotent), rather than
   * re-blasting every recipient on a transient DB blip. Falls back to "all
   * fresh" only when the store doesn't expose existsForEvents at all.
   */
  async function filterFresh(userIds: string[], type: string, eventKey: string): Promise<string[]> {
    if (!userIds.length) return [];
    if (!stores?.notificationLog?.existsForEvents) return [...userIds];
    const seen: Set<string> = await stores.notificationLog.existsForEvents(userIds, type, eventKey);
    return userIds.filter((uid) => !seen.has(uid));
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
    if (!isFestivalOver(festival.days, festival.timeZone)) {
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
    // ONE batch dedup query pre-filters already-notified users so a re-run never
    // re-pushes; a dedup read failure propagates (no fail-open re-blast).
    const fresh = await filterFresh(attendeeIds, 'wrap_ready', eventKey);

    // Push to ALL fresh attendees in bounded chunks (no MAX_PUSH_BATCH drop).
    const deepLink = `${origin()}/wrap?festival=${encodeURIComponent(festivalId)}`;
    const pushSent = await pushFanout(fresh, () => ({
      type: 'wrap_ready',
      title: `${festivalName}: your wrap is ready`,
      body: 'Relive your top sets and crew superlatives.',
      data: { festivalId, eventKey, deepLink },
    }));

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
    const fresh = await filterFresh(priorIds, 'lineup_drop', eventKey);
    if (fresh.length === 0) return { sent: 0, reason: 'all_deduped' };

    // Prior-year attendees are NOT in the new festival, so we push per-user
    // (each respects pref + DND) — now over ALL of them in bounded chunks
    // instead of dropping the tail past MAX_PUSH_BATCH.
    const deepLink = `${origin()}/festival/${encodeURIComponent(festivalId)}`;
    const pushSent = await pushFanout(fresh, () => ({
      type: 'lineup_drop',
      title: `${festivalName} lineup just dropped`,
      body: 'Start picking your sets.',
      data: { festivalId, eventKey, deepLink },
    }));

    const emailSent = await emailFanout(fresh, 'lineup_drop', eventKey, async (user) =>
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
    const fresh = await filterFresh(invited, 'crew_reformed', eventKey);
    if (fresh.length === 0) return { sent: 0, reason: 'all_deduped' };

    const reformDeepLink = inviteUrl || `${origin()}/crew/${encodeURIComponent(newCrewId)}`;
    const pushSent = await pushFanout(fresh, () => ({
      type: 'crew_reformed',
      title: `${crewName || 'Your crew'} reformed`,
      body: festivalName ? `Back together for ${festivalName}. Jump in.` : 'Back together. Jump in.',
      data: { crewId: newCrewId, eventKey, deepLink: reformDeepLink },
    }));

    const emailSent = await emailFanout(fresh, 'crew_reformed', eventKey, async (user) =>
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
   * Push to EVERY user in `userIds` via per-user `notify.send` (each respects
   * pref + DND), in bounded-concurrency chunks so a large fan-out neither drops
   * the tail (the old MAX_PUSH_BATCH cap) nor stampedes the push provider.
   * Returns the total number of pushes delivered.
   */
  async function pushFanout(userIds: string[], buildPayload: (uid: string) => any): Promise<number> {
    if (!userIds.length || !notify.isConfigured || typeof notify.send !== 'function') return 0;
    const CHUNK = 25;
    let sent = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const batch = userIds.slice(i, i + CHUNK);
      const results = await Promise.all(
        batch.map(async (uid) => {
          try {
            const r = await notify.send({ userId: uid, ...buildPayload(uid) });
            return r?.sent || 0;
          } catch (err: any) {
            log?.debug?.('pushFanout: send failed', { userId: uid, error: err?.message });
            return 0;
          }
        }),
      );
      sent += results.reduce((a: number, b: number) => a + b, 0);
    }
    return sent;
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
    // Email dedup shares the eventKey but uses a distinct type suffix so a push
    // log row does not suppress the email (and vice-versa). ONE batch dedup
    // query for the whole fan-out (no N+1); a read failure propagates rather
    // than fail-open re-blasting every address.
    const emailEventKey = `${eventKey}#email`;
    const fresh = await filterFresh(userIds, type, emailEventKey);
    let sent = 0;
    for (const uid of fresh) {
      const user = users.get(uid);
      if (!user?.email) continue;
      let ok: boolean;
      try {
        ok = await sendFn(user);
      } catch (err: any) {
        log?.debug?.('reengagement: email send failed', { userId: uid, type, error: err?.message });
        continue;
      }
      if (!ok) continue;
      sent += 1;
      // Record an email-channel log row for dedup on re-runs. A failed insert
      // here means the NEXT run will re-send this email (no dedup row), so it
      // must be visible in prod — log at warn, not debug.
      try {
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
      } catch (err: any) {
        log?.warn?.('reengagement: email dedup-row insert failed (may re-send on next run)', {
          userId: uid,
          eventKey: emailEventKey,
          type,
          error: err?.message,
        });
      }
    }
    return sent;
  }

  return { sendWrapReady, sendLineupDrop, sendCrewReformed };
}
