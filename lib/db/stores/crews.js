'use strict';

function createCrewsStore(pool, _utils) {
  // #29: Topic subscription store
  const topicSubscriptions = {
    async getForUser(userId, festivalId) {
      const result = await pool.query(`
        SELECT topic, subscribed FROM notification_topic_subs
        WHERE user_id = $1 AND festival_id = $2
      `, [userId, festivalId]);
      const subs = Object.create(null);
      for (const row of result.rows) subs[row.topic] = !!row.subscribed;
      return subs;
    },

    async setSubscription(userId, festivalId, topic, subscribed) {
      await pool.query(`
        INSERT INTO notification_topic_subs (user_id, festival_id, topic, subscribed, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT(user_id, festival_id, topic) DO UPDATE SET
          subscribed = EXCLUDED.subscribed,
          updated_at = NOW()
      `, [userId, festivalId, topic, subscribed ? 1 : 0]);
    },

    async isSubscribed(userId, festivalId, topic) {
      const result = await pool.query(`
        SELECT subscribed FROM notification_topic_subs
        WHERE user_id = $1 AND festival_id = $2 AND topic = $3
      `, [userId, festivalId, topic]);
      // Default to subscribed if no explicit preference
      return result.rows[0] ? !!result.rows[0].subscribed : true;
    },

    async getUnsubscribedUsers(festivalId, topic) {
      const result = await pool.query(`
        SELECT user_id AS "userId" FROM notification_topic_subs
        WHERE festival_id = $1 AND topic = $2 AND subscribed = 0
      `, [festivalId, topic]);
      return new Set(result.rows.map((r) => r.userId));
    },
  };

  const CREW_COLUMNS = 'id, festival_id AS "festivalId", name, created_by AS "createdBy", invite_code AS "inviteCode", invite_expires_at AS "inviteExpiresAt", max_members AS "maxMembers", home_base_location AS "homeBaseLocation", home_base_time AS "homeBaseTime", home_base_updated_at AS "homeBaseUpdatedAt", created_at AS "createdAt", updated_at AS "updatedAt"';

  // Phase 7: Crew system store
  const crews = {
    async create(data) {
      await pool.query(`
        INSERT INTO crews (id, festival_id, name, created_by, invite_code, invite_expires_at, max_members, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [data.id, data.festivalId, data.name, data.createdBy, data.inviteCode, data.inviteExpiresAt || null, data.maxMembers]);
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
      return result.rows[0] || null;
    },

    async update(data) {
      await pool.query(`
        UPDATE crews SET name = $1, max_members = $2, updated_at = NOW()
        WHERE id = $3
      `, [data.name, data.maxMembers, data.id]);
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
      return result.rows[0] || null;
    },

    async delete(crewId) {
      await pool.query('DELETE FROM crews WHERE id = $1', [crewId]);
    },

    async getById(crewId) {
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    async getByInviteCode(code) {
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE invite_code = $1 AND (invite_expires_at IS NULL OR invite_expires_at > NOW())`, [code]);
      return result.rows[0] || null;
    },

    async getExpiredByInviteCode(code) {
      const result = await pool.query(`
        SELECT id FROM crews WHERE invite_code = $1 AND invite_expires_at IS NOT NULL AND invite_expires_at <= NOW()
      `, [code]);
      return result.rows[0] || null;
    },

    async listByFestival(festivalId) {
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE festival_id = $1 ORDER BY created_at ASC`, [festivalId]);
      return result.rows;
    },

    async listByUser(userId) {
      const result = await pool.query(`
        SELECT c.id, c.festival_id AS "festivalId", c.name, c.created_by AS "createdBy",
               c.invite_code AS "inviteCode", c.invite_expires_at AS "inviteExpiresAt", c.max_members AS "maxMembers", c.home_base_location AS "homeBaseLocation", c.home_base_time AS "homeBaseTime", c.home_base_updated_at AS "homeBaseUpdatedAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
               cm.role, cm.joined_at AS "joinedAt"
        FROM crews c JOIN crew_members cm ON cm.crew_id = c.id
        WHERE cm.user_id = $1 ORDER BY c.created_at ASC
      `, [userId]);
      return result.rows;
    },

    async listByUserAndFestival(userId, festivalId) {
      const result = await pool.query(`
        SELECT c.id, c.festival_id AS "festivalId", c.name, c.created_by AS "createdBy",
               c.invite_code AS "inviteCode", c.invite_expires_at AS "inviteExpiresAt", c.max_members AS "maxMembers", c.home_base_location AS "homeBaseLocation", c.home_base_time AS "homeBaseTime", c.home_base_updated_at AS "homeBaseUpdatedAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
               cm.role, cm.joined_at AS "joinedAt"
        FROM crews c
        JOIN crew_members cm ON cm.crew_id = c.id
        WHERE cm.user_id = $1 AND c.festival_id = $2
        ORDER BY c.created_at ASC
      `, [userId, festivalId]);
      return result.rows;
    },

    async regenerateInviteCode(crewId, newCode) {
      await pool.query('UPDATE crews SET invite_code = $1, invite_expires_at = NOW() + INTERVAL \'7 days\', updated_at = NOW() WHERE id = $2', [newCode, crewId]);
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    async addMember(data) {
      await pool.query(`
        INSERT INTO crew_members (crew_id, user_id, role, joined_at)
        VALUES ($1, $2, $3, NOW())
      `, [data.crewId, data.userId, data.role]);
    },

    async removeMember(crewId, userId) {
      await pool.query('DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2', [crewId, userId]);
    },

    async getMembers(crewId) {
      const result = await pool.query(`
        SELECT cm.crew_id AS "crewId", cm.user_id AS "userId", cm.role, cm.joined_at AS "joinedAt",
               u.username, u.avatar_key AS "avatarKey", u.avatar_version AS "avatarVersion"
        FROM crew_members cm
        JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
        WHERE cm.crew_id = $1
        ORDER BY cm.joined_at ASC
      `, [crewId]);
      return result.rows;
    },

    async getMember(crewId, userId) {
      const result = await pool.query(
        'SELECT crew_id AS "crewId", user_id AS "userId", role, joined_at AS "joinedAt" FROM crew_members WHERE crew_id = $1 AND user_id = $2',
        [crewId, userId],
      );
      return result.rows[0] || null;
    },

    async getMemberCount(crewId) {
      const result = await pool.query('SELECT COUNT(*) AS count FROM crew_members WHERE crew_id = $1', [crewId]);
      return result.rows[0].count;
    },

    async updateMemberRole(crewId, userId, role) {
      await pool.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [role, crewId, userId]);
    },

    async getCrewPickOverlap(festivalId, crewId) {
      const result = await pool.query(`
        SELECT fp.user_id AS "userId", fp.picks_json AS "picksJson", u.username
        FROM festival_profiles fp
        JOIN crew_members cm ON cm.user_id = fp.user_id
        JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
        WHERE fp.festival_id = $1 AND cm.crew_id = $2 AND fp.deleted_at IS NULL
      `, [festivalId, crewId]);
      return result.rows;
    },

    async updateHomeBase(crewId, { location, time }) {
      await pool.query(
        'UPDATE crews SET home_base_location = $1, home_base_time = $2, home_base_updated_at = NOW(), updated_at = NOW() WHERE id = $3',
        [location || null, time || null, crewId]
      );
      const result = await pool.query('SELECT id, festival_id AS "festivalId", name, created_by AS "createdBy", invite_code AS "inviteCode", invite_expires_at AS "inviteExpiresAt", max_members AS "maxMembers", home_base_location AS "homeBaseLocation", home_base_time AS "homeBaseTime", home_base_updated_at AS "homeBaseUpdatedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM crews WHERE id = $1', [crewId]);
      return result.rows[0] || null;
    },

        async deleteByFestival(festivalId) {
      await pool.query('DELETE FROM crews WHERE festival_id = $1', [festivalId]);
    },
  };


  // Phase 1B: Meeting points store
  const meetingPoints = {
    async create(data) {
      await pool.query(`
        INSERT INTO crew_meeting_points (id, crew_id, created_by, label, location, type, meet_at, stage_reference, expires_at, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), NOW())
      `, [data.id, data.crewId, data.createdBy, data.label, data.location, data.type || 'during',
           data.meetAt || null, data.stageReference || null, data.expiresAt || null]);
      const result = await pool.query(`
        SELECT id, crew_id AS "crewId", created_by AS "createdBy", label, location, type,
               meet_at AS "meetAt", stage_reference AS "stageReference", expires_at AS "expiresAt",
               active, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM crew_meeting_points WHERE id = $1
      `, [data.id]);
      return result.rows[0] || null;
    },

    async listByCrew(crewId) {
      const result = await pool.query(`
        SELECT mp.id, mp.crew_id AS "crewId", mp.created_by AS "createdBy", mp.label, mp.location,
               mp.type, mp.meet_at AS "meetAt", mp.stage_reference AS "stageReference",
               mp.expires_at AS "expiresAt", mp.active,
               mp.created_at AS "createdAt", mp.updated_at AS "updatedAt",
               u.username AS "creatorName"
        FROM crew_meeting_points mp
        JOIN users u ON u.id = mp.created_by AND u.deleted_at IS NULL
        WHERE mp.crew_id = $1 AND mp.active = TRUE
        ORDER BY
          CASE mp.type WHEN 'emergency' THEN 0 WHEN 'pre-show' THEN 1 WHEN 'during' THEN 2
               WHEN 'post-show' THEN 3 WHEN 'post-event' THEN 4 ELSE 5 END,
          mp.meet_at NULLS LAST,
          mp.created_at ASC
      `, [crewId]);
      return result.rows;
    },

    async update(id, fields) {
      const sets = [];
      const vals = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = { label: 'label', location: 'location', type: 'type',
                      meetAt: 'meet_at', stageReference: 'stage_reference', expiresAt: 'expires_at' }[key];
        if (col) { sets.push(col + ' = $' + idx); vals.push(val); idx++; }
      }
      if (sets.length === 0) return null;
      sets.push('updated_at = NOW()');
      vals.push(id);
      await pool.query('UPDATE crew_meeting_points SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(`
        SELECT id, crew_id AS "crewId", created_by AS "createdBy", label, location, type,
               meet_at AS "meetAt", stage_reference AS "stageReference", expires_at AS "expiresAt",
               active, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM crew_meeting_points WHERE id = $1
      `, [id]);
      return result.rows[0] || null;
    },

    async deactivate(id) {
      await pool.query('UPDATE crew_meeting_points SET active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    },

    async getById(id) {
      const result = await pool.query(`
        SELECT id, crew_id AS "crewId", created_by AS "createdBy", label, location, type,
               meet_at AS "meetAt", stage_reference AS "stageReference", expires_at AS "expiresAt",
               active, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM crew_meeting_points WHERE id = $1
      `, [id]);
      return result.rows[0] || null;
    },

    async countByCrew(crewId) {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM crew_meeting_points WHERE crew_id = $1 AND active = TRUE',
        [crewId]
      );
      return result.rows[0].count;
    },

    async expireStale() {
      return pool.query(
        'UPDATE crew_meeting_points SET active = FALSE, updated_at = NOW() WHERE active = TRUE AND expires_at IS NOT NULL AND expires_at < NOW()'
      );
    },
  };

  return { crews, topicSubscriptions, meetingPoints };
}

module.exports = createCrewsStore;
