// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Role-based access control store.
 * Provides methods for querying and managing user roles.
 *
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Object} - Role store methods
 */
function createRolesStore(pool, { nodeEnv } = {}) {
  // In-memory role cache: userId → Set of role names
  // Invalidated on grant/revoke. TTL-based staleness via timestamp.
  const roleCache = new Map();
  const CACHE_TTL = nodeEnv === 'test' ? 0 : 5 * 60 * 1000; // 0 in test, 5 minutes in prod

  function invalidateCache(userId) {
    roleCache.delete(userId);
  }

  function invalidateAllCaches() {
    roleCache.clear();
  }

  return {
    /**
     * Get all role names for a user.
     * @param {string} userId
     * @returns {Promise<string[]>} - Array of role names (e.g. ['user', 'admin'])
     */
    async getUserRoles(userId) {
      const cached = roleCache.get(userId);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.roles;
      }

      const result = await pool.query(`
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
        ORDER BY r.name
      `, [userId]);

      const roles = result.rows.map((row) => row.name);
      roleCache.set(userId, { roles, ts: Date.now() });
      return roles;
    },

    /**
     * Check if a user has a specific role.
     * @param {string} userId
     * @param {string} roleName
     * @returns {Promise<boolean>}
     */
    async hasRole(userId, roleName) {
      const roles = await this.getUserRoles(userId);
      return roles.includes(roleName);
    },

    /**
     * Grant a role to a user.
     * @param {string} userId
     * @param {string} roleName
     * @param {string|null} grantedBy - user_id of granter (null for system)
     */
    async grantRole(userId, roleName, grantedBy = null) {
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
     * @param {string} userId
     * @param {string} roleName
     */
    async revokeRole(userId, roleName) {
      await pool.query(`
        DELETE FROM user_roles
        WHERE user_id = $1
          AND role_id = (SELECT id FROM roles WHERE name = $2)
      `, [userId, roleName]);
      invalidateCache(userId);
    },

    /**
     * List all available roles.
     * @returns {Promise<Array>}
     */
    async listRoles() {
      const result = await pool.query(`
        SELECT id, name, description, created_at AS "createdAt"
        FROM roles ORDER BY id
      `);
      return result.rows;
    },

    /**
     * Get all users who have a specific role.
     * @param {string} roleName
     * @returns {Promise<Array>}
     */
    async getUsersByRole(roleName) {
      const result = await pool.query(`
        SELECT u.id, u.username, ur.granted_at AS "grantedAt", ur.granted_by AS "grantedBy"
        FROM user_roles ur
        JOIN users u ON u.id = ur.user_id
        JOIN roles r ON r.id = ur.role_id
        WHERE r.name = $1 AND u.deleted_at IS NULL
        ORDER BY ur.granted_at
      `, [roleName]);
      return result.rows;
    },

    invalidateCache,
    invalidateAllCaches,
  };
}

module.exports = createRolesStore;
