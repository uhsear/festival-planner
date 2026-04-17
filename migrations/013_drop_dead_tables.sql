-- 013: Drop dead tables from removed features (chat v1.10, reminders phase 1)
-- All tables confirmed 0 rows with no foreign key references.
-- Reversible: re-create from migrations 004_postgresql_baseline.sql if ever needed.

DROP TABLE IF EXISTS festival_profile_reminders;
DROP TABLE IF EXISTS festival_messages;
DROP TABLE IF EXISTS message_sequences;
DROP TABLE IF EXISTS admin_sessions;
