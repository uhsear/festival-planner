import type { Pool } from 'pg';
import { parseJsonObject } from './connection';

/**
 * Create utility functions that will be shared across all stores
 * @param pool - PostgreSQL connection pool
 * @returns Utility functions
 */
export default function createUtils(pool: Pool) {
  // Convert PostgreSQL Date objects to ISO strings for consistent serialization
  function toISOString(value: any): any {
    if (!value) return value;
    return value instanceof Date ? value.toISOString() : String(value);
  }

  function mapProfileRow(row: any) {
    return {
      id: row.id,
      festivalId: row.festivalId,
      userId: row.userId,
      name: row.name,
      picks: parseJsonObject(row.picksJson, {}),
      notes: parseJsonObject(row.notesJson, {}),
      reminders: parseJsonObject(row.remindersJson, {}),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  /**
   * Build complete festival records in a single query using PostgreSQL
   * json_agg/json_build_object. Replaces the old 4-query waterfall pattern.
   * Returns all non-deleted festivals with stages, days, and sets nested.
   */
  async function buildFestivalRecords() {
    const result = await pool.query(`
      SELECT
        f.id,
        f.name,
        COALESCE(f.location, '') AS location,
        COALESCE(f.b2b_separator, 'b2b') AS "b2bSeparator",
        f.created_at AS "createdAt",
        f.updated_at AS "updatedAt",
        COALESCE(
          (SELECT json_agg(
            json_build_object('id', s.id, 'name', s.name, 'color', s.color)
            ORDER BY s.sort_order ASC
          )
          FROM festival_stages s WHERE s.festival_id = f.id),
          '[]'::json
        ) AS stages,
        COALESCE(
          (SELECT json_agg(day_with_sets ORDER BY day_with_sets."dayIndex" ASC)
           FROM (
             SELECT
               d.day_index AS "dayIndex",
               COALESCE(d.label, '') AS label,
               COALESCE(d.date, '') AS date,
               COALESCE(
                 (SELECT json_agg(
                   json_build_object(
                     'id', fs.id,
                     'artist', fs.artist,
                     'artists', COALESCE(fs.artists, '[]'::jsonb),
                     'stageId', fs.stage_id,
                     'startTime', fs.start_time,
                     'endTime', fs.end_time,
                     'linkUrl', fs.link_url
                   )
                   ORDER BY fs.sort_order ASC
                 )
                 FROM festival_sets fs
                 WHERE fs.festival_id = f.id AND fs.day_index = d.day_index),
                 '[]'::json
               ) AS sets
             FROM festival_days d
             WHERE d.festival_id = f.id
           ) day_with_sets
          ),
          '[]'::json
        ) AS days
      FROM festivals f
      WHERE f.deleted_at IS NULL
      ORDER BY f.created_at ASC, f.id ASC
    `);

    return result.rows;
  }

  function parseMessageRow(row: any) {
    let reactions: any = null;
    if (row.reactionsJson) {
      try { reactions = JSON.parse(row.reactionsJson); } catch { reactions = null; }
    }
    return {
      id: row.id,
      festivalId: row.festivalId,
      userId: row.userId || null,
      username: row.username,
      text: row.text,
      timestamp: row.timestamp,
      ...(row.sequence != null ? { sequence: row.sequence } : {}),
      ...(reactions && Object.keys(reactions).length > 0 ? { reactions } : {}),
    };
  }

  return {
    toISOString,
    mapProfileRow,
    buildFestivalRecords,
    parseMessageRow,
  };
}
