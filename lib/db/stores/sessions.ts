import type { Pool } from 'pg';
import { withTransaction } from '../connection';

export default function createSessionsStore(pool: Pool, _utils: any) {
  const sessions: any = {
    async createUserSession({ token, userId, username, createdAt, lastAccess, maxPerUser }: any) {
      return withTransaction(pool, async (client) => {
        await client.query(`
          INSERT INTO
            user_sessions (token, user_id, username, created_at, last_access)
          VALUES
            ($1, $2, $3, $4, $5)
        `, [token, userId, username, createdAt, lastAccess]);

        // FOR UPDATE locks rows to prevent concurrent session creation from racing on eviction count
        const sessionsResult = await client.query(
          'SELECT token FROM user_sessions WHERE user_id = $1 ORDER BY last_access ASC, token ASC FOR UPDATE',
          [userId],
        );
        const sessionTokens = sessionsResult.rows;
        const overflow = Math.max(0, sessionTokens.length - maxPerUser);
        const evictedTokens = sessionTokens.slice(0, overflow).map((session: any) => session.token);

        if (evictedTokens.length > 0) {
          const placeholders = evictedTokens.map((_: any, i: number) => `$${i + 1}`).join(',');
          await client.query(`DELETE FROM user_sessions WHERE token IN (${placeholders})`, evictedTokens);
        }

        return evictedTokens;
      });
    },

    async validateUserSession(token: string, sessionTtlMs: number) {
      const result = await pool.query(`
        SELECT
          token,
          user_id AS "userId",
          username,
          created_at AS "createdAt",
          last_access AS "lastAccess"
        FROM
          user_sessions
        WHERE
          token = $1
      `, [token]);

      const session = result.rows[0];
      if (!session) return null;

      const now = new Date();
      const createdAt = new Date(session.createdAt);
      if ((now as any) - (createdAt as any) > sessionTtlMs) {
        await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]);
        return null;
      }

      // Only update lastAccess if >60s has elapsed to reduce write pressure
      const lastAccess = new Date(session.lastAccess);
      if ((now as any) - (lastAccess as any) > 60_000) {
        await pool.query('UPDATE user_sessions SET last_access = $1 WHERE token = $2', [now, token]);
        return { ...session, lastAccess: now };
      }

      return session;
    },

    async listUserSessions(userId: string) {
      const result = await pool.query(`
        SELECT
          token,
          user_id AS "userId",
          username,
          created_at AS "createdAt",
          last_access AS "lastAccess"
        FROM
          user_sessions
        WHERE
          user_id = $1
        ORDER BY
          last_access ASC,
          token ASC
      `, [userId]);
      return result.rows;
    },

    async deleteUserSession(token: string) {
      await pool.query('DELETE FROM user_sessions WHERE token = $1', [token]);
    },

    async deleteUserSessions(userId: string, exceptToken: string | null = null) {
      let result;
      if (exceptToken) {
        result = await pool.query(
          'SELECT token FROM user_sessions WHERE user_id = $1 AND token <> $2 ORDER BY last_access ASC, token ASC',
          [userId, exceptToken],
        );
      } else {
        result = await pool.query(
          'SELECT token FROM user_sessions WHERE user_id = $1 ORDER BY last_access ASC, token ASC',
          [userId],
        );
      }
      const current = result.rows.map((session: any) => session.token);

      if (current.length > 0) {
        const placeholders = current.map((_: any, i: number) => `$${i + 1}`).join(',');
        await pool.query(`DELETE FROM user_sessions WHERE token IN (${placeholders})`, current);
      }

      return current;
    },

    async deleteExpiredUserSessions(sessionTtlMs: number) {
      const threshold = new Date(Date.now() - sessionTtlMs);
      const result = await pool.query(
        'DELETE FROM user_sessions WHERE created_at <= $1 RETURNING token',
        [threshold],
      );
      return result.rows.map((row: any) => row.token);
    },





    async counts() {
      const userResult = await pool.query('SELECT COUNT(*) AS count FROM user_sessions');
      return {
        userSessions: parseInt(userResult.rows[0].count, 10),
      };
    },
  };

  // ── Refresh Tokens (90-day, rotation) ────────────────────────────
  const refreshTokens = {
    async create({ token, userId, sessionToken, expiresAt }: any) {
      await pool.query(
        'INSERT INTO refresh_tokens (token, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)',
        [token, userId, sessionToken, expiresAt],
      );
    },
    async validate(token: string) {
      const result = await pool.query(
        'SELECT token, user_id AS "userId", session_token AS "sessionToken", created_at AS "createdAt", expires_at AS "expiresAt", revoked FROM refresh_tokens WHERE token = $1',
        [token],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.revoked || new Date() > new Date(row.expiresAt)) {
        await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
        return null;
      }
      return row;
    },
    async rotate(oldToken: string, newToken: string, newSessionToken: string, expiresAt: any) {
      return withTransaction(pool, async (client) => {
        const old = await client.query('SELECT user_id FROM refresh_tokens WHERE token = $1', [oldToken]);
        if (!old.rows[0]) throw new Error('Old refresh token not found');
        const userId = old.rows[0].user_id;
        await client.query('UPDATE refresh_tokens SET revoked = TRUE, rotated_at = $1 WHERE token = $2', [new Date(), oldToken]);
        await client.query(
          'INSERT INTO refresh_tokens (token, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)',
          [newToken, userId, newSessionToken, expiresAt],
        );
      });
    },
    async revokeAll(userId: string) {
      await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE', [userId]);
    },
    async deleteExpired() {
      await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = TRUE');
    },
  };

  // ── Login Failure Tracking ───────────────────────────────────────
  const loginFailures = {
    async record(userId: string) {
      await pool.query(`
        INSERT INTO login_failures (user_id, consecutive_failures, last_failure_at)
        VALUES ($1, 1, $2)
        ON CONFLICT (user_id) DO UPDATE SET
          consecutive_failures = login_failures.consecutive_failures + 1,
          last_failure_at = $2
      `, [userId, new Date()]);
    },
    async reset(userId: string) {
      await pool.query('DELETE FROM login_failures WHERE user_id = $1', [userId]);
    },
    async get(userId: string) {
      const result = await pool.query(
        'SELECT consecutive_failures AS "consecutiveFailures", last_failure_at AS "lastFailureAt", locked_until AS "lockedUntil" FROM login_failures WHERE user_id = $1',
        [userId],
      );
      return result.rows[0] || null;
    },
    async lock(userId: string, lockedUntil: any) {
      await pool.query('UPDATE login_failures SET locked_until = $1 WHERE user_id = $2', [lockedUntil, userId]);
    },
  };

  // ── Metrics Rollups ──────────────────────────────────────────────
  const metricsRollups = {
    async insert(rollup: any) {
      await pool.query(`
        INSERT INTO
          metrics_rollups (
            bucket_start,
            bucket_end,
            total_requests,
            total_errors,
            avg_duration_ms,
            status_2xx,
            status_4xx,
            status_5xx,
            peak_connections,
            active_users
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [rollup.bucketStart, rollup.bucketEnd, rollup.totalRequests, rollup.totalErrors, rollup.avgDurationMs, rollup.status2xx, rollup.status4xx, rollup.status5xx, rollup.peakConnections, rollup.activeUsers]);
    },
    async query(since: any, until: any, limit: number = 168) {
      const result = await pool.query(
        `
  SELECT
    id,
    bucket_start,
    bucket_end,
    total_requests,
    total_errors,
    avg_duration_ms,
    p95_duration_ms,
    status_2xx,
    status_4xx,
    status_5xx,
    peak_connections,
    active_users,
    created_at
  FROM
    metrics_rollups
  WHERE
    bucket_start >= $1
    AND bucket_start < $2
  ORDER BY
    bucket_start DESC
  LIMIT
    $3
`,
        [since, until, limit],
      );
      return result.rows;
    },
  };

  sessions.refreshTokens = refreshTokens;
  sessions.loginFailures = loginFailures;
  sessions.metricsRollups = metricsRollups;

  return sessions;
}
