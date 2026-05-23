import type { Pool } from 'pg';
import { withTransaction } from '../connection';

/**
 * Build a multi-row VALUES clause with parameterized placeholders.
 * @param rows - Array of row arrays, each with the same column count
 * @param startIdx - Starting $N index (1-based)
 * @returns { clause, params }
 */
function buildMultiInsert(rows: any[][], startIdx: number = 1): { clause: string; params: any[] } {
  const params: any[] = [];
  let idx = startIdx;
  const tuples = rows.map((row) => {
    const placeholders = row.map((val) => {
      params.push(val);
      return `$${idx++}`;
    });
    return `(${placeholders.join(',')})`;
  });
  return { clause: tuples.join(','), params };
}

/**
 * Collect stages, days, and sets from a festival into flat row arrays
 * ready for batch INSERT. Returns { stageRows, dayRows, setRows, newSetIds, setIdentityMap }.
 */
function collectFestivalChildren(festivalId: string, festival: any) {
  const stageRows = (festival.stages || []).map((stage: any, sortOrder: number) =>
    [festivalId, stage.id, stage.name, stage.color, sortOrder],
  );

  const dayRows: any[][] = [];
  const setRows: any[][] = [];
  const newSetIds = new Set<string>();
  const setIdentityMap = new Map<string, string>();

  for (const [dayIndex, day] of (festival.days || []).entries()) {
    dayRows.push([festivalId, dayIndex, day.label || '', day.date || '']);

    for (const [sortOrder, set] of (day.sets || []).entries()) {
      setRows.push([
        set.id, festivalId, dayIndex, set.artist, set.stageId,
        set.startTime, set.endTime, sortOrder,
        set.linkUrl || null, JSON.stringify(set.artists || []),
      ]);
      newSetIds.add(set.id);
      const key = `${set.artist}|${set.startTime}`;
      setIdentityMap.set(key, set.id);
    }
  }

  return { stageRows, dayRows, setRows, newSetIds, setIdentityMap };
}

/** Batch-insert stages in a single multi-row query. */
async function insertStagesBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ${clause}`,
    params,
  );
}

/** Batch-insert days in a single multi-row query. */
async function insertDaysBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ${clause}`,
    params,
  );
}

/** Batch-insert sets in a single multi-row query. */
async function insertSetsBatch(client: any, rows: any[][]) {
  if (rows.length === 0) return;
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, link_url, artists) VALUES ${clause}`,
    params,
  );
}

/** Batch-restore picks that still map to surviving set IDs. */
async function restorePicksBatch(client: any, pickRows: any[], newSetIds: Set<string>) {
  const surviving = pickRows.filter((p: any) => newSetIds.has(p.set_id));
  if (surviving.length === 0) return;
  const rows = surviving.map((p: any) => [p.profile_id, p.set_id, p.priority]);
  const { clause, params } = buildMultiInsert(rows);
  await client.query(
    `INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ${clause} ON CONFLICT DO NOTHING`,
    params,
  );
}

/** Batch-restore ratings mapped to new set IDs by (artist, start_time). */
async function restoreRatingsBatch(client: any, ratingRows: any[], setIdentityMap: Map<string, string>) {
  const mapped: any[][] = [];
  for (const r of ratingRows) {
    const key = `${r.artist}|${r.start_time}`;
    const newSetId = setIdentityMap.get(key);
    if (newSetId) {
      mapped.push([r.user_id, newSetId, r.rating, r.note, r.created_at, r.updated_at]);
    }
  }
  if (mapped.length === 0) return;
  const { clause, params } = buildMultiInsert(mapped);
  await client.query(
    `INSERT INTO set_ratings (user_id, set_id, rating, note, created_at, updated_at) VALUES ${clause} ON CONFLICT (user_id, set_id) DO NOTHING`,
    params,
  );
}

/**
 * Preserve picks and ratings, delete old child rows, batch-insert new
 * days/sets, then restore picks and ratings. Used by replaceAll and update.
 */
async function replaceChildRows(client: any, festivalId: string, children: any) {
  const { dayRows, setRows, newSetIds, setIdentityMap } = children;

  // Preserve picks before deleting sets
  const existingPicks = await client.query(
    `
  SELECT
    p.profile_id,
    p.set_id,
    p.priority
  FROM
    festival_profile_picks p
    JOIN festival_sets s ON s.id = p.set_id
  WHERE
    s.festival_id = $1
`,
    [festivalId],
  );

  // Preserve ratings before deleting sets
  const existingRatings = await client.query(
    `
  SELECT
    r.user_id,
    r.rating,
    r.note,
    r.created_at,
    r.updated_at,
    s.artist,
    s.start_time
  FROM
    set_ratings r
    JOIN festival_sets s ON s.id = r.set_id
  WHERE
    s.festival_id = $1
`,
    [festivalId],
  );

  await client.query(
    `
  DELETE FROM set_ratings
  WHERE
    set_id IN (
      SELECT
        id
      FROM
        festival_sets
      WHERE
        festival_id = $1
    )
`,
    [festivalId],
  );
  await client.query(
    `
  DELETE FROM festival_profile_picks
  WHERE
    set_id IN (
      SELECT
        id
      FROM
        festival_sets
      WHERE
        festival_id = $1
    )
`,
    [festivalId],
  );
  await client.query('DELETE FROM festival_sets WHERE festival_id = $1', [festivalId]);
  await client.query('DELETE FROM festival_days WHERE festival_id = $1', [festivalId]);

  // Batch insert days and sets
  await insertDaysBatch(client, dayRows);
  await insertSetsBatch(client, setRows);

  // Restore picks and ratings
  await restorePicksBatch(client, existingPicks.rows, newSetIds);
  await restoreRatingsBatch(client, existingRatings.rows, setIdentityMap);
}

export default function createFestivalsStore(pool: Pool, utils: any) {
  const { buildFestivalRecords } = utils;

  const festivals = {
    async readAll() {
      return buildFestivalRecords();
    },

    async replaceAll(nextFestivals: any[]) {
      return withTransaction(pool, async (client) => {
        if (nextFestivals.length === 0) {
          await client.query('DELETE FROM festivals');
          return;
        }

        const festivalIds = nextFestivals.map((festival: any) => festival.id);
        await client.query(
          `DELETE FROM festivals WHERE id NOT IN (${festivalIds.map((_: any, i: number) => `$${i + 1}`).join(',')})`,
          festivalIds,
        );

        for (const festival of nextFestivals) {
          const createdAt = festival.createdAt || new Date().toISOString();
          const updatedAt = festival.updatedAt || createdAt;

          await client.query(`
            INSERT INTO festivals (id, name, location, created_at, updated_at, b2b_separator, latitude, longitude)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT(id) DO UPDATE SET
              name = EXCLUDED.name,
              location = EXCLUDED.location,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              b2b_separator = EXCLUDED.b2b_separator,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude
          `, [festival.id, festival.name, festival.location || '', createdAt, updatedAt, festival.b2bSeparator || 'b2b', festival.latitude || null, festival.longitude || null]);

          // Delete old stages and batch-insert new ones
          await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festival.id]);
          const children = collectFestivalChildren(festival.id, festival);
          await insertStagesBatch(client, children.stageRows);

          // Replace days, sets, picks, and ratings in batch
          await replaceChildRows(client, festival.id, children);
        }
      });
    },

    async softDelete(festivalId: string) {
      await pool.query(
        'UPDATE festivals SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [festivalId],
      );
    },

    async restore(festivalId: string) {
      await pool.query(
        'UPDATE festivals SET deleted_at = NULL WHERE id = $1',
        [festivalId],
      );
    },

    async getById(festivalId: string) {
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
        WHERE f.id = $1 AND f.deleted_at IS NULL
      `, [festivalId]);
      return result.rows[0] || null;
    },

    async hardDelete(festivalId: string) {
      return withTransaction(pool, async (client) => {
        // Child rows of festival_sets (FK RESTRICT — must delete before sets)
        await client.query('DELETE FROM set_ratings WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)', [festivalId]);
        await client.query('DELETE FROM festival_profile_picks WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)', [festivalId]);
        await client.query('DELETE FROM festival_profile_notes WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)', [festivalId]);
        // Festival child tables
        await client.query('DELETE FROM festival_sets WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festival_days WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festival_profiles WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM calendar_tokens WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM notification_counts WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM notification_topic_subs WHERE festival_id = $1', [festivalId]);
        await client.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      });
    },

    async insertSets(festivalId: string, sets: any[]) {
      if (!sets || sets.length === 0) return;
      const rows = sets.map((set: any, sortOrder: number) => [
        set.id, festivalId, set.dayIndex, set.artist, set.stageId,
        set.startTime, set.endTime, set.sortOrder ?? sortOrder,
        set.linkUrl || null, JSON.stringify(set.artists || []),
      ]);
      await insertSetsBatch({ query: (sql: string, params: any[]) => pool.query(sql, params) }, rows);
    },

    async create(festival: any) {
      // Insert festival with stages, days, sets (wrapped in transaction for consistency)
      return withTransaction(pool, async (client) => {
        const createdAt = festival.createdAt || new Date().toISOString();
        const updatedAt = festival.updatedAt || createdAt;

        await client.query(
          'INSERT INTO festivals (id, name, location, created_at, updated_at, b2b_separator, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [festival.id, festival.name, festival.location || '', createdAt, updatedAt, festival.b2bSeparator || 'b2b', festival.latitude || null, festival.longitude || null],
        );

        // Batch insert stages, days, and sets
        const { stageRows, dayRows, setRows } = collectFestivalChildren(festival.id, festival);
        await insertStagesBatch(client, stageRows);
        await insertDaysBatch(client, dayRows);
        await insertSetsBatch(client, setRows);

        const result = await client.query(`
          SELECT
            id,
            name,
            location,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM
            festivals
          WHERE
            id = $1
            AND deleted_at IS NULL
        `, [festival.id]);
        return result.rows[0] || null;
      });
    },

    async update(festivalId: string, fields: any) {
      // fields: name, location, stages, days (wrapped in transaction for consistency)
      return withTransaction(pool, async (client) => {
        const sets: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (fields.name !== undefined) { sets.push(`name = $${idx}`); values.push(fields.name); idx++; }
        if (fields.location !== undefined) { sets.push(`location = $${idx}`); values.push(fields.location); idx++; }
        if (fields.b2bSeparator !== undefined) { sets.push(`b2b_separator = $${idx}`); values.push(fields.b2bSeparator); idx++; }
        if (fields.latitude !== undefined) { sets.push(`latitude = $${idx}`); values.push(fields.latitude); idx++; }
        if (fields.longitude !== undefined) { sets.push(`longitude = $${idx}`); values.push(fields.longitude); idx++; }
        sets.push(`updated_at = $${idx}`); values.push(new Date().toISOString()); idx++;
        values.push(festivalId);

        await client.query(`UPDATE festivals SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`, values);

        // Update stages if provided (batch insert)
        if (fields.stages !== undefined) {
          await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festivalId]);
          const stageRows = (fields.stages || []).map((stage: any, sortOrder: number) =>
            [festivalId, stage.id, stage.name, stage.color, sortOrder],
          );
          await insertStagesBatch(client, stageRows);
        }

        // Update days and sets if provided (batch insert with pick/rating preservation)
        if (fields.days !== undefined) {
          const children = collectFestivalChildren(festivalId, { days: fields.days });
          await replaceChildRows(client, festivalId, children);
        }

        const result = await client.query(`
          SELECT
            id,
            name,
            location,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM
            festivals
          WHERE
            id = $1
            AND deleted_at IS NULL
        `, [festivalId]);
        return result.rows[0] || null;
      });
    },
  };

  return festivals;
}
