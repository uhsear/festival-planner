BEGIN;
-- Audit log: backfill NULLs and add NOT NULL with defaults
UPDATE audit_log SET action = 'unknown' WHERE action IS NULL;
UPDATE audit_log SET actor_type = 'unknown' WHERE actor_type IS NULL;
UPDATE audit_log SET target_type = 'unknown' WHERE target_type IS NULL;
ALTER TABLE audit_log ALTER COLUMN action SET DEFAULT 'unknown', ALTER COLUMN action SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN actor_type SET DEFAULT 'unknown', ALTER COLUMN actor_type SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN target_type SET DEFAULT 'unknown', ALTER COLUMN target_type SET NOT NULL;
-- NOTE: reminders_json and live_status_json are still referenced by reminder-scheduler
-- and profile serialization code. Do NOT drop until code references are removed.
INSERT INTO schema_migrations (version, name, applied_at) VALUES (25, '025_tech_debt_cleanup', NOW()) ON CONFLICT DO NOTHING;
COMMIT;
