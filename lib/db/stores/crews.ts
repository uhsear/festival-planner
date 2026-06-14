import type { Pool } from 'pg';
import { withTransaction } from '../connection';
import { sanitizeString } from '../../helpers/sanitize.js';

/**
 * H3 (defense-in-depth, audit 2026-06-06): meeting-point label/location are user
 * free-text that the mobile map WebView interpolates into an inline <script>.
 * The WebView itself is being hardened separately, but neutralize the stored
 * value too: run it through sanitizeString (NFC + strip control/bidi/zero-width
 * + cap) AND strip angle brackets so a `</script>` breakout cannot be persisted.
 * Returns the cleaned string (or the original non-string value untouched, so
 * NULLs / undefined pass through to the existing `|| null` handling).
 */
function sanitizeMeetingPointText(value: any, maxLen: number) {
  if (typeof value !== 'string') return value;
  return sanitizeString(value, maxLen).replace(/[<>]/g, '');
}

export default function createCrewsStore(pool: Pool, _utils: any) {
  // #29: Topic subscription store
  const topicSubscriptions = {
    async getForUser(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          topic,
          subscribed
        FROM
          notification_topic_subs
        WHERE
          user_id = $1
          AND festival_id = $2
      `,
        [userId, festivalId],
      );
      const subs: Record<string, boolean> = Object.create(null);
      for (const row of result.rows) subs[row.topic] = !!row.subscribed;
      return subs;
    },

    async setSubscription(userId: string, festivalId: string, topic: string, subscribed: boolean) {
      await pool.query(
        `
        INSERT INTO notification_topic_subs (user_id, festival_id, topic, subscribed, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT(user_id, festival_id, topic) DO UPDATE SET
          subscribed = EXCLUDED.subscribed,
          updated_at = NOW()
      `,
        [userId, festivalId, topic, subscribed ? 1 : 0],
      );
    },

    async isSubscribed(userId: string, festivalId: string, topic: string) {
      const result = await pool.query(
        `
        SELECT
          subscribed
        FROM
          notification_topic_subs
        WHERE
          user_id = $1
          AND festival_id = $2
          AND topic = $3
      `,
        [userId, festivalId, topic],
      );
      // Default to subscribed if no explicit preference
      return result.rows[0] ? !!result.rows[0].subscribed : true;
    },

    async getUnsubscribedUsers(festivalId: string, topic: string) {
      const result = await pool.query(
        `
        SELECT
          user_id AS "userId"
        FROM
          notification_topic_subs
        WHERE
          festival_id = $1
          AND topic = $2
          AND subscribed = 0
      `,
        [festivalId, topic],
      );
      return new Set(result.rows.map((r: any) => r.userId));
    },
  };

  const CREW_COLUMNS =
    'id, festival_id AS "festivalId", name, created_by AS "createdBy", invite_code AS "inviteCode", invite_expires_at AS "inviteExpiresAt", max_members AS "maxMembers", reformed_from AS "reformedFrom", home_base_location AS "homeBaseLocation", home_base_time AS "homeBaseTime", home_base_updated_at AS "homeBaseUpdatedAt", photo_album_url AS "photoAlbumUrl", created_at AS "createdAt", updated_at AS "updatedAt"';

  // Phase 7: Crew system store
  const crews: any = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crews (
            id,
            festival_id,
            name,
            created_by,
            invite_code,
            invite_expires_at,
            max_members,
            reformed_from,
            created_at,
            updated_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      `,
        [
          data.id,
          data.festivalId,
          data.name,
          data.createdBy,
          data.inviteCode,
          data.inviteExpiresAt || null,
          data.maxMembers,
          data.reformedFrom || null,
        ],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
      return result.rows[0] || null;
    },

    /**
     * Create a crew and add the owner as a member in a single transaction.
     * Prevents orphaned crews if addMember fails after create succeeds.
     */
    async createWithOwner(data: any) {
      return withTransaction(pool, async (client) => {
        await client.query(
          `
          INSERT INTO
            crews (
              id,
              festival_id,
              name,
              created_by,
              invite_code,
              invite_expires_at,
              max_members,
              reformed_from,
              created_at,
              updated_at
            )
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        `,
          [
            data.id,
            data.festivalId,
            data.name,
            data.createdBy,
            data.inviteCode,
            data.inviteExpiresAt || null,
            data.maxMembers,
            data.reformedFrom || null,
          ],
        );
        await client.query(
          `
          INSERT INTO
            crew_members (crew_id, user_id, role, joined_at)
          VALUES
            ($1, $2, 'owner', NOW())
        `,
          [data.id, data.createdBy],
        );
        const result = await client.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
        return result.rows[0] || null;
      });
    },

    async update(data: any) {
      await pool.query(
        `
        UPDATE crews
        SET
          name = $1,
          max_members = $2,
          updated_at = NOW()
        WHERE
          id = $3
      `,
        [data.name, data.maxMembers, data.id],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [data.id]);
      return result.rows[0] || null;
    },

    async delete(crewId: string) {
      await pool.query('DELETE FROM crews WHERE id = $1', [crewId]);
    },

    async getById(crewId: string) {
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    async getByInviteCode(code: string) {
      const result = await pool.query(
        `SELECT ${CREW_COLUMNS} FROM crews WHERE invite_code = $1 AND (invite_expires_at IS NULL OR invite_expires_at > NOW())`,
        [code],
      );
      return result.rows[0] || null;
    },

    async getExpiredByInviteCode(code: string) {
      const result = await pool.query(
        `
        SELECT
          id
        FROM
          crews
        WHERE
          invite_code = $1
          AND invite_expires_at IS NOT NULL
          AND invite_expires_at <= NOW()
      `,
        [code],
      );
      return result.rows[0] || null;
    },

    async listByFestival(festivalId: string) {
      const result = await pool.query(
        `SELECT ${CREW_COLUMNS} FROM crews WHERE festival_id = $1 ORDER BY created_at ASC`,
        [festivalId],
      );
      return result.rows;
    },

    async listByUser(userId: string) {
      const result = await pool.query(
        `
        SELECT
          c.id,
          c.festival_id AS "festivalId",
          c.name,
          c.created_by AS "createdBy",
          c.invite_code AS "inviteCode",
          c.invite_expires_at AS "inviteExpiresAt",
          c.max_members AS "maxMembers",
          c.reformed_from AS "reformedFrom",
          c.home_base_location AS "homeBaseLocation",
          c.home_base_time AS "homeBaseTime",
          c.home_base_updated_at AS "homeBaseUpdatedAt",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          cm.role,
          cm.joined_at AS "joinedAt"
        FROM
          crews c
          JOIN crew_members cm ON cm.crew_id = c.id
        WHERE
          cm.user_id = $1
        ORDER BY
          c.created_at ASC
      `,
        [userId],
      );
      return result.rows;
    },

    async listByUserAndFestival(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          c.id,
          c.festival_id AS "festivalId",
          c.name,
          c.created_by AS "createdBy",
          c.invite_code AS "inviteCode",
          c.invite_expires_at AS "inviteExpiresAt",
          c.max_members AS "maxMembers",
          c.reformed_from AS "reformedFrom",
          c.home_base_location AS "homeBaseLocation",
          c.home_base_time AS "homeBaseTime",
          c.home_base_updated_at AS "homeBaseUpdatedAt",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          cm.role,
          cm.joined_at AS "joinedAt"
        FROM
          crews c
          JOIN crew_members cm ON cm.crew_id = c.id
        WHERE
          cm.user_id = $1
          AND c.festival_id = $2
        ORDER BY
          c.created_at ASC
      `,
        [userId, festivalId],
      );
      return result.rows;
    },

    async regenerateInviteCode(crewId: string, newCode: string) {
      await pool.query(
        "UPDATE crews SET invite_code = $1, invite_expires_at = NOW() + INTERVAL '7 days', updated_at = NOW() WHERE id = $2",
        [newCode, crewId],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    /**
     * Add a member to a crew. When `maxMembers` is supplied the cap is enforced
     * ATOMICALLY: the parent crews row is locked so concurrent joins serialize,
     * the count is re-read under the lock, and the insert is skipped if the crew
     * is full — closing the count-then-insert race in the join/admin-add routes.
     * Returns 'full' if the cap was reached (no insert), otherwise 'added'.
     * Without a cap (owner creation, reform) it's a plain insert.
     */
    async addMember(data: any, maxMembers?: number): Promise<'added' | 'full'> {
      if (typeof maxMembers === 'number') {
        return withTransaction(pool, async (client) => {
          // Lock the crew row; all capped joiners for this crew serialize here.
          await client.query('SELECT 1 FROM crews WHERE id = $1 FOR UPDATE', [data.crewId]);
          const countRes = await client.query('SELECT COUNT(*)::int AS count FROM crew_members WHERE crew_id = $1', [
            data.crewId,
          ]);
          if ((countRes.rows[0]?.count ?? 0) >= maxMembers) return 'full';
          await client.query(
            'INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (crew_id, user_id) DO NOTHING',
            [data.crewId, data.userId, data.role],
          );
          return 'added';
        });
      }
      await pool.query(
        `
        INSERT INTO
          crew_members (crew_id, user_id, role, joined_at)
        VALUES
          ($1, $2, $3, NOW())
      `,
        [data.crewId, data.userId, data.role],
      );
      return 'added';
    },

    async removeMember(crewId: string, userId: string) {
      await pool.query('DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2', [crewId, userId]);
    },

    async getMembers(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          cm.crew_id AS "crewId",
          cm.user_id AS "userId",
          cm.role,
          cm.joined_at AS "joinedAt",
          u.username,
          u.display_name AS "name",
          u.avatar_key AS "avatarKey",
          u.avatar_version AS "avatarVersion"
        FROM
          crew_members cm
          JOIN users u ON u.id = cm.user_id
          AND u.deleted_at IS NULL
        WHERE
          cm.crew_id = $1
        ORDER BY
          cm.joined_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    /**
     * Batch-load members for multiple crews in a single query.
     * Returns a Map keyed by crewId, each value an array of member rows.
     * Used by the crew list endpoint to avoid N+1 queries.
     */
    async getMembersForCrews(crewIds: string[]): Promise<Map<string, any[]>> {
      const membersByCrewId = new Map<string, any[]>();
      if (crewIds.length === 0) return membersByCrewId;

      const result = await pool.query(
        `
        SELECT
          cm.crew_id AS "crewId",
          cm.user_id AS "userId",
          cm.role,
          cm.joined_at AS "joinedAt",
          u.username,
          u.display_name AS "name",
          u.avatar_key AS "avatarKey",
          u.avatar_version AS "avatarVersion"
        FROM
          crew_members cm
          JOIN users u ON u.id = cm.user_id
          AND u.deleted_at IS NULL
        WHERE
          cm.crew_id = ANY($1)
        ORDER BY
          cm.crew_id,
          cm.joined_at ASC
      `,
        [crewIds],
      );

      // Initialize empty arrays for all requested crew IDs
      for (const id of crewIds) membersByCrewId.set(id, []);
      // Group rows by crewId
      for (const row of result.rows) {
        const members = membersByCrewId.get(row.crewId);
        if (members) members.push(row);
      }
      return membersByCrewId;
    },

    async getMember(crewId: string, userId: string) {
      const result = await pool.query(
        'SELECT crew_id AS "crewId", user_id AS "userId", role, joined_at AS "joinedAt" FROM crew_members WHERE crew_id = $1 AND user_id = $2',
        [crewId, userId],
      );
      return result.rows[0] || null;
    },

    async getMemberCount(crewId: string) {
      const result = await pool.query('SELECT COUNT(*) AS count FROM crew_members WHERE crew_id = $1', [crewId]);
      return result.rows[0]?.count ?? 0;
    },

    async updateMemberRole(crewId: string, userId: string, role: string) {
      await pool.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [role, crewId, userId]);
    },

    /**
     * Transfer crew ownership atomically: demote current owner, promote target.
     * Prevents inconsistent state where both or neither are owner.
     */
    async transferOwnership(crewId: string, fromUserId: string, toUserId: string) {
      return withTransaction(pool, async (client) => {
        await client.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [
          'member',
          crewId,
          fromUserId,
        ]);
        await client.query('UPDATE crew_members SET role = $1 WHERE crew_id = $2 AND user_id = $3', [
          'owner',
          crewId,
          toUserId,
        ]);
      });
    },

    async getCrewPickOverlap(festivalId: string, crewId: string) {
      const result = await pool.query(
        `
        SELECT
          fp.user_id AS "userId",
          fp.picks_json AS "picksJson",
          u.username,
          u.display_name AS "name"
        FROM
          festival_profiles fp
          JOIN crew_members cm ON cm.user_id = fp.user_id
          JOIN users u ON u.id = fp.user_id
          AND u.deleted_at IS NULL
        WHERE
          fp.festival_id = $1
          AND cm.crew_id = $2
          AND fp.deleted_at IS NULL
      `,
        [festivalId, crewId],
      );
      return result.rows;
    },

    async updateHomeBase(crewId: string, { location, time }: { location?: string; time?: string }) {
      await pool.query(
        'UPDATE crews SET home_base_location = $1, home_base_time = $2, home_base_updated_at = NOW(), updated_at = NOW() WHERE id = $3',
        [location || null, time || null, crewId],
      );
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    // M6 Crew Photo Wall (Phase 1): set/clear the crew's shared-album URL. Pass
    // null (or a falsy url) to clear it. Cloned from updateHomeBase — a single
    // crew-field write that returns the refreshed crew. Member-gated at the
    // route (any member can set the album link, not owner-only).
    async updatePhotoAlbum(crewId: string, { photoAlbumUrl }: { photoAlbumUrl?: string | null }) {
      await pool.query('UPDATE crews SET photo_album_url = $1, updated_at = NOW() WHERE id = $2', [
        photoAlbumUrl || null,
        crewId,
      ]);
      const result = await pool.query(`SELECT ${CREW_COLUMNS} FROM crews WHERE id = $1`, [crewId]);
      return result.rows[0] || null;
    },

    async deleteByFestival(festivalId: string) {
      await pool.query('DELETE FROM crews WHERE festival_id = $1', [festivalId]);
    },
  };

  // Phase 1B: Meeting points store
  const meetingPoints = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_meeting_points (
            id,
            crew_id,
            created_by,
            label,
            location,
            type,
            meet_at,
            stage_reference,
            expires_at,
            latitude,
            longitude,
            recurs_daily,
            active,
            created_at,
            updated_at
          )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            TRUE,
            NOW(),
            NOW()
          )
      `,
        [
          data.id,
          data.crewId,
          data.createdBy,
          sanitizeMeetingPointText(data.label, 100),
          sanitizeMeetingPointText(data.location, 200),
          data.type || 'during',
          data.meetAt || null,
          data.stageReference || null,
          data.expiresAt || null,
          data.latitude ?? null,
          data.longitude ?? null,
          data.recursDaily ?? false,
        ],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          location,
          type,
          meet_at,
          stage_reference,
          expires_at,
          latitude,
          longitude,
          recurs_daily,
          active,
          created_at,
          updated_at
        FROM
          crew_meeting_points
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          mp.id,
          mp.crew_id,
          mp.created_by,
          mp.label,
          mp.location,
          mp.type,
          mp.meet_at,
          mp.stage_reference,
          mp.expires_at,
          mp.latitude,
          mp.longitude,
          mp.recurs_daily,
          mp.active,
          mp.created_at,
          mp.updated_at,
          u.username AS creator_name
        FROM
          crew_meeting_points mp
          JOIN users u ON u.id = mp.created_by
          AND u.deleted_at IS NULL
        WHERE
          mp.crew_id = $1
          AND mp.active = TRUE
        ORDER BY
          CASE mp.type
            WHEN 'emergency' THEN 0
            WHEN 'pre-show' THEN 1
            WHEN 'during' THEN 2
            WHEN 'post-show' THEN 3
            WHEN 'post-event' THEN 4
            ELSE 5
          END,
          mp.meet_at NULLS LAST,
          mp.created_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    async update(id: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = (
          {
            label: 'label',
            location: 'location',
            type: 'type',
            meetAt: 'meet_at',
            stageReference: 'stage_reference',
            expiresAt: 'expires_at',
            latitude: 'latitude',
            longitude: 'longitude',
            recursDaily: 'recurs_daily',
          } as Record<string, string>
        )[key];
        if (col) {
          // H3: sanitize free-text label/location on update too (see create).
          let outVal = val;
          if (key === 'label') outVal = sanitizeMeetingPointText(val, 100);
          else if (key === 'location') outVal = sanitizeMeetingPointText(val, 200);
          sets.push(col + ' = $' + idx);
          vals.push(outVal);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      sets.push('updated_at = NOW()');
      vals.push(id);
      await pool.query('UPDATE crew_meeting_points SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          location,
          type,
          meet_at,
          stage_reference,
          expires_at,
          latitude,
          longitude,
          recurs_daily,
          active,
          created_at,
          updated_at
        FROM
          crew_meeting_points
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async deactivate(id: string) {
      await pool.query('UPDATE crew_meeting_points SET active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          location,
          type,
          meet_at,
          stage_reference,
          expires_at,
          latitude,
          longitude,
          recurs_daily,
          active,
          created_at,
          updated_at
        FROM
          crew_meeting_points
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM crew_meeting_points WHERE crew_id = $1 AND active = TRUE',
        [crewId],
      );
      return result.rows[0].count;
    },

    async expireStale() {
      return pool.query(
        'UPDATE crew_meeting_points SET active = FALSE, updated_at = NOW() WHERE active = TRUE AND expires_at IS NOT NULL AND expires_at < NOW()',
      );
    },
  };

  // M2 logistics: Crew packing board store. Mirrors the meetingPoints sub-store
  // factory return — a flat per-crew checklist of items ("who's bringing what").
  const crewPacking = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_packing_items (
            id,
            crew_id,
            created_by,
            label,
            brought_by,
            claimed,
            created_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, NOW())
      `,
        [data.id, data.crewId, data.createdBy, data.label, data.broughtBy || null, data.claimed === true],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          pi.id,
          pi.crew_id,
          pi.created_by,
          pi.label,
          pi.brought_by,
          pi.claimed,
          pi.created_at,
          u.username AS creator_name
        FROM
          crew_packing_items pi
          JOIN users u ON u.id = pi.created_by
          AND u.deleted_at IS NULL
        WHERE
          pi.crew_id = $1
        ORDER BY
          pi.claimed ASC,
          pi.created_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    async update(id: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = (
          {
            label: 'label',
            broughtBy: 'brought_by',
            claimed: 'claimed',
          } as Record<string, string>
        )[key];
        if (col) {
          sets.push(col + ' = $' + idx);
          vals.push(val);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      vals.push(id);
      await pool.query('UPDATE crew_packing_items SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async delete(id: string) {
      await pool.query('DELETE FROM crew_packing_items WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          label,
          brought_by,
          claimed,
          created_at
        FROM
          crew_packing_items
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM crew_packing_items WHERE crew_id = $1', [
        crewId,
      ]);
      return result.rows[0].count;
    },
  };

  // M2 logistics: Crew carpool / ride board store. Mirrors the crewPacking
  // sub-store factory return — a flat per-crew board of ride OFFERS ("who's
  // driving"). Cloned from crewPacking exactly.
  const crewRides = {
    async create(data: any) {
      await pool.query(
        `
        INSERT INTO
          crew_ride_offers (
            id,
            crew_id,
            created_by,
            driver,
            seats,
            depart_from,
            depart_at,
            note,
            created_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
        [
          data.id,
          data.crewId,
          data.createdBy,
          data.driver ?? null,
          data.seats ?? null,
          data.departFrom ?? null,
          data.departAt ?? null,
          data.note ?? null,
        ],
      );
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          driver,
          seats,
          depart_from,
          depart_at,
          note,
          created_at
        FROM
          crew_ride_offers
        WHERE
          id = $1
      `,
        [data.id],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          ro.id,
          ro.crew_id,
          ro.created_by,
          ro.driver,
          ro.seats,
          ro.depart_from,
          ro.depart_at,
          ro.note,
          ro.created_at,
          u.username AS creator_name
        FROM
          crew_ride_offers ro
          JOIN users u ON u.id = ro.created_by
          AND u.deleted_at IS NULL
        WHERE
          ro.crew_id = $1
        ORDER BY
          ro.created_at ASC
      `,
        [crewId],
      );
      return result.rows;
    },

    async update(id: string, fields: Record<string, any>) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        const col = (
          {
            driver: 'driver',
            seats: 'seats',
            departFrom: 'depart_from',
            departAt: 'depart_at',
            note: 'note',
          } as Record<string, string>
        )[key];
        if (col) {
          sets.push(col + ' = $' + idx);
          vals.push(val);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      vals.push(id);
      await pool.query('UPDATE crew_ride_offers SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          driver,
          seats,
          depart_from,
          depart_at,
          note,
          created_at
        FROM
          crew_ride_offers
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async delete(id: string) {
      await pool.query('DELETE FROM crew_ride_offers WHERE id = $1', [id]);
    },

    async getById(id: string) {
      const result = await pool.query(
        `
        SELECT
          id,
          crew_id,
          created_by,
          driver,
          seats,
          depart_from,
          depart_at,
          note,
          created_at
        FROM
          crew_ride_offers
        WHERE
          id = $1
      `,
        [id],
      );
      return result.rows[0] || null;
    },

    async countByCrew(crewId: string) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM crew_ride_offers WHERE crew_id = $1', [
        crewId,
      ]);
      return result.rows[0].count;
    },
  };

  // M5: Crew member status store — last-synced "on my way / ETA to [point]".
  // One row per (crew, user); upsert REPLACES the member's prior status (the
  // latest snapshot wins). This is a degraded-sync snapshot, NOT live GPS — the
  // UI renders `updated_at` as honest staleness ("as of N ago"), never "live".
  const crewStatus = {
    // Upsert the requesting member's own status. ON CONFLICT (crew_id, user_id)
    // overwrites so an offline toggle that replays simply lands the latest value.
    async upsert(data: any) {
      // 055: latitude/longitude/location_captured_at are the offline presence
      // breadcrumb (NOT live GPS). They are only overwritten when a position is
      // supplied (latitude !== undefined); a status-only update leaves the prior
      // breadcrumb intact via COALESCE so a member can clear their ETA without
      // wiping their last-known location. Default location_captured_at to NOW()
      // when a position arrives without an explicit (offline-stamped) capturedAt.
      const hasPosition = data.latitude !== undefined && data.latitude !== null;
      await pool.query(
        `
        INSERT INTO
          crew_member_status (
            crew_id,
            user_id,
            status,
            target_meeting_point_id,
            eta_minutes,
            note,
            latitude,
            longitude,
            location_captured_at,
            updated_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (crew_id, user_id) DO UPDATE SET
          status = EXCLUDED.status,
          target_meeting_point_id = EXCLUDED.target_meeting_point_id,
          eta_minutes = EXCLUDED.eta_minutes,
          note = EXCLUDED.note,
          latitude = COALESCE(EXCLUDED.latitude, crew_member_status.latitude),
          longitude = COALESCE(EXCLUDED.longitude, crew_member_status.longitude),
          location_captured_at = COALESCE(
            EXCLUDED.location_captured_at,
            crew_member_status.location_captured_at
          ),
          updated_at = NOW()
      `,
        [
          data.crewId,
          data.userId,
          data.status ?? null,
          data.targetMeetingPointId ?? null,
          data.etaMinutes ?? null,
          data.note ?? null,
          hasPosition ? data.latitude : null,
          hasPosition ? (data.longitude ?? null) : null,
          hasPosition ? (data.locationCapturedAt ?? null) : null,
        ],
      );
      const result = await pool.query(
        `
        SELECT
          crew_id,
          user_id,
          status,
          target_meeting_point_id,
          eta_minutes,
          note,
          latitude,
          longitude,
          location_captured_at,
          updated_at
        FROM
          crew_member_status
        WHERE
          crew_id = $1
          AND user_id = $2
      `,
        [data.crewId, data.userId],
      );
      return result.rows[0] || null;
    },

    async listByCrew(crewId: string) {
      const result = await pool.query(
        `
        SELECT
          s.crew_id,
          s.user_id,
          s.status,
          s.target_meeting_point_id,
          s.eta_minutes,
          s.note,
          s.latitude,
          s.longitude,
          s.location_captured_at,
          s.updated_at,
          u.username,
          u.display_name AS name,
          u.avatar_key AS avatar_key,
          u.avatar_version AS avatar_version
        FROM
          crew_member_status s
          JOIN users u ON u.id = s.user_id
          AND u.deleted_at IS NULL
        WHERE
          s.crew_id = $1
        ORDER BY
          s.updated_at DESC
      `,
        [crewId],
      );
      return result.rows;
    },
  };

  return { crews, topicSubscriptions, meetingPoints, crewPacking, crewRides, crewStatus };
}
