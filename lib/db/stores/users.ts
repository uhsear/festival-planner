// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { Pool } from 'pg';
import { withTransaction } from '../connection';

export default function createUsersStore(pool: Pool, utils: any) {
  const { toISOString } = utils;

  const COLUMN_MAP: Record<string, string> = {
    username: 'username',
    displayName: 'display_name',
    email: 'email',
    passwordHash: 'password_hash',
    avatarKey: 'avatar_key',
    avatarVersion: 'avatar_version',
    avatarUpdatedAt: 'avatar_updated_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    tosAcceptedAt: 'tos_accepted_at',
    tosVersion: 'tos_version',
    emailVerifiedAt: 'email_verified_at',
    venmoHandle: 'venmo_handle',
    cashappCashtag: 'cashapp_cashtag',
    paypalHandle: 'paypal_handle',
  };

  const ALLOWED_UPDATE_KEYS = new Set([...Object.keys(COLUMN_MAP), ...Object.values(COLUMN_MAP)]);

  function toColumn(key: string): string {
    if (!ALLOWED_UPDATE_KEYS.has(key)) throw new Error(`Invalid column key: ${key}`);
    return COLUMN_MAP[key] || key;
  }

  const USER_COLUMNS = `
    id, username, email,
    display_name AS "displayName",
    password_hash AS "passwordHash",
    avatar_key AS "avatarKey",
    avatar_version AS "avatarVersion",
    avatar_updated_at AS "avatarUpdatedAt",
    tos_accepted_at AS "tosAcceptedAt",
    tos_version AS "tosVersion",
    email_verified_at AS "emailVerifiedAt",
    venmo_handle AS "venmoHandle",
    cashapp_cashtag AS "cashappCashtag",
    paypal_handle AS "paypalHandle",
    date_of_birth AS "dateOfBirth",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    deleted_at AS "deletedAt"
  `;

  function normalizeRow(row: any) {
    if (!row) return null;
    return {
      ...row,
      displayName: row.displayName || null,
      avatarKey: row.avatarKey || null,
      avatarVersion: row.avatarVersion || null,
      avatarUpdatedAt: toISOString(row.avatarUpdatedAt) || null,
      tosAcceptedAt: toISOString(row.tosAcceptedAt) || null,
      tosVersion: row.tosVersion || null,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt) || null,
      deletedAt: toISOString(row.deletedAt) || null,
      email: row.email || null,
      emailVerifiedAt: toISOString(row.emailVerifiedAt) || null,
      venmoHandle: row.venmoHandle || null,
      cashappCashtag: row.cashappCashtag || null,
      paypalHandle: row.paypalHandle || null,
      dateOfBirth: row.dateOfBirth || null,
    };
  }

  const users: any = {
    async readAll() {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
      );
      return result.rows.map(normalizeRow);
    },

    async replaceAll(nextUsers: any[]) {
      return withTransaction(pool, async (client) => {
        if (nextUsers.length === 0) {
          await client.query('UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL');
          return;
        }

        const userIds = nextUsers.map((user: any) => user.id);
        await client.query(
          `UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL AND id NOT IN (${userIds.map((_: any, i: number) => `$${i + 1}`).join(',')})`,
          userIds,
        );

        for (const user of nextUsers) {
          const createdAt = user.createdAt || new Date().toISOString();
          await client.query(
            `
            INSERT INTO users (id, username, password_hash, avatar_key, avatar_version, avatar_updated_at, tos_accepted_at, tos_version, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT(id) DO UPDATE SET
              username = EXCLUDED.username,
              password_hash = EXCLUDED.password_hash,
              avatar_key = EXCLUDED.avatar_key,
              avatar_version = EXCLUDED.avatar_version,
              avatar_updated_at = EXCLUDED.avatar_updated_at,
              tos_accepted_at = EXCLUDED.tos_accepted_at,
              tos_version = EXCLUDED.tos_version,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              deleted_at = NULL
          `,
            [
              user.id,
              user.username,
              user.passwordHash,
              user.avatarKey || null,
              user.avatarVersion || null,
              user.avatarUpdatedAt || null,
              user.tosAcceptedAt || null,
              user.tosVersion || null,
              createdAt,
              user.updatedAt || createdAt,
            ],
          );
        }
      });
    },

    async getById(userId: string) {
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [
        userId,
      ]);
      return normalizeRow(result.rows[0]);
    },

    async getByIds(userIds: string[]) {
      if (!userIds || userIds.length === 0) return new Map();
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1) AND deleted_at IS NULL`, [
        userIds,
      ]);
      const map = new Map();
      for (const row of result.rows) {
        map.set(row.id, normalizeRow(row));
      }
      return map;
    },

    async getByUsername(username: string) {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
        [username],
      );
      return normalizeRow(result.rows[0]);
    },

    findByUsername: (...args: any[]) => users.getByUsername(...args),

    async softDelete(userId: string, { deletedBy, reason }: { deletedBy?: string; reason?: string } = {}) {
      await pool.query(
        'UPDATE users SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL',
        [userId, deletedBy || null, reason || null],
      );
    },

    async purgeDeleted(daysOld: any) {
      const days = Math.max(0, parseInt(daysOld, 10));
      if (isNaN(days)) return;
      await pool.query(
        `DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '1 day' * $1`,
        [days],
      );
    },

    async create({ id, username, passwordHash, email, dateOfBirth, createdAt, tosAcceptedAt, tosVersion }: any) {
      await pool.query(
        'INSERT INTO users (id, username, password_hash, email, date_of_birth, created_at, tos_accepted_at, tos_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          id,
          username,
          passwordHash,
          email || null,
          dateOfBirth || null,
          createdAt || new Date().toISOString(),
          tosAcceptedAt || null,
          tosVersion || null,
        ],
      );
      return this.getById(id);
    },

    async update(userId: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        sets.push(`${toColumn(key)} = $${idx}`);
        values.push(val);
        idx++;
      }
      sets.push(`updated_at = $${idx}`);
      values.push(new Date().toISOString());
      idx++;
      values.push(userId);

      await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`, values);
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [
        userId,
      ]);
      return normalizeRow(result.rows[0]);
    },

    async delete(userId: string, { deletedBy, reason }: { deletedBy?: string; reason?: string } = {}) {
      const user = await this.getById(userId);
      if (!user) return null;
      await pool.query(
        'UPDATE users SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL',
        [userId, deletedBy || null, reason || null],
      );
      return user;
    },

    async hardDelete(userId: string) {
      // Migration 031 changed all user FKs from CASCADE to RESTRICT,
      // so we must delete child rows explicitly inside a transaction.
      return withTransaction(pool, async (client) => {
        await client.query('DELETE FROM set_ratings WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_topic_subs WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_log WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_counts WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM calendar_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM festival_profiles WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM crew_poll_votes WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM crew_polls WHERE created_by = $1', [userId]);
        await client.query('DELETE FROM crew_meeting_points WHERE created_by = $1', [userId]);
        await client.query('DELETE FROM crew_members WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM crew_expenses WHERE paid_by = $1', [userId]);
        await client.query('DELETE FROM crew_activity WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM login_failures WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);

        // Crews the user created are ON DELETE RESTRICT (migration 031, deliberate —
        // a user deletion must not silently destroy a crew that other members are in).
        // Transfer ownership to the longest-standing remaining member; delete the crew
        // only if the departing user was its sole member (crew_id children all cascade).
        // Runs before the user row is deleted so created_by no longer references it.
        const { rows: ownedCrews } = await client.query('SELECT id FROM crews WHERE created_by = $1', [
          userId,
        ]);
        for (const owned of ownedCrews) {
          const { rows: heirs } = await client.query(
            'SELECT user_id FROM crew_members WHERE crew_id = $1 AND user_id <> $2 ORDER BY joined_at ASC LIMIT 1',
            [owned.id, userId],
          );
          if (heirs[0]) {
            await client.query('UPDATE crews SET created_by = $1, updated_at = NOW() WHERE id = $2', [
              heirs[0].user_id,
              owned.id,
            ]);
            await client.query("UPDATE crew_members SET role = 'owner' WHERE crew_id = $1 AND user_id = $2", [
              owned.id,
              heirs[0].user_id,
            ]);
          } else {
            await client.query('DELETE FROM crews WHERE id = $1', [owned.id]);
          }
        }

        const { rows } = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
        return rows[0] ? normalizeRow(rows[0]) : null;
      });
    },

    async count() {
      const { rows } = await pool.query('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL');
      return parseInt(rows[0]?.count ?? 0, 10);
    },

    countActive: (...args: any[]) => users.count(...args),
  };

  return users;
}
