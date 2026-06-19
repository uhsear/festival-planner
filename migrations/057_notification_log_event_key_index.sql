-- 057_notification_log_event_key_index.sql
-- notification_log (user_id, type, data_json->>'eventKey') index for the M3
-- re-engagement dedup fan-out.
--
-- The re-engagement triggers (wrap_ready / lineup_drop / crew_reformed) dedup
-- recipients against notification_log on the (user_id, type, eventKey) tuple —
-- now in ONE batched query per event (notificationLog.existsForEvents) instead
-- of one read per recipient. That batch filters on user_id = ANY(...) plus
-- type plus the JSON-extracted eventKey; without a matching index Postgres
-- falls back to scanning notification_log for every fan-out.
--
-- The expression index on (user_id, type, (data_json->>'eventKey')) lets the
-- planner satisfy the existsForEvent / existsForEvents predicate directly. The
-- single-user existsForEvent (other callers) benefits from the same index.
--
-- Additive + idempotent per the repo migration convention (the app-managed
-- runner in lib/planner-db-pg.ts records the version — no manual footer). Plain
-- (not CONCURRENTLY) because the runner may wrap migrations in a transaction.
CREATE INDEX IF NOT EXISTS idx_notification_log_event_key
  ON notification_log (user_id, type, (data_json->>'eventKey'));
