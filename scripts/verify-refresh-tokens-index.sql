-- verify-refresh-tokens-index.sql
-- Verifies that refresh_tokens lookups use idx_refresh_tokens_token after ANALYZE.
-- Context: audit flagged refresh_tokens as 1440:1 seq_scan:idx_scan before migration 027.
-- Run as the app DB user against the prod/staging database.

-- 1. Confirm the index exists.
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'refresh_tokens'
  AND indexname = 'idx_refresh_tokens_token';

-- 2. Refresh planner stats so EXPLAIN reflects current data distribution.
ANALYZE refresh_tokens;

-- 3. Plan check for the hot lookup path.
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM refresh_tokens WHERE token = 'fake-token-for-plan-check-only';
-- Expected: Index Scan using idx_refresh_tokens_token
-- If you see Seq Scan, investigate whether the hot query path uses a type coercion
-- (e.g., token::text vs varchar), wildcard (LIKE 'foo%'), or a different column name
-- (e.g., token_hash) than the one indexed.

-- 4. Sanity check: current seq_scan vs idx_scan ratio on the table.
SELECT
  relname,
  seq_scan,
  idx_scan,
  CASE WHEN idx_scan = 0 THEN NULL
       ELSE round((seq_scan::numeric / idx_scan), 2)
  END AS seq_to_idx_ratio
FROM pg_stat_user_tables
WHERE relname = 'refresh_tokens';
