import type { Pool } from 'pg';

export function createRatingsStore(pool: Pool) {
  return {
    async upsert(userId: string, setId: string, rating: number, note: string = '') {
      const result = await pool.query(`
        INSERT INTO set_ratings (user_id, set_id, rating, note, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, set_id) DO UPDATE SET
          rating = EXCLUDED.rating,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING id, user_id AS "userId", set_id AS "setId", rating, note, created_at AS "createdAt", updated_at AS "updatedAt"
      `, [userId, setId, rating, note]);
      return result.rows[0];
    },

    async getByUser(userId: string, festivalId: string) {
      const result = await pool.query(`
        SELECT r.id, r.set_id AS "setId", r.rating, r.note,
               r.created_at AS "createdAt", r.updated_at AS "updatedAt",
               s.artist, s.stage_id AS "stageId", s.start_time AS "startTime", s.end_time AS "endTime",
               s.day_index AS "dayIndex"
        FROM set_ratings r
        JOIN festival_sets s ON s.id = r.set_id
        WHERE r.user_id = $1 AND s.festival_id = $2
        ORDER BY r.rating DESC, s.day_index, s.start_time
      `, [userId, festivalId]);
      return result.rows;
    },

    async getByFestival(festivalId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [festivalId, limit + 1];
      let having = '';
      if (cursor) {
        having = 'HAVING r.set_id > $3';
        params.push(cursor);
      }
      const result = await pool.query(`
        SELECT r.set_id AS "setId",
               COUNT(*)::int AS "totalRatings",
               ROUND(AVG(r.rating), 1)::float AS "avgRating",
               json_agg(json_build_object(
                 'userId', r.user_id, 'rating', r.rating, 'note', r.note
               ) ORDER BY r.rating DESC) AS ratings
        FROM set_ratings r
        JOIN festival_sets s ON s.id = r.set_id
        WHERE s.festival_id = $1
        GROUP BY r.set_id
        ${having}
        ORDER BY r.set_id ASC
        LIMIT $2
      `, params);
      const hasMore = result.rows.length > limit;
      if (hasMore) result.rows.pop();
      return {
        items: result.rows,
        nextCursor: hasMore ? result.rows[result.rows.length - 1].setId : null,
      };
    },

    async getCrewRatings(crewId: string, festivalId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [crewId, festivalId, limit + 1];
      let cursorClause = '';
      if (cursor) {
        cursorClause = 'AND r.id > $4';
        params.push(cursor);
      }
      const result = await pool.query(`
        SELECT r.id, r.set_id AS "setId", r.user_id AS "userId", r.rating, r.note,
               u.username, s.artist
        FROM set_ratings r
        JOIN festival_sets s ON s.id = r.set_id
        JOIN crew_members cm ON cm.user_id = r.user_id AND cm.crew_id = $1
        JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL
        WHERE s.festival_id = $2
        ${cursorClause}
        ORDER BY r.id ASC
        LIMIT $3
      `, params);
      const hasMore = result.rows.length > limit;
      if (hasMore) result.rows.pop();
      return {
        items: result.rows,
        nextCursor: hasMore ? result.rows[result.rows.length - 1].id : null,
      };
    },

    async delete(userId: string, setId: string) {
      await pool.query('DELETE FROM set_ratings WHERE user_id = $1 AND set_id = $2', [userId, setId]);
    },

    async getWrapStats(userId: string, festivalId: string) {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS "totalRated",
          ROUND(AVG(r.rating), 1)::float AS "avgRating",
          COUNT(DISTINCT s.stage_id)::int AS "stagesVisited",
          COUNT(DISTINCT s.day_index)::int AS "daysAttended",
          SUM(
            CASE WHEN s.start_time IS NOT NULL AND s.end_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0
            ELSE 0 END
          )::float AS "totalHours"
        FROM set_ratings r
        JOIN festival_sets s ON s.id = r.set_id
        WHERE r.user_id = $1 AND s.festival_id = $2
      `, [userId, festivalId]);
      return result.rows[0] || { totalRated: 0, avgRating: 0, stagesVisited: 0, daysAttended: 0, totalHours: 0 };
    },
  };
}
