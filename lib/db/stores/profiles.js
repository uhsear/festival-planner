'use strict';

const { withTransaction, serializeJson } = require('../connection');

// Batch INSERT helper — builds multi-row VALUES clause
function batchInsert(client, table, columns, rows) {
  if (rows.length === 0) return Promise.resolve();
  if (!/^[a-z_]+$/.test(table)) throw new Error('invalid table name');
  for (const col of columns) {
    if (!/^[a-z_]+$/.test(col)) throw new Error('invalid column name');
  }
  const colStr = columns.join(', ');
  const values = [];
  const placeholders = rows.map((row, ri) => {
    const ph = columns.map((_, ci) => {
      values.push(row[ci]);
      return `$${ri * columns.length + ci + 1}`;
    });
    return `(${ph.join(', ')})`;
  });
  return client.query(`INSERT INTO ${table} (${colStr}) VALUES ${placeholders.join(', ')}`, values);
}

// #24: Normalized read fragment — reconstructs picks/notes/reminders from
// dedicated tables instead of the legacy JSONB columns. JSONB columns remain
// for dual-write rollback safety but are no longer the read source.
const PROFILE_SELECT = `
  fp.id,
  fp.festival_id AS "festivalId",
  fp.user_id     AS "userId",
  fp.name,
  COALESCE(
    (SELECT jsonb_object_agg(p.set_id, p.priority)
     FROM festival_profile_picks p WHERE p.profile_id = fp.id),
    '{}'::jsonb
  ) AS "picksJson",
  COALESCE(
    (SELECT jsonb_object_agg(n.set_id, n.text)
     FROM festival_profile_notes n WHERE n.profile_id = fp.id),
    '{}'::jsonb
  ) AS "notesJson",
  fp.created_at AS "createdAt",
  fp.updated_at AS "updatedAt"
`;

function createProfilesStore(pool, utils) {
  const { mapProfileRow } = utils;

  const profiles = {
    async readAll({ limit = 10000 } = {}) {
      const result = await pool.query(`
        SELECT ${PROFILE_SELECT}
        FROM festival_profiles fp
        WHERE fp.deleted_at IS NULL
        ORDER BY fp.created_at ASC, fp.id ASC
        LIMIT $1
      `, [limit]);
      return result.rows.map(mapProfileRow);
    },

    async getByFestival(festivalId) {
      const result = await pool.query(`
        SELECT ${PROFILE_SELECT}
        FROM festival_profiles fp
        WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
        ORDER BY fp.created_at ASC, fp.id ASC
      `, [festivalId]);
      return result.rows.map(mapProfileRow);
    },

    async userIdsByFestival(festivalId) {
      const result = await pool.query(
        'SELECT user_id AS "userId" FROM festival_profiles WHERE festival_id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL',
        [festivalId],
      );
      return result.rows.map((row) => row.userId);
    },

    async getByUserId(userId) {
      const result = await pool.query(`
        SELECT fp.id, fp.festival_id AS "festivalId", fp.user_id AS "userId", fp.name,
               fp.created_at AS "createdAt", fp.updated_at AS "updatedAt"
        FROM festival_profiles fp
        WHERE fp.user_id = $1 AND fp.deleted_at IS NULL
        ORDER BY fp.created_at ASC
      `, [userId]);
      return result.rows;
    },

    async readByUserAndFestival(userId, festivalId) {
      const result = await pool.query(
        'SELECT id FROM festival_profiles WHERE user_id = $1 AND festival_id = $2 AND deleted_at IS NULL LIMIT 1',
        [userId, festivalId],
      );
      return result.rows[0] || null;
    },

    async replaceAll(nextProfiles) {
      return withTransaction(pool, async (client) => {
        if (nextProfiles.length === 0) {
          await client.query('UPDATE festival_profiles SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL');
          return;
        }

        const profileIds = nextProfiles.map((profile) => profile.id);
        await client.query(
          `UPDATE festival_profiles SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL AND id NOT IN (${profileIds.map((_, i) => `$${i + 1}`).join(',')})`,
          profileIds,
        );

        // Batch UPSERT all profiles in a single multi-row query
        const upsertValues = [];
        const upsertPlaceholders = nextProfiles.map((profile, ri) => {
          const createdAt = profile.createdAt || new Date().toISOString();
          const base = ri * 9;
          upsertValues.push(
            profile.id,
            profile.festivalId,
            profile.userId || null,
            profile.name,
            serializeJson(profile.picks, {}),
            serializeJson(profile.notes, {}),
            serializeJson(profile.reminders, {}),
            createdAt,
            profile.updatedAt || createdAt,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
        });
        await client.query(`
          INSERT INTO festival_profiles (id, festival_id, user_id, name, picks_json, notes_json, reminders_json, created_at, updated_at)
          VALUES ${upsertPlaceholders.join(', ')}
          ON CONFLICT(id) DO UPDATE SET
            festival_id = EXCLUDED.festival_id,
            user_id = EXCLUDED.user_id,
            name = EXCLUDED.name,
            picks_json = EXCLUDED.picks_json,
            notes_json = EXCLUDED.notes_json,
            reminders_json = EXCLUDED.reminders_json,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            deleted_at = NULL
        `, upsertValues);

        // #24: Batch sync normalized picks/notes tables
        // Delete all existing picks/notes for these profiles in two queries
        await client.query('DELETE FROM festival_profile_picks WHERE profile_id = ANY($1)', [profileIds]);
        await client.query('DELETE FROM festival_profile_notes WHERE profile_id = ANY($1)', [profileIds]);

        // Collect all pick and note rows across all profiles
        const allPickRows = [];
        const allNoteRows = [];
        for (const profile of nextProfiles) {
          const picks = profile.picks || {};
          for (const [setId, priority] of Object.entries(picks)) {
            allPickRows.push([profile.id, setId, priority]);
          }
          const notes = profile.notes || {};
          for (const [setId, text] of Object.entries(notes)) {
            allNoteRows.push([profile.id, setId, text]);
          }
        }
        await batchInsert(client, 'festival_profile_picks', ['profile_id', 'set_id', 'priority'], allPickRows);
        await batchInsert(client, 'festival_profile_notes', ['profile_id', 'set_id', 'text'], allNoteRows);
      });
    },

    async create({ id, festivalId, userId, name, picks, notes, reminders, createdAt }) {
      // Use transaction to ensure main record and normalized tables stay in sync
      return withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO festival_profiles (id, festival_id, user_id, name, picks_json, notes_json, reminders_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, festivalId, userId || null, name, serializeJson(picks || {}), serializeJson(notes || {}), serializeJson(reminders || {}), createdAt || new Date().toISOString()]
        );
        // Sync normalized picks/notes/reminders tables (batch)
        if (picks && Object.keys(picks).length > 0) {
          const pickRows = Object.entries(picks).map(([setId, priority]) => [id, setId, priority]);
          await batchInsert(client, 'festival_profile_picks', ['profile_id', 'set_id', 'priority'], pickRows);
        }
        if (notes && Object.keys(notes).length > 0) {
          const noteRows = Object.entries(notes).map(([setId, text]) => [id, setId, text]);
          await batchInsert(client, 'festival_profile_notes', ['profile_id', 'set_id', 'text'], noteRows);
        }

        const result = await client.query(`
          SELECT ${PROFILE_SELECT}
          FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL
        `, [id]);
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
      });
    },

    async getById(profileId) {
      const { rows } = await pool.query(`
        SELECT ${PROFILE_SELECT}
        FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL
      `, [profileId]);
      if (!rows[0]) return null;
      return mapProfileRow(rows[0]);
    },

    async update(profileId, fields) {
      // fields: picks, notes, reminders, userId, name, updatedAt
      // Use transaction to ensure main record and normalized tables stay in sync (#CRITICAL)
      return withTransaction(pool, async (client) => {
        const sets = [];
        const values = [];
        let idx = 1;
        if (fields.picks !== undefined) { sets.push(`picks_json = $${idx}`); values.push(serializeJson(fields.picks)); idx++; }
        if (fields.notes !== undefined) { sets.push(`notes_json = $${idx}`); values.push(serializeJson(fields.notes)); idx++; }
        if (fields.reminders !== undefined) { sets.push(`reminders_json = $${idx}`); values.push(serializeJson(fields.reminders)); idx++; }
        if (fields.userId !== undefined) { sets.push(`user_id = $${idx}`); values.push(fields.userId); idx++; }
        if (fields.name !== undefined) { sets.push(`name = $${idx}`); values.push(fields.name); idx++; }
        sets.push(`updated_at = $${idx}`); values.push(new Date().toISOString()); idx++;
        values.push(profileId);
        await client.query(`UPDATE festival_profiles SET ${sets.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`, values);
        // Sync normalized tables (batch inserts)
        if (fields.picks !== undefined) {
          await client.query('DELETE FROM festival_profile_picks WHERE profile_id = $1', [profileId]);
          const pickRows = Object.entries(fields.picks).map(([setId, priority]) => [profileId, setId, priority]);
          await batchInsert(client, 'festival_profile_picks', ['profile_id', 'set_id', 'priority'], pickRows);
        }
        if (fields.notes !== undefined) {
          await client.query('DELETE FROM festival_profile_notes WHERE profile_id = $1', [profileId]);
          const noteRows = Object.entries(fields.notes).map(([setId, text]) => [profileId, setId, text]);
          await batchInsert(client, 'festival_profile_notes', ['profile_id', 'set_id', 'text'], noteRows);
        }
        const result = await client.query(`
          SELECT ${PROFILE_SELECT}
          FROM festival_profiles fp WHERE fp.id = $1 AND fp.deleted_at IS NULL
        `, [profileId]);
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
      });
    },

    async delete(profileId, { deletedBy, reason } = {}) {
      const profile = await this.getById(profileId);
      if (!profile) return null;
      await withTransaction(pool, async (client) => {
        await client.query('UPDATE festival_profiles SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL', [profileId, deletedBy || null, reason || null]);
        await client.query('DELETE FROM festival_profile_picks WHERE profile_id = $1', [profileId]);
        await client.query('DELETE FROM festival_profile_notes WHERE profile_id = $1', [profileId]);
      });
      return profile;
    },

    async deleteByUserId(userId, { deletedBy, reason } = {}) {
      const { rows } = await pool.query(`
        SELECT id, festival_id AS "festivalId", user_id AS "userId", name
        FROM festival_profiles WHERE user_id = $1 AND deleted_at IS NULL
      `, [userId]);
      if (rows.length > 0) {
        const profileIds = rows.map(r => r.id);
        await withTransaction(pool, async (client) => {
          await client.query('UPDATE festival_profiles SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE user_id = $1 AND deleted_at IS NULL', [userId, deletedBy || null, reason || null]);
          await client.query('DELETE FROM festival_profile_picks WHERE profile_id = ANY($1)', [profileIds]);
          await client.query('DELETE FROM festival_profile_notes WHERE profile_id = ANY($1)', [profileIds]);
        });
      }
      return rows.map(mapProfileRow);
    },

    async claimOrphan(festivalId, userId, username) {
      // Find orphan profile matching username
      const { rows } = await pool.query(`
        SELECT id FROM festival_profiles
        WHERE festival_id = $1 AND user_id IS NULL AND LOWER(name) = LOWER($2) AND deleted_at IS NULL
        LIMIT 1
      `, [festivalId, username]);
      if (rows[0]) {
        await pool.query('UPDATE festival_profiles SET user_id = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL', [userId, rows[0].id]);
        return this.getById(rows[0].id);
      }
      return null;
    },

    async countByFestival(festivalId) {
      const { rows } = await pool.query('SELECT COUNT(*) AS count FROM festival_profiles WHERE festival_id = $1 AND deleted_at IS NULL', [festivalId]);
      return parseInt(rows[0].count, 10);
    },

    async claimOrphanProfiles(userId, name) {
      const { rowCount } = await pool.query(
        'UPDATE festival_profiles SET user_id = $1, updated_at = NOW() WHERE user_id IS NULL AND LOWER(name) = LOWER($2) AND deleted_at IS NULL',
        [userId, name],
      );
      return rowCount;
    },
  };

  // #24: Picks store for querying normalized picks data
  const picks = {
    async bySetId(setId) {
      const result = await pool.query(`
        SELECT p.profile_id AS "profileId", fp.user_id AS "userId", fp.name AS "profileName", p.priority
        FROM festival_profile_picks p
        JOIN festival_profiles fp ON fp.id = p.profile_id
        WHERE p.set_id = $1 AND fp.deleted_at IS NULL
      `, [setId]);
      return result.rows;
    },

    async byFestival(festivalId) {
      const result = await pool.query(`
        SELECT p.set_id AS "setId", p.priority, fp.user_id AS "userId"
        FROM festival_profile_picks p
        JOIN festival_profiles fp ON fp.id = p.profile_id
        WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
      `, [festivalId]);
      return result.rows;
    },
  };

  return { profiles, picks };
}

module.exports = createProfilesStore;
