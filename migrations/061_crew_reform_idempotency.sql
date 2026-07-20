-- 061_crew_reform_idempotency.sql
-- POST /crews/:crewId/reform promised idempotency ("re-running returns the same
-- reformed crew, not a duplicate") but enforced it with a read-then-create: two
-- concurrent or retried requests both miss the read and both INSERT, producing
-- two crews reformed FROM the same source INTO the same festival by the same
-- user. Make the invariant the DB's, not the read's, with a partial UNIQUE
-- index on the route's exact dedup predicate; routes/crews.ts absorbs the
-- resulting 23505 by re-reading and reusing the winner.
--
-- KEY IS (created_by, festival_id, reformed_from) — NOT (created_by,
-- reformed_from): the same user reforming ONE source crew into TWO different
-- festivals is legitimate and must stay allowed; only a second reform of the
-- same source into the SAME festival by the same user is the duplicate.
-- WHERE reformed_from IS NOT NULL keeps ordinary crews (POST /crews always
-- writes reformed_from NULL) entirely outside the index and unaffected.
--
-- Additive, forward-only, idempotent (IF NOT EXISTS + set-based heal that finds
-- nothing on re-run). Runs non-CONCURRENTLY so the heal below and the index
-- build commit together in the runner's single transaction (lib/planner-db-pg.ts
-- applies the whole body in one BEGIN/COMMIT) — crews is small, so the brief
-- SHARE lock is a non-event.
-- ponytail: go CONCURRENTLY only if crews ever grows enough for the write pause
-- to matter; the heal would then have to move to its own earlier migration.

-- ── Heal any pre-existing duplicates BEFORE building the unique index ──
-- A unique-index build aborts if duplicates already exist, and a failed
-- migration aborts boot (planner-db-pg.ts) — so collapse each duplicate group
-- first. Winner = earliest-created crew in the group (created_at, then id; both
-- deterministic). Merge every loser's members into the winner first (ON CONFLICT
-- keeps the winner's own owner/member rows) so a member who only ever joined the
-- losing crew is never dropped, THEN delete the losers. Remaining loser child
-- rows cascade on the crew delete — every crew child FK is ON DELETE CASCADE and
-- the reformed_from self-FK is ON DELETE SET NULL — matching the app's own bare
-- `DELETE FROM crews` delete path (lib/db/stores/crews.ts).
-- ponytail: only crew_members are merged; a loser's polls/expenses/rides/etc.
-- cascade away. A millisecond-race duplicate has none (its roster was planned
-- identically to the winner's from the same source), and a cross-crew merge of
-- those tables has no correct semantics — revisit only if a real non-race
-- duplicate is ever found.
INSERT INTO crew_members (crew_id, user_id, role, joined_at)
SELECT ranked.winner_id, cm.user_id, cm.role, cm.joined_at
FROM (
  SELECT
    id AS loser_id,
    ROW_NUMBER() OVER (
      PARTITION BY created_by, festival_id, reformed_from
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY created_by, festival_id, reformed_from
      ORDER BY created_at ASC, id ASC
    ) AS winner_id
  FROM crews
  WHERE reformed_from IS NOT NULL
) ranked
JOIN crew_members cm ON cm.crew_id = ranked.loser_id
WHERE ranked.rn > 1
ON CONFLICT (crew_id, user_id) DO NOTHING;

DELETE FROM crews
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY created_by, festival_id, reformed_from
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM crews
    WHERE reformed_from IS NOT NULL
  ) dupes
  WHERE dupes.rn > 1
);

-- ── The invariant the route relies on ──
-- Partial UNIQUE on the reform dedup predicate. A second concurrent reform now
-- BLOCKS on this key until the first commits, then raises 23505 — which
-- routes/crews.ts turns into "return the winning crew" instead of a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS crews_reform_idem_uidx
  ON crews (created_by, festival_id, reformed_from)
  WHERE reformed_from IS NOT NULL;
