'use strict';

function createCalendarTokensStore(pool) {
  return {
    async getOrCreate({ userId, festivalId, profileId }) {
      const id = require('crypto').randomUUID();
      // Upsert — return existing or create new
      const { rows } = await pool.query(
        `INSERT INTO calendar_tokens (id, user_id, festival_id, profile_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, festival_id) DO UPDATE SET profile_id = $4
         RETURNING id, user_id, festival_id, profile_id, created_at`,
        [id, userId, festivalId, profileId]
      );
      return rows[0];
    },

    async getByToken(tokenId) {
      const { rows } = await pool.query(
        `SELECT id, user_id, festival_id, profile_id, created_at
         FROM calendar_tokens WHERE id = $1`,
        [tokenId]
      );
      return rows[0] || null;
    },

    async deleteByUser(userId, festivalId) {
      await pool.query(
        'DELETE FROM calendar_tokens WHERE user_id = $1 AND festival_id = $2',
        [userId, festivalId]
      );
    },
  };
}

module.exports = { createCalendarTokensStore };
