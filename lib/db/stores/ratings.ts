import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Crew wrap — superlative aggregation (M3)
// ---------------------------------------------------------------------------

/** A crew member, as surfaced to the requester (no PII beyond what crew
 *  membership already exposes: id + display name/username). */
export interface CrewWrapMember {
  userId: string;
  name: string;
}

/** One member's high-rated (≥4★) set for a festival. */
export interface CrewHighRating {
  userId: string;
  setId: string;
  artist: string | null;
  rating: number;
}

/** A member's net ledger position, in dollars (from expenses.getBalances). */
export interface CrewWrapBalance {
  userId: string;
  username: string;
  balance: number;
}

export interface CrewWrapTopSet {
  setId: string;
  artist: string | null;
  rating: number;
}

export interface CrewWrapOverlapPair {
  aUserId: string;
  aName: string;
  bUserId: string;
  bName: string;
  /** Count of sets BOTH members rated ≥4★. */
  shared: number;
  /** The shared sets (artist names), capped for display. */
  sharedSets: string[];
}

export interface CrewWrapSeenTogether {
  setId: string;
  artist: string | null;
  /** How many members rated this set ≥4★. */
  count: number;
}

export interface CrewWrapMemberSummary {
  userId: string;
  name: string;
  topSets: CrewWrapTopSet[];
}

export interface CrewWrap {
  crewId: string;
  festivalId: string;
  memberCount: number;
  members: CrewWrapMember[];
  /** The most-overlapping member pair, or null for empty/single-member crews. */
  topOverlap: CrewWrapOverlapPair | null;
  /** All non-zero-overlap pairs, sorted by shared count desc. */
  overlapMatrix: CrewWrapOverlapPair[];
  /** Sets rated ≥4★ by ≥2 members, sorted by count desc. */
  setsSeenTogether: CrewWrapSeenTogether[];
  /** Sum of all crew expense amounts, in dollars. */
  totalSplit: number;
  /** The member who fronted the most (largest positive balance), or null. */
  biggestSpender: { userId: string; name: string; amount: number } | null;
  /** Per-member top-3 high-rated sets. */
  perMember: CrewWrapMemberSummary[];
}

/**
 * Pure superlative math for the crew wrap. Kept DB-free so it can be unit
 * tested directly. All inputs are already scoped to (crewId, festivalId) and
 * to crew members the requester can see — there is no PII here beyond names.
 *
 * Degrades gracefully:
 *   - empty crew  → counts 0, null superlatives, no NaN
 *   - single member → no overlap pairs / no sets-seen-together (needs ≥2)
 */
export function aggregateCrewWrap(
  crewId: string,
  festivalId: string,
  members: CrewWrapMember[],
  highRatings: CrewHighRating[],
  expenses: { amount: number | string }[],
  balances: CrewWrapBalance[],
): CrewWrap {
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));

  // Group high ratings by member and by set.
  const setsByMember = new Map<string, Map<string, CrewHighRating>>();
  const membersBySet = new Map<string, Set<string>>();
  const artistOfSet = new Map<string, string | null>();
  for (const r of highRatings) {
    // Defensive: ignore ratings from non-members (shouldn't happen given the
    // SQL join, but keeps the pure function honest if fed loose data).
    if (!nameOf.has(r.userId)) continue;
    if (!setsByMember.has(r.userId)) setsByMember.set(r.userId, new Map());
    setsByMember.get(r.userId)!.set(r.setId, r);
    if (!membersBySet.has(r.setId)) membersBySet.set(r.setId, new Set());
    membersBySet.get(r.setId)!.add(r.userId);
    if (!artistOfSet.has(r.setId)) artistOfSet.set(r.setId, r.artist ?? null);
  }

  // Pairwise overlap matrix: for each unordered member pair, count the sets
  // both rated ≥4★. O(M²·avgSets) but M is a crew (small, bounded).
  const overlapMatrix: CrewWrapOverlapPair[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      const aSets = setsByMember.get(a.userId);
      const bSets = setsByMember.get(b.userId);
      if (!aSets || !bSets) continue;
      const sharedSets: string[] = [];
      // Iterate the smaller set for efficiency.
      const [small, large] = aSets.size <= bSets.size ? [aSets, bSets] : [bSets, aSets];
      for (const setId of small.keys()) {
        if (large.has(setId)) {
          sharedSets.push(artistOfSet.get(setId) || setId);
        }
      }
      if (sharedSets.length > 0) {
        overlapMatrix.push({
          aUserId: a.userId,
          aName: a.name,
          bUserId: b.userId,
          bName: b.name,
          shared: sharedSets.length,
          sharedSets: sharedSets.slice(0, 5),
        });
      }
    }
  }
  // Stable sort: most overlap first, then by names so output is deterministic.
  overlapMatrix.sort((x, y) => y.shared - x.shared || x.aName.localeCompare(y.aName) || x.bName.localeCompare(y.bName));
  const topOverlap = overlapMatrix[0] ?? null;

  // Sets seen together: rated ≥4★ by ≥2 members.
  const setsSeenTogether: CrewWrapSeenTogether[] = [];
  for (const [setId, memberSet] of membersBySet) {
    if (memberSet.size >= 2) {
      setsSeenTogether.push({
        setId,
        artist: artistOfSet.get(setId) ?? null,
        count: memberSet.size,
      });
    }
  }
  setsSeenTogether.sort((x, y) => y.count - x.count || (x.artist || x.setId).localeCompare(y.artist || y.setId));

  // Total split: sum of every crew expense amount (NUMERIC arrives as a string
  // from pg, so coerce with Number). Round to cents to avoid float drift.
  const totalSplitCents = expenses.reduce((sum, e) => {
    const cents = Math.round(Number(e.amount) * 100);
    return Number.isFinite(cents) ? sum + cents : sum;
  }, 0);
  const totalSplit = totalSplitCents / 100;

  // Biggest spender: largest positive balance (fronted the most net). A crew
  // with no expenses / all-zero balances has no biggest spender.
  let biggestSpender: CrewWrap['biggestSpender'] = null;
  let best = 0;
  for (const b of balances) {
    if (b.balance > best) {
      best = b.balance;
      biggestSpender = {
        userId: b.userId,
        name: nameOf.get(b.userId) ?? b.username,
        amount: b.balance,
      };
    }
  }

  // Per-member top-3 high-rated sets (rating desc, then artist for stability).
  const perMember: CrewWrapMemberSummary[] = members.map((m) => {
    const sets = Array.from(setsByMember.get(m.userId)?.values() ?? [])
      .sort((x, y) => y.rating - x.rating || (x.artist || x.setId).localeCompare(y.artist || y.setId))
      .slice(0, 3)
      .map((r) => ({ setId: r.setId, artist: r.artist ?? null, rating: r.rating }));
    return { userId: m.userId, name: m.name, topSets: sets };
  });

  return {
    crewId,
    festivalId,
    memberCount: members.length,
    members,
    topOverlap,
    overlapMatrix,
    setsSeenTogether,
    totalSplit,
    biggestSpender,
    perMember,
  };
}

export function createRatingsStore(pool: Pool) {
  return {
    async upsert(userId: string, setId: string, rating: number, note: string = '') {
      const result = await pool.query(
        `
        INSERT INTO set_ratings (user_id, set_id, rating, note, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, set_id) DO UPDATE SET
          rating = EXCLUDED.rating,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING id, user_id AS "userId", set_id AS "setId", rating, note, created_at AS "createdAt", updated_at AS "updatedAt"
      `,
        [userId, setId, rating, note],
      );
      return result.rows[0];
    },

    async getByUser(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          r.id,
          r.set_id AS "setId",
          r.rating,
          r.note,
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt",
          s.artist,
          s.stage_id AS "stageId",
          s.start_time AS "startTime",
          s.end_time AS "endTime",
          s.day_index AS "dayIndex"
        FROM
          set_ratings r
          JOIN festival_sets s ON s.id = r.set_id
        WHERE
          r.user_id = $1
          AND s.festival_id = $2
        ORDER BY
          r.rating DESC,
          s.day_index,
          s.start_time
      `,
        [userId, festivalId],
      );
      return result.rows;
    },

    async getByFestival(festivalId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [festivalId, limit + 1];
      let having = '';
      if (cursor) {
        having = 'HAVING r.set_id > $3';
        params.push(cursor);
      }
      const result = await pool.query(
        `
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
      `,
        params,
      );
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
      const result = await pool.query(
        `
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
      `,
        params,
      );
      const hasMore = result.rows.length > limit;
      if (hasMore) result.rows.pop();
      return {
        items: result.rows,
        nextCursor: hasMore ? result.rows[result.rows.length - 1].id : null,
      };
    },

    /**
     * Crew-aware wrap superlatives (M3). Read-model only — no migration.
     *
     * Aggregates in SQL where practical:
     *   - crew roster (id + display name) in one query
     *   - every member's ≥4★ rating for this festival in one query (NOT paged
     *     in JS — the pairwise overlap needs the full high-rated set, which is
     *     bounded by crew-size × sets-rated and small in practice)
     * then folds the superlative math (overlap matrix, sets-seen-together,
     * per-member top-3) in `aggregateCrewWrap`.
     *
     * Expense aggregates (totalSplit / biggestSpender) are sourced from the
     * expenses store via the caller (route passes getByCrew + getBalances) so
     * the canonical ledger math isn't duplicated here. Both default to empty so
     * the wrap degrades gracefully when a crew has no expenses.
     *
     * Only returns data about crew members the requester can already see — the
     * route gates on crews.getMember before calling this, and we never expose
     * anything beyond names + this festival's high ratings.
     */
    async getCrewWrap(
      crewId: string,
      festivalId: string,
      {
        expenses = [],
        balances = [],
      }: {
        expenses?: { amount: number | string }[];
        balances?: CrewWrapBalance[];
      } = {},
    ): Promise<CrewWrap> {
      const [memberRes, ratingRes] = await Promise.all([
        // Roster: prefer display name, fall back to username. deleted users
        // are excluded so a removed account doesn't leak a stale row.
        pool.query(
          `
          SELECT
            cm.user_id AS "userId",
            COALESCE(NULLIF(u.display_name, ''), u.username) AS "name"
          FROM
            crew_members cm
            JOIN users u ON u.id = cm.user_id
            AND u.deleted_at IS NULL
          WHERE
            cm.crew_id = $1
          ORDER BY
            "name" ASC
        `,
          [crewId],
        ),
        // Every crew member's ≥4★ rating for this festival, scoped via the
        // crew_members join so non-members can never appear.
        pool.query(
          `
          SELECT
            r.user_id AS "userId",
            r.set_id AS "setId",
            s.artist,
            r.rating
          FROM
            set_ratings r
            JOIN festival_sets s ON s.id = r.set_id
            JOIN crew_members cm ON cm.user_id = r.user_id
            AND cm.crew_id = $1
            JOIN users u ON u.id = r.user_id
            AND u.deleted_at IS NULL
          WHERE
            s.festival_id = $2
            AND r.rating >= 4
        `,
          [crewId, festivalId],
        ),
      ]);

      return aggregateCrewWrap(
        crewId,
        festivalId,
        memberRes.rows as CrewWrapMember[],
        ratingRes.rows as CrewHighRating[],
        expenses,
        balances,
      );
    },

    async delete(userId: string, setId: string) {
      await pool.query('DELETE FROM set_ratings WHERE user_id = $1 AND set_id = $2', [userId, setId]);
    },

    async getWrapStats(userId: string, festivalId: string) {
      const result = await pool.query(
        `
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
      `,
        [userId, festivalId],
      );
      return result.rows[0] || { totalRated: 0, avgRating: 0, stagesVisited: 0, daysAttended: 0, totalHours: 0 };
    },
  };
}
