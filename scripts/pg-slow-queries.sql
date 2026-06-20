/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */

/**
 * PostgreSQL Slow Query Logging Configuration
 *
 * This script enables query logging in PostgreSQL to identify slow queries
 * that need optimization or indexing. Run as superuser on your PostgreSQL instance.
 *
 * USAGE:
 *   1. As PostgreSQL superuser:
 *      psql -U postgres -d festival_planner -f scripts/pg-slow-queries.sql
 *
 *   2. Or manually via psql:
 *      ALTER SYSTEM SET log_min_duration_statement = 1000;
 *      SELECT pg_reload_conf();
 *
 *   3. Verify settings:
 *      SHOW log_min_duration_statement;
 *      SHOW log_directory;
 *      SHOW log_filename;
 */

-- Enable slow query logging for queries taking > 1000ms (1 second)
ALTER SYSTEM SET log_min_duration_statement = 1000;

-- Log queries that perform sequential scans (helpful for identifying missing indexes)
ALTER SYSTEM SET log_statement = 'all';

-- Include query duration in logs (for analysis)
ALTER SYSTEM SET log_duration = on;

-- Include connection info in logs
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;

-- Log locks (to identify contention)
ALTER SYSTEM SET log_lock_waits = on;

-- Set log file location (adjust path for your PostgreSQL installation)
-- Default: /var/log/postgresql/
ALTER SYSTEM SET log_directory = '/var/log/postgresql';

-- Specify log file naming pattern (rotates daily)
ALTER SYSTEM SET log_filename = 'postgresql-%a.log';

-- Keep logs for 7 days
ALTER SYSTEM SET log_truncate_on_rotation = on;

-- Format logs for easier parsing
ALTER SYSTEM SET log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ';

-- Reload PostgreSQL configuration (same as: pg_ctl reload -D /path/to/pgdata)
SELECT pg_reload_conf();

-- Verify settings
SELECT name, setting FROM pg_settings
WHERE name IN (
  'log_min_duration_statement',
  'log_statement',
  'log_duration',
  'log_directory',
  'log_filename'
)
ORDER BY name;

/**
 * OUTPUT EXAMPLE:
 *
 *   2026-03-22 19:30:45.123 [12345]: [1-1] user=app,db=festival_planner,app=psql,client=127.0.0.1
 *   statement: SELECT * FROM profiles WHERE festival_id = $1 AND user_id = $2;
 *   duration: 2345.123 ms
 *
 * ANALYSIS STEPS:
 *
 * 1. Identify slow queries:
 *    grep "duration:" /var/log/postgresql/postgresql-*.log | sort -t: -k3 -rn | head -20
 *
 * 2. Run EXPLAIN ANALYZE on the slow query to find missing indexes:
 *    EXPLAIN ANALYZE SELECT * FROM profiles WHERE festival_id = $1 AND user_id = $2;
 *
 * 3. If you see "Seq Scan" instead of "Index Scan", consider adding an index:
 *    CREATE INDEX idx_profiles_festival_user ON profiles(festival_id, user_id);
 *
 * DISABLING SLOW QUERY LOGS (when done with analysis):
 *
 *   ALTER SYSTEM SET log_min_duration_statement = -1;
 *   SELECT pg_reload_conf();
 */

-- Optional: Create a monitoring view to query logs directly (requires csvlog format)
-- This is advanced; implement if you switch to log_format = 'csv'
-- CREATE TABLE IF NOT EXISTS pg_log (
--   log_time timestamp,
--   user_name varchar,
--   database_name varchar,
--   process_id integer,
--   connection_from varchar,
--   session_id varchar,
--   session_line_num bigint,
--   command_tag varchar,
--   session_start_time timestamp,
--   virtual_transaction_id varchar,
--   transaction_id bigint,
--   error_severity varchar,
--   sql_state_code varchar,
--   message text,
--   detail text,
--   hint text,
--   internal_query text,
--   internal_query_pos integer,
--   context text,
--   query text,
--   query_pos integer,
--   location text,
--   application_name varchar,
--   backend_type varchar
-- );
