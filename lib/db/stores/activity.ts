import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

export function createActivityStore(pool: Pool) {
  return {
    async log({ crewId, userId, type, detail }: any) {
      const id = randomUUID();
      await pool.query(
        `
  INSERT INTO
    crew_activity (id, crew_id, user_id, type, detail, created_at)
  VALUES
    ($1, $2, $3, $4, $5, NOW())
`,
        [id, crewId, userId, type, detail || null]
      );
    },

    async getByCrew(crewId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [crewId, limit + 1];
      let cursorClause = '';
      if (cursor) {
        cursorClause = 'AND a.id < $3';
        params.push(cursor);
      }
      const { rows } = await pool.query(
        `SELECT a.id, a.crew_id, a.user_id, a.type, a.detail, a.created_at, u.username
         FROM crew_activity a
         JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
         WHERE a.crew_id = $1
         ${cursorClause}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $2`,
        params
      );
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();
      return {
        items: rows,
        nextCursor: hasMore ? rows[rows.length - 1].id : null,
      };
    },
  };
}
