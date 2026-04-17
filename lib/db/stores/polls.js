'use strict';

function createPollsStore(pool, _utils) {
  const { randomUUID } = require('crypto');

  return {
    async create({ crewId, createdBy, question, options, closesAt }) {
      const id = 'poll-' + randomUUID();
      const result = await pool.query(`
        INSERT INTO crew_polls (id, crew_id, created_by, question, options, closes_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [id, crewId, createdBy, question, JSON.stringify(options), closesAt]);
      return result.rows[0];
    },

    async listByCrew(crewId) {
      const result = await pool.query(`
        SELECT 
          p.*,
          COUNT(DISTINCT v.user_id) as vote_count,
          json_agg(json_build_object('option', v.option_index, 'user_id', v.user_id)) as votes
        FROM crew_polls p
        LEFT JOIN crew_poll_votes v ON p.id = v.poll_id
        WHERE p.crew_id = $1 AND p.closed = FALSE AND (p.closes_at IS NULL OR p.closes_at > NOW()) AND (p.closes_at IS NULL OR p.closes_at > NOW())
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `, [crewId]);
      return result.rows.map(row => ({
        ...row,
        options: Array.isArray(row.options) ? row.options : JSON.parse(row.options || '[]'),
        votes: Array.isArray(row.votes) ? row.votes : (row.votes ? JSON.parse(row.votes) : []),
      }));
    },

    async vote(pollId, userId, optionIndex) {
      const result = await pool.query(`
        INSERT INTO crew_poll_votes (poll_id, user_id, option_index)
        VALUES ($1, $2, $3)
        ON CONFLICT (poll_id, user_id)
        DO UPDATE SET option_index = $3
        RETURNING *
      `, [pollId, userId, optionIndex]);
      return result.rows[0];
    },

    async getResults(pollId) {
      const result = await pool.query(`
        SELECT 
          p.*,
          json_agg(json_build_object(
            'option_index', v.option_index,
            'user_id', u.id,
            'username', u.username
          )) FILTER (WHERE v.option_index IS NOT NULL) as votes
        FROM crew_polls p
        LEFT JOIN crew_poll_votes v ON p.id = v.poll_id
        LEFT JOIN users u ON v.user_id = u.id AND u.deleted_at IS NULL
        WHERE p.id = $1
        GROUP BY p.id
      `, [pollId]);
      
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        ...row,
        options: Array.isArray(row.options) ? row.options : JSON.parse(row.options || '[]'),
        votes: Array.isArray(row.votes) ? row.votes : (row.votes ? JSON.parse(row.votes) : []),
      };
    },

    async close(pollId) {
      const result = await pool.query(
        'UPDATE crew_polls SET closed = TRUE WHERE id = $1 RETURNING *',
        [pollId]
      );
      return result.rows[0];
    },

    async countActiveByCrew(crewId) {
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM crew_polls 
        WHERE crew_id = $1 AND closed = FALSE
      `, [crewId]);
      return result.rows[0].count;
    },

    async getById(pollId) {
      const result = await pool.query(
        'SELECT * FROM crew_polls WHERE id = $1',
        [pollId]
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        ...row,
        options: Array.isArray(row.options) ? row.options : JSON.parse(row.options || '[]'),
      };
    },
  };
}

module.exports = createPollsStore;

