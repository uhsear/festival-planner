'use strict';

function createActivityStore(pool) {
  return {
    async log({ crewId, userId, type, detail }) {
      const id = require('crypto').randomUUID();
      await pool.query(
        `INSERT INTO crew_activity (id, crew_id, user_id, type, detail, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [id, crewId, userId, type, detail || null]
      );
    },

    async getByCrew(crewId, limit = 50) {
      const { rows } = await pool.query(
        `SELECT a.*, u.username
         FROM crew_activity a
         JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
         WHERE a.crew_id = $1
         ORDER BY a.created_at DESC
         LIMIT $2`,
        [crewId, limit]
      );
      return rows;
    },
  };
}

module.exports = { createActivityStore };
