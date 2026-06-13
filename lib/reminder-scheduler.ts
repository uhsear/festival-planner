// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Reminder Scheduler  Background job that fires FCM push notifications
 * for upcoming sets with active reminders.
 *
 * Runs every 60s. For each active festival, queries profiles with non-empty
 * reminders_json, computes fire times, checks prefs/DND/dedup, sends FCM.
 *
 * Leader election: PM2 cluster runs 4 workers. Only the worker with
 * NODE_APP_INSTANCE === '0' runs the scheduler to prevent duplicate
 * notifications (4x fan-out). Other workers return a no-op start/stop.
 */

import { isInDndWindow } from './notifications/index.js';
import { zonedWallTimeToMs } from './time-zone.js';

function createReminderScheduler({ pool, stores, notificationService, log, config }: any) {
  // ── Leader election (PM2 cluster) ──────────────────────────────────────────
  // PM2 sets NODE_APP_INSTANCE to '0'..'3' in cluster mode. Only instance 0
  // runs the scheduler; other workers return a no-op start/stop so the tick
  // fires exactly once per cycle instead of 4x.
  const instance = process.env.NODE_APP_INSTANCE;
  const isLeader = instance === undefined || instance === '0';
  if (!isLeader) {
    log.info('reminder-scheduler: not leader (instance !== 0), skipping scheduler start', {
      instance,
    });
    return {
      start: () => {},
      stop: () => {},
      tick: async () => {},
      _timer: () => null,
    };
  }

  const _firedCache = new Map<string, number>(); // `${userId}:${setId}`  timestamp (in-memory dedup)

  function _cleanDedupCache() {
    const cutoff = Date.now() - config.REMINDER_DEDUP_TTL_MS;
    for (const [key, ts] of _firedCache) {
      if (ts < cutoff) _firedCache.delete(key);
    }
  }

  /**
   * Compute absolute timestamp for a set given festival day date and set start time.
   * festival_days stores date as 'YYYY-MM-DD', festival_sets stores start_time as 'HH:MM'.
   *
   * `timeZone` (optional IANA id): when supplied the wall-clock is anchored in
   * the FESTIVAL's zone (DST-correct, absolute epoch-ms) so reminders fire at the
   * right real-world instant for attendees whose device is in another zone. When
   * absent — or invalid — falls back to the bare local parse (the exact prior
   * behavior), so zone-less festivals are unchanged.
   */
  function computeSetStartMs(dayDate: any, startTime: any, timeZone?: string | null) {
    if (!dayDate || !startTime) return null;
    const dateStr = typeof dayDate === 'object' ? dayDate.toISOString().slice(0, 10) : String(dayDate).slice(0, 10);
    const [h, m] = startTime.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;

    if (timeZone) {
      // Anchor the wall-clock in the festival's zone (absolute epoch-ms).
      const [y, mo, d] = dateStr.split('-').map(Number);
      const ms = zonedWallTimeToMs(y, mo, d, h, m, timeZone);
      if (!isNaN(ms)) return ms;
      // Invalid zone → fall through to the bare-local parse below.
    }

    const dt = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    return isNaN(dt.getTime()) ? null : dt.getTime();
  }

  async function processProfileReminders(
    profile: any,
    setLookup: Map<string, any>,
    festival: any,
    now: number,
    { notify, logger }: any,
  ) {
    let reminders: any;
    try {
      reminders =
        typeof profile.remindersJson === 'string' ? JSON.parse(profile.remindersJson) : profile.remindersJson || {};
    } catch (err: any) {
      logger.warn('reminder json parse failed, skipping profile', { userId: profile.userId, error: err.message });
      return;
    }

    for (const [setId, minutesBefore] of Object.entries(reminders)) {
      const setInfo = setLookup.get(setId);
      if (!setInfo) continue;

      const fireAt = setInfo.startMs - (minutesBefore as number) * 60_000;
      if (fireAt < now || fireAt > now + config.REMINDER_FIRE_WINDOW_MS) continue;

      // Dedup check
      const dedupKey = `${profile.userId}:${setId}`;
      if (_firedCache.has(dedupKey)) continue;

      // Check notification preferences
      try {
        const prefs = await stores.notificationPrefs.get(profile.userId);
        if (prefs && prefs.setReminders === false) continue;

        // DND check
        if (isInDndWindow(prefs)) continue;
      } catch {
        // If pref lookup fails, send anyway
      }

      // Fire FCM
      try {
        await notify({
          userId: profile.userId,
          type: 'set_reminder',
          title: `${setInfo.artistName} in ${minutesBefore} min`,
          body: `${setInfo.startTime} at ${setInfo.stageName || 'Main Stage'}`,
          data: {
            type: 'set_reminder',
            festivalId: festival.id,
            setId,
            deepLink: `rave://festival/${festival.id}?set=${setId}`,
          },
          threadId: `reminder-${festival.id}`,
        });
        _firedCache.set(dedupKey, now);
        logger.debug('reminder fired', { userId: profile.userId, setId, minutesBefore });
      } catch (err: any) {
        logger.warn('reminder send failed', { userId: profile.userId, setId, error: err.message });
      }
    }
  }

  async function tick() {
    try {
      // 1. Find active festivals
      const { rows: festivals } = await pool.query(
        'SELECT id, name, time_zone AS "timeZone" FROM festivals WHERE deleted_at IS NULL',
      );
      if (festivals.length === 0) return;

      const now = Date.now();
      _cleanDedupCache();

      for (const festival of festivals) {
        // 2. Load days, stages, and sets from normalized tables
        const [daysResult, stagesResult, setsResult] = await Promise.all([
          pool.query('SELECT day_index, label, date FROM festival_days WHERE festival_id = $1', [festival.id]),
          pool.query('SELECT id, name FROM festival_stages WHERE festival_id = $1', [festival.id]),
          pool.query(
            'SELECT id, day_index, artist, artists, stage_id, start_time AS "startTime", end_time AS "endTime" FROM festival_sets WHERE festival_id = $1',
            [festival.id],
          ),
        ]);

        const dayMap = new Map<any, any>(daysResult.rows.map((d: any) => [d.day_index, d]));
        const stageMap = new Map<any, any>(stagesResult.rows.map((s: any) => [s.id, s]));

        // Build set lookup: setId  { startMs, startTime, artistName, stageName }
        const setLookup = new Map<string, any>();
        for (const set of setsResult.rows) {
          const day = dayMap.get(set.day_index);
          if (!day) continue;
          const startMs = computeSetStartMs(day.date, set.startTime, festival.timeZone);
          if (!startMs) continue;
          let artistName: string;
          if (set.artists && Array.isArray(set.artists) && set.artists.length > 0) {
            artistName = set.artists.map((a: any) => a.name || a).join(' b2b ');
          } else {
            artistName = set.artist || 'Unknown';
          }
          const stage = stageMap.get(set.stage_id);
          setLookup.set(set.id, {
            startMs,
            startTime: set.startTime,
            artistName,
            stageName: stage ? stage.name : '',
          });
        }
        if (setLookup.size === 0) continue;

        // 3. Query profiles with active reminders for this festival
        const { rows: profiles } = await pool.query(
          `
          SELECT
            fp.id,
            fp.user_id AS "userId",
            fp.reminders_json AS "remindersJson",
            fp.picks_json AS "picksJson"
          FROM
            festival_profiles fp
          WHERE
            fp.festival_id = $1
            AND fp.reminders_json IS NOT NULL
            AND fp.reminders_json != '{}'::jsonb
            AND fp.deleted_at IS NULL
        `,
          [festival.id],
        );

        const deps = { notify: notificationService.send.bind(notificationService), logger: log };
        for (const profile of profiles) {
          await processProfileReminders(profile, setLookup, festival, now, deps);
        }
      }
    } catch (err: any) {
      log.error('reminder scheduler tick failed', { error: err.message });
    }
  }

  let _timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (_timer) return;
    _timer = setInterval(tick, config.REMINDER_TICK_INTERVAL_MS);
    _timer.unref();
    log.info('reminder scheduler started', { instance });
  }

  function stop() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
    _firedCache.clear();
  }

  return { start, stop, tick, _timer: () => _timer };
}

export { createReminderScheduler };
