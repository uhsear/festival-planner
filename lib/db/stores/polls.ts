import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

// Safe JSON parse — returns fallback on any error
function safeParseJson(value: any, fallback: any) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export default function createPollsStore(pool: Pool, _utils: any) {
  return {
    async create({ crewId, createdBy, question, options, closesAt }: any) {
      const id = 'poll-' + randomUUID();
      const result = await pool.query(
        `
        INSERT INTO crew_polls (id, crew_id, created_by, question, options, closes_at, closed, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW())
        RETURNING id, crew_id, created_by, question, options, closes_at, closed, created_at
      `,
        [id, crewId, createdBy, question, JSON.stringify(options), closesAt],
      );
      return result.rows[0];
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          p.*,
          COUNT(DISTINCT v.user_id) as vote_count,
          json_agg(json_build_object('option', v.option_index, 'user_id', v.user_id)) as votes
        FROM crew_polls p
        LEFT JOIN crew_poll_votes v ON p.id = v.poll_id
        WHERE p.crew_id = $1 AND p.closed = FALSE AND (p.closes_at IS NULL OR p.closes_at > NOW())
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `,
        [crewId],
      );
      return result.rows.map((row: any) => ({
        ...row,
        options: Array.isArray(row.options) ? row.options : safeParseJson(row.options, []),
        votes: Array.isArray(row.votes) ? row.votes : safeParseJson(row.votes, []),
      }));
    },

    async vote(pollId: string, userId: string, optionIndex: number) {
      const result = await pool.query(
        `
        INSERT INTO crew_poll_votes (poll_id, user_id, option_index, voted_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (poll_id, user_id)
        DO UPDATE SET option_index = $3
        RETURNING poll_id, user_id, option_index, voted_at
      `,
        [pollId, userId, optionIndex],
      );
      return result.rows[0];
    },

    async getResults(pollId: string) {
      const result = await pool.query(
        `
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
      `,
        [pollId],
      );

      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        ...row,
        options: Array.isArray(row.options) ? row.options : safeParseJson(row.options, []),
        votes: Array.isArray(row.votes) ? row.votes : safeParseJson(row.votes, []),
      };
    },

    async close(pollId: string) {
      const result = await pool.query(
        'UPDATE crew_polls SET closed = TRUE WHERE id = $1 RETURNING id, crew_id, created_by, question, options, closes_at, closed, created_at',
        [pollId],
      );
      return result.rows[0];
    },

    async countActiveByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          COUNT(*) as count
        FROM
          crew_polls
        WHERE
          crew_id = $1
          AND closed = FALSE
      `,
        [crewId],
      );
      return result.rows[0]?.count ?? 0;
    },

    async getById(pollId: string) {
      const result = await pool.query(
        `
  SELECT
    id,
    crew_id,
    created_by,
    question,
    options,
    closes_at,
    closed,
    created_at
  FROM
    crew_polls
  WHERE
    id = $1
`,
        [pollId],
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        ...row,
        options: Array.isArray(row.options) ? row.options : safeParseJson(row.options, []),
      };
    },
  };
}
