import type { Pool } from 'pg';

export default function createNotificationsStore(pool: Pool, _utils: any) {
  const deviceTokens = {
    async register({ id, userId, token, platform, deviceName }: any) {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

      await pool.query(`
        INSERT INTO device_tokens (id, user_id, token, platform, device_name, created_at, last_used_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(token) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform,
          device_name = EXCLUDED.device_name,
          last_used_at = EXCLUDED.last_used_at,
          expires_at = EXCLUDED.expires_at
      `, [id, userId, token, platform || 'web', deviceName || null, now, now, expiresAt]);
    },

    async getTokenOwner(token: string) {
      const result = await pool.query(
        'SELECT user_id AS "userId" FROM device_tokens WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())',
        [token],
      );
      return result.rows[0] || null;
    },

    async unregister(token: string, userId: string) {
      await pool.query('DELETE FROM device_tokens WHERE token = $1 AND user_id = $2', [token, userId]);
    },

    async listByUser(userId: string) {
      const result = await pool.query(`
        SELECT id, user_id AS "userId", token, platform, device_name AS "deviceName", created_at AS "createdAt", last_used_at AS "lastUsedAt"
        FROM device_tokens
        WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY last_used_at DESC
      `, [userId]);
      return result.rows;
    },

    async listByUsers(userIds: string[]) {
      if (!userIds || userIds.length === 0) return [];
      const placeholders = userIds.map((_: any, i: number) => `$${i + 1}`).join(',');
      const result = await pool.query(`
        SELECT id, user_id AS "userId", token, platform
        FROM device_tokens
        WHERE user_id IN (${placeholders}) AND (expires_at IS NULL OR expires_at > NOW())
      `, userIds);
      return result.rows;
    },

    async deleteByUser(userId: string) {
      await pool.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
    },

    async deleteStale(daysOld: any = 270) {
      const days = Math.max(1, Math.min(3650, Number.parseInt(daysOld, 10) || 270));
      await pool.query(
        `DELETE FROM device_tokens WHERE last_used_at < NOW() - make_interval(days => $1)`,
        [days],
      );
    },

    async deleteExpired() {
      await pool.query(
        `DELETE FROM device_tokens WHERE expires_at < NOW() OR last_used_at < NOW() - INTERVAL '60 days'`,
      );
    },
  };

  const notificationPrefs = {
    async get(userId: string) {
      const result = await pool.query(
        'SELECT user_id AS "userId", crew_updates AS "crewUpdates", set_reminders AS "setReminders", schedule_changes AS "scheduleChanges", dnd_start AS "dndStart", dnd_end AS "dndEnd" FROM notification_preferences WHERE user_id = $1',
        [userId],
      );
      return result.rows[0] || {
        userId,
        crewUpdates: 1,
        setReminders: 1,
        scheduleChanges: 1,
        dndStart: null,
        dndEnd: null,
      };
    },

    async upsert({ userId, crewUpdates, setReminders, scheduleChanges, dndStart, dndEnd }: any) {
      await pool.query(`
        INSERT INTO notification_preferences (user_id, crew_updates, set_reminders, schedule_changes, dnd_start, dnd_end)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(user_id) DO UPDATE SET
          crew_updates = EXCLUDED.crew_updates,
          set_reminders = EXCLUDED.set_reminders,
          schedule_changes = EXCLUDED.schedule_changes,
          dnd_start = EXCLUDED.dnd_start,
          dnd_end = EXCLUDED.dnd_end
      `, [
        userId,
        crewUpdates ? 1 : 0,
        setReminders ? 1 : 0,
        scheduleChanges ? 1 : 0,
        dndStart || null,
        dndEnd || null,
      ]);
    },
  };

  const notificationLog = {
    async insert(entry: any) {
      await pool.query(`
        INSERT INTO
          notification_log (
            id,
            user_id,
            type,
            title,
            body,
            data_json,
            status,
            platform,
            error_message,
            created_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        entry.id,
        entry.userId,
        entry.type,
        entry.title,
        entry.body,
        entry.dataJson,
        entry.status,
        entry.platform,
        entry.errorMessage,
      ]);
    },

    async listByUser(userId: string, limit: number = 50) {
      const result = await pool.query(`
        SELECT
          id,
          user_id AS "userId",
          type,
          title,
          body,
          status,
          platform,
          created_at AS "createdAt"
        FROM
          notification_log
        WHERE
          user_id = $1
        ORDER BY
          created_at DESC
        LIMIT
          $2
      `, [userId, limit]);
      return result.rows;
    },

    async updateStatus(id: string, status: string) {
      await pool.query(
        'UPDATE notification_log SET status = $1, delivered_at = NOW() WHERE id = $2',
        [status, id],
      );
    },
  };

  const notificationCounts = {
    async getByUser(userId: string) {
      const result = await pool.query(
        'SELECT user_id AS "userId", festival_id AS "festivalId", unread_updates AS "unreadUpdates" FROM notification_counts WHERE user_id = $1',
        [userId],
      );
      return result.rows;
    },

    async increment(userId: string, festivalId: string, field: string) {
      const unreadUpdates = field === 'updates' ? 1 : 0;

      await pool.query(`
        INSERT INTO notification_counts (user_id, festival_id, unread_updates, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT(user_id, festival_id) DO UPDATE SET
          unread_updates = notification_counts.unread_updates + EXCLUDED.unread_updates,
          updated_at = NOW()
      `, [userId, festivalId, unreadUpdates]);
    },

    async reset(userId: string, festivalId: string) {
      await pool.query(
        'UPDATE notification_counts SET unread_updates = 0, updated_at = NOW() WHERE user_id = $1 AND festival_id = $2',
        [userId, festivalId],
      );
    },

    async resetAll(userId: string) {
      await pool.query(
        'UPDATE notification_counts SET unread_updates = 0, updated_at = NOW() WHERE user_id = $1',
        [userId],
      );
    },
  };

  return { deviceTokens, notificationPrefs, notificationLog, notificationCounts };
}
