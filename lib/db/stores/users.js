// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const { withTransaction } = require('../connection');

function createUsersStore(pool, utils) {
  const { toISOString } = utils;

  const COLUMN_MAP = {
    username: 'username',
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
  };

  const ALLOWED_UPDATE_KEYS = new Set([...Object.keys(COLUMN_MAP), ...Object.values(COLUMN_MAP)]);

  function toColumn(key) {
    if (!ALLOWED_UPDATE_KEYS.has(key)) throw new Error(`Invalid column key: ${key}`);
    return COLUMN_MAP[key] || key;
  }

  const USER_COLUMNS = `
    id, username, email,
    password_hash AS "passwordHash",
    avatar_key AS "avatarKey",
    avatar_version AS "avatarVersion",
    avatar_updated_at AS "avatarUpdatedAt",
    tos_accepted_at AS "tosAcceptedAt",
    tos_version AS "tosVersion",
    email_verified_at AS "emailVerifiedAt",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    deleted_at AS "deletedAt"
  `;

  function normalizeRow(row) {
    if (!row) return null;
    return {
      ...row,
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
    };
  }

  const users = {
    async readAll() {
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC`);
      return result.rows.map(normalizeRow);
    },

    async replaceAll(nextUsers) {
      return withTransaction(pool, async (client) => {
        if (nextUsers.length === 0) {
          await client.query('UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL');
          return;
        }

        const userIds = nextUsers.map((user) => user.id);
        await client.query(
          `UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL AND id NOT IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`,
          userIds,
        );

        for (const user of nextUsers) {
          const createdAt = user.createdAt || new Date().toISOString();
          await client.query(`
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
          `, [
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
          ]);
        }
      });
    },

    async getById(userId) {
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
      return normalizeRow(result.rows[0]);
    },

    async getByIds(userIds) {
      if (!userIds || userIds.length === 0) return new Map();
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
        [userIds],
      );
      const map = new Map();
      for (const row of result.rows) {
        map.set(row.id, normalizeRow(row));
      }
      return map;
    },

    async getByUsername(username) {
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`, [username]);
      return normalizeRow(result.rows[0]);
    },

    async findByUsername(username) {
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`, [username]);
      return normalizeRow(result.rows[0]);
    },

    async softDelete(userId, { deletedBy, reason } = {}) {
      await pool.query(
        'UPDATE users SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL',
        [userId, deletedBy || null, reason || null],
      );
    },

    async purgeDeleted(daysOld) {
      const days = Math.max(0, parseInt(daysOld, 10));
      if (isNaN(days)) return;
      await pool.query(
        `DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '1 day' * $1`,
        [days],
      );
    },

    async create({ id, username, passwordHash, email, createdAt, tosAcceptedAt, tosVersion }) {
      await pool.query(
        'INSERT INTO users (id, username, password_hash, email, created_at, tos_accepted_at, tos_version) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, username, passwordHash, email || null, createdAt || new Date().toISOString(), tosAcceptedAt || null, tosVersion || null]
      );
      return this.getById(id);
    },

    async update(userId, fields) {
      const sets = [];
      const values = [];
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
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
      return normalizeRow(result.rows[0]);
    },

    async delete(userId, { deletedBy, reason } = {}) {
      const user = await this.getById(userId);
      if (!user) return null;
      await pool.query('UPDATE users SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL', [userId, deletedBy || null, reason || null]);
      return user;
    },

    async hardDelete(userId) {
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
        const { rows } = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
        return rows[0] ? normalizeRow(rows[0]) : null;
      });
    },

    async count() {
      const { rows } = await pool.query('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL');
      return parseInt(rows[0].count, 10);
    },
  };

  return users;
}

module.exports = createUsersStore;
