'use strict';

const { withTransaction } = require('../connection');

function createFestivalsStore(pool, utils) {
  const { buildFestivalRecords } = utils;

  const festivals = {
    async readAll() {
      return buildFestivalRecords();
    },

    async replaceAll(nextFestivals) {
      return withTransaction(pool, async (client) => {
        if (nextFestivals.length === 0) {
          await client.query('DELETE FROM festivals');
          return;
        }

        const festivalIds = nextFestivals.map((festival) => festival.id);
        await client.query(
          `DELETE FROM festivals WHERE id NOT IN (${festivalIds.map((_, i) => `$${i + 1}`).join(',')})`,
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

          await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festival.id]);
          for (const [sortOrder, stage] of (festival.stages || []).entries()) {
            await client.query(`
              INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
              VALUES ($1, $2, $3, $4, $5)
            `, [festival.id, stage.id, stage.name, stage.color, sortOrder]);
          }

          // Preserve picks before deleting sets
          const existingPicks = await client.query(
            `SELECT p.profile_id, p.set_id, p.priority
             FROM festival_profile_picks p
             JOIN festival_sets s ON s.id = p.set_id
             WHERE s.festival_id = $1`,
            [festival.id]
          );

          // Preserve ratings before deleting sets
          const existingRatings = await client.query(
            `SELECT r.user_id, r.rating, r.note, r.created_at, r.updated_at,
                    s.artist, s.start_time
             FROM set_ratings r
             JOIN festival_sets s ON s.id = r.set_id
             WHERE s.festival_id = $1`,
            [festival.id]
          );

          await client.query(
            `DELETE FROM set_ratings WHERE set_id IN (
              SELECT id FROM festival_sets WHERE festival_id = $1
            )`,
            [festival.id]
          );
          await client.query(
            `DELETE FROM festival_profile_picks WHERE set_id IN (
              SELECT id FROM festival_sets WHERE festival_id = $1
            )`,
            [festival.id]
          );

          await client.query('DELETE FROM festival_sets WHERE festival_id = $1', [festival.id]);
          await client.query('DELETE FROM festival_days WHERE festival_id = $1', [festival.id]);

          const newSetIds = new Set();
          const setIdentityMap = new Map();
          for (const [dayIndex, day] of (festival.days || []).entries()) {
            await client.query(`
              INSERT INTO festival_days (festival_id, day_index, label, date)
              VALUES ($1, $2, $3, $4)
            `, [festival.id, dayIndex, day.label || '', day.date || '']);

            for (const [sortOrder, set] of (day.sets || []).entries()) {
              await client.query(`
                INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, link_url, artists)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              `, [set.id, festival.id, dayIndex, set.artist, set.stageId, set.startTime, set.endTime, sortOrder, set.linkUrl || null, JSON.stringify(set.artists || [])]);
              newSetIds.add(set.id);
              const key = `${set.artist}|${set.startTime}`;
              setIdentityMap.set(key, set.id);
            }
          }

          // Restore picks for sets that still exist
          for (const pick of existingPicks.rows) {
            if (newSetIds.has(pick.set_id)) {
              await client.query(
                'INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [pick.profile_id, pick.set_id, pick.priority]
              );
            }
          }

          // Restore ratings mapped to new set IDs by (artist, start_time)
          for (const rating of existingRatings.rows) {
            const key = `${rating.artist}|${rating.start_time}`;
            const newSetId = setIdentityMap.get(key);
            if (newSetId) {
              await client.query(
                `INSERT INTO set_ratings (user_id, set_id, rating, note, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, set_id) DO NOTHING`,
                [rating.user_id, newSetId, rating.rating, rating.note, rating.created_at, rating.updated_at]
              );
            }
          }
        }
      });
    },

    async softDelete(festivalId) {
      await pool.query(
        'UPDATE festivals SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [festivalId],
      );
    },

    async restore(festivalId) {
      await pool.query(
        'UPDATE festivals SET deleted_at = NULL WHERE id = $1',
        [festivalId],
      );
    },

    async getById(festivalId) {
      // Read single festival with stages and days
      // eslint-disable-next-line no-shadow
      const festivals = await this.readAll();
      return festivals.find((f) => f.id === festivalId) || null;
    },

    async create(festival) {
      // Insert festival with stages, days, sets (wrapped in transaction for consistency)
      return withTransaction(pool, async (client) => {
        const createdAt = festival.createdAt || new Date().toISOString();
        const updatedAt = festival.updatedAt || createdAt;

        await client.query(
          'INSERT INTO festivals (id, name, location, created_at, updated_at, b2b_separator, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [festival.id, festival.name, festival.location || '', createdAt, updatedAt, festival.b2bSeparator || 'b2b', festival.latitude || null, festival.longitude || null]
        );

        // Insert stages
        for (const [sortOrder, stage] of (festival.stages || []).entries()) {
          await client.query(
            'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [festival.id, stage.id, stage.name, stage.color, sortOrder]
          );
        }

        // Insert days and sets
        for (const [dayIndex, day] of (festival.days || []).entries()) {
          await client.query(
            'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)',
            [festival.id, dayIndex, day.label || '', day.date || '']
          );

          for (const [sortOrder, set] of (day.sets || []).entries()) {
            await client.query(
              'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, link_url, artists) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
              [set.id, festival.id, dayIndex, set.artist, set.stageId, set.startTime, set.endTime, sortOrder, set.linkUrl || null, JSON.stringify(set.artists || [])]
            );
          }
        }

        const result = await client.query(`
          SELECT id, name, location, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM festivals WHERE id = $1 AND deleted_at IS NULL
        `, [festival.id]);
        return result.rows[0] || null;
      });
    },

    async update(festivalId, fields) {
      // fields: name, location, stages, days (wrapped in transaction for consistency)
      return withTransaction(pool, async (client) => {
        const sets = [];
        const values = [];
        let idx = 1;

        if (fields.name !== undefined) { sets.push(`name = $${idx}`); values.push(fields.name); idx++; }
        if (fields.location !== undefined) { sets.push(`location = $${idx}`); values.push(fields.location); idx++; }
        if (fields.b2bSeparator !== undefined) { sets.push(`b2b_separator = $${idx}`); values.push(fields.b2bSeparator); idx++; }
        if (fields.latitude !== undefined) { sets.push(`latitude = $${idx}`); values.push(fields.latitude); idx++; }
        if (fields.longitude !== undefined) { sets.push(`longitude = $${idx}`); values.push(fields.longitude); idx++; }
        sets.push(`updated_at = $${idx}`); values.push(new Date().toISOString()); idx++;
        values.push(festivalId);

        await client.query(`UPDATE festivals SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`, values);

        // Update stages if provided
        if (fields.stages !== undefined) {
          await client.query('DELETE FROM festival_stages WHERE festival_id = $1', [festivalId]);
          for (const [sortOrder, stage] of (fields.stages || []).entries()) {
            await client.query(
              'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
              [festivalId, stage.id, stage.name, stage.color, sortOrder]
            );
          }
        }

        // Update days and sets if provided
        if (fields.days !== undefined) {
          // Preserve picks: save existing picks before deleting sets, restore after reinserting
          const existingPicks = await client.query(
            `SELECT p.profile_id, p.set_id, p.priority
             FROM festival_profile_picks p
             JOIN festival_sets s ON s.id = p.set_id
             WHERE s.festival_id = $1`,
            [festivalId]
          );

          // Preserve ratings: save existing ratings with set identity (artist + start_time)
          // so we can remap to new set IDs after reinsertion
          const existingRatings = await client.query(
            `SELECT r.user_id, r.rating, r.note, r.created_at, r.updated_at,
                    s.artist, s.start_time
             FROM set_ratings r
             JOIN festival_sets s ON s.id = r.set_id
             WHERE s.festival_id = $1`,
            [festivalId]
          );

          await client.query(
            `DELETE FROM set_ratings WHERE set_id IN (
              SELECT id FROM festival_sets WHERE festival_id = $1
            )`,
            [festivalId]
          );
          await client.query(
            `DELETE FROM festival_profile_picks WHERE set_id IN (
              SELECT id FROM festival_sets WHERE festival_id = $1
            )`,
            [festivalId]
          );
          await client.query('DELETE FROM festival_sets WHERE festival_id = $1', [festivalId]);
          await client.query('DELETE FROM festival_days WHERE festival_id = $1', [festivalId]);

          const newSetIds = new Set();
          // Build mapping from (artist, start_time) -> new set ID for rating restoration
          const setIdentityMap = new Map();
          for (const [dayIndex, day] of (fields.days || []).entries()) {
            await client.query(
              'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)',
              [festivalId, dayIndex, day.label || '', day.date || '']
            );

            for (const [sortOrder, set] of (day.sets || []).entries()) {
              await client.query(
                'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, link_url, artists) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [set.id, festivalId, dayIndex, set.artist, set.stageId, set.startTime, set.endTime, sortOrder, set.linkUrl || null, JSON.stringify(set.artists || [])]
              );
              newSetIds.add(set.id);
              const key = `${set.artist}|${set.startTime}`;
              setIdentityMap.set(key, set.id);
            }
          }

          // Restore picks for sets that still exist
          for (const pick of existingPicks.rows) {
            if (newSetIds.has(pick.set_id)) {
              await client.query(
                'INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [pick.profile_id, pick.set_id, pick.priority]
              );
            }
          }

          // Restore ratings mapped to new set IDs by (artist, start_time)
          for (const rating of existingRatings.rows) {
            const key = `${rating.artist}|${rating.start_time}`;
            const newSetId = setIdentityMap.get(key);
            if (newSetId) {
              await client.query(
                `INSERT INTO set_ratings (user_id, set_id, rating, note, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, set_id) DO NOTHING`,
                [rating.user_id, newSetId, rating.rating, rating.note, rating.created_at, rating.updated_at]
              );
            }
          }
        }

        const result = await client.query(`
          SELECT id, name, location, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM festivals WHERE id = $1 AND deleted_at IS NULL
        `, [festivalId]);
        return result.rows[0] || null;
      });
    },
  };

  return festivals;
}

module.exports = createFestivalsStore;
