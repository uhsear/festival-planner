// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { Pool } from 'pg';

/**
 * Role-based access control store.
 * Provides methods for querying and managing user roles.
 */
export default function createRolesStore(pool: Pool, { nodeEnv }: { nodeEnv?: string } = {}) {
  // In-memory role cache: userId → Set of role names
  // Invalidated on grant/revoke. TTL-based staleness via timestamp.
  const roleCache = new Map<string, { roles: string[]; ts: number }>();
  const CACHE_TTL = nodeEnv === 'test' ? 0 : 5 * 60 * 1000; // 0 in test, 5 minutes in prod

  function invalidateCache(userId: string) {
    roleCache.delete(userId);
  }

  function invalidateAllCaches() {
    roleCache.clear();
  }

  return {
    /**
     * Get all role names for a user.
     */
    async getUserRoles(userId: string) {
      const cached = roleCache.get(userId);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.roles;
      }

      const result = await pool.query(`
        SELECT
          r.name
        FROM
          user_roles ur
          JOIN roles r ON r.id = ur.role_id
        WHERE
          ur.user_id = $1
        ORDER BY
          r.name
      `, [userId]);

      const roles = result.rows.map((row: any) => row.name);
      if (roleCache.size >= 10_000) {
        const oldest = roleCache.keys().next().value;
        if (oldest !== undefined) roleCache.delete(oldest);
      }
      roleCache.set(userId, { roles, ts: Date.now() });
      return roles;
    },

    /**
     * Check if a user has a specific role.
     */
    async hasRole(userId: string, roleName: string) {
      const roles = await this.getUserRoles(userId);
      return roles.includes(roleName);
    },

    /**
     * Grant a role to a user.
     */
    async grantRole(userId: string, roleName: string, grantedBy: string | null = null) {
      await pool.query(`
        INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
        SELECT $1, r.id, $3, NOW()
        FROM roles r WHERE r.name = $2
        ON CONFLICT (user_id, role_id) DO NOTHING
      `, [userId, roleName, grantedBy]);
      invalidateCache(userId);
    },

    /**
     * Revoke a role from a user.
     */
    async revokeRole(userId: string, roleName: string) {
      await pool.query(`
        DELETE FROM user_roles
        WHERE
          user_id = $1
          AND role_id = (
            SELECT
              id
            FROM
              roles
            WHERE
              name = $2
          )
      `, [userId, roleName]);
      invalidateCache(userId);
    },

    /**
     * List all available roles.
     */
    async listRoles() {
      const result = await pool.query(`
        SELECT
          id,
          name,
          description,
          created_at AS "createdAt"
        FROM
          roles
        ORDER BY
          id
      `);
      return result.rows;
    },

    /**
     * Get all users who have a specific role.
     */
    async getUsersByRole(roleName: string) {
      const result = await pool.query(`
        SELECT
          u.id,
          u.username,
          ur.granted_at AS "grantedAt",
          ur.granted_by AS "grantedBy"
        FROM
          user_roles ur
          JOIN users u ON u.id = ur.user_id
          JOIN roles r ON r.id = ur.role_id
        WHERE
          r.name = $1
          AND u.deleted_at IS NULL
        ORDER BY
          ur.granted_at
      `, [roleName]);
      return result.rows;
    },

    async getUserRolesBatch(userIds: string[]) {
      if (userIds.length === 0) return new Map();
      const result = await pool.query(`
        SELECT
          ur.user_id,
          r.name
        FROM
          user_roles ur
          JOIN roles r ON r.id = ur.role_id
        WHERE
          ur.user_id = ANY ($1)
        ORDER BY
          r.name
      `, [userIds]);
      const map = new Map<string, string[]>();
      for (const row of result.rows) {
        if (!map.has(row.user_id)) map.set(row.user_id, []);
        map.get(row.user_id)!.push(row.name);
      }
      for (const uid of userIds) {
        if (!map.has(uid)) map.set(uid, []);
      }
      return map;
    },

    invalidateCache,
    invalidateAllCaches,
  };
}
