-- DB-05: Change CASCADE to RESTRICT on FKs referencing soft-deleted tables.
--
-- Both `users` and `festivals` use soft-delete (SET deleted_at), so the
-- CASCADE action never fires by design. Changing to RESTRICT prevents
-- accidental hard-DELETE from silently wiping all child data. The
-- application-level cascade in routes/account.js handles soft-delete
-- propagation (device_tokens, festival_profiles, refresh_tokens, etc.).
--
-- Idempotent: each ALTER is wrapped so that dropping a non-existent
-- constraint is a no-op, and re-adding an existing one also succeeds.

DO $$ BEGIN
  ALTER TABLE calendar_tokens DROP CONSTRAINT IF EXISTS calendar_tokens_user_id_fkey;
  ALTER TABLE calendar_tokens ADD CONSTRAINT calendar_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE crew_activity DROP CONSTRAINT IF EXISTS crew_activity_user_id_fkey;
  ALTER TABLE crew_activity ADD CONSTRAINT crew_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE crew_expenses DROP CONSTRAINT IF EXISTS crew_expenses_paid_by_fkey;
  ALTER TABLE crew_expenses ADD CONSTRAINT crew_expenses_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE crew_members DROP CONSTRAINT IF EXISTS crew_members_user_id_fkey;
  ALTER TABLE crew_members ADD CONSTRAINT crew_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE crews DROP CONSTRAINT IF EXISTS crews_created_by_fkey;
  ALTER TABLE crews ADD CONSTRAINT crews_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE device_tokens DROP CONSTRAINT IF EXISTS device_tokens_user_id_fkey;
  ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE email_verification_tokens DROP CONSTRAINT IF EXISTS email_verification_tokens_user_id_fkey;
  ALTER TABLE email_verification_tokens ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE festival_profiles DROP CONSTRAINT IF EXISTS festival_profiles_user_id_fkey;
  ALTER TABLE festival_profiles ADD CONSTRAINT festival_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE login_failures DROP CONSTRAINT IF EXISTS login_failures_user_id_fkey;
  ALTER TABLE login_failures ADD CONSTRAINT login_failures_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notification_counts DROP CONSTRAINT IF EXISTS notification_counts_user_id_fkey;
  ALTER TABLE notification_counts ADD CONSTRAINT notification_counts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_user_id_fkey;
  ALTER TABLE notification_log ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_user_id_fkey;
  ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notification_topic_subs DROP CONSTRAINT IF EXISTS notification_topic_subs_user_id_fkey;
  ALTER TABLE notification_topic_subs ADD CONSTRAINT notification_topic_subs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_user_id_fkey;
  ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_user_id_fkey;
  ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE set_ratings DROP CONSTRAINT IF EXISTS set_ratings_user_id_fkey;
  ALTER TABLE set_ratings ADD CONSTRAINT set_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
  ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey;
  ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── festivals-referencing FKs ──────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE calendar_tokens DROP CONSTRAINT IF EXISTS calendar_tokens_festival_id_fkey;
  ALTER TABLE calendar_tokens ADD CONSTRAINT calendar_tokens_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE crews DROP CONSTRAINT IF EXISTS crews_festival_id_fkey;
  ALTER TABLE crews ADD CONSTRAINT crews_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE festival_days DROP CONSTRAINT IF EXISTS festival_days_festival_id_fkey;
  ALTER TABLE festival_days ADD CONSTRAINT festival_days_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE festival_profiles DROP CONSTRAINT IF EXISTS festival_profiles_festival_id_fkey;
  ALTER TABLE festival_profiles ADD CONSTRAINT festival_profiles_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE festival_sets DROP CONSTRAINT IF EXISTS festival_sets_festival_id_fkey;
  ALTER TABLE festival_sets ADD CONSTRAINT festival_sets_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE festival_stages DROP CONSTRAINT IF EXISTS festival_stages_festival_id_fkey;
  ALTER TABLE festival_stages ADD CONSTRAINT festival_stages_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notification_counts DROP CONSTRAINT IF EXISTS notification_counts_festival_id_fkey;
  ALTER TABLE notification_counts ADD CONSTRAINT notification_counts_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notification_topic_subs DROP CONSTRAINT IF EXISTS notification_topic_subs_festival_id_fkey;
  ALTER TABLE notification_topic_subs ADD CONSTRAINT notification_topic_subs_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.schema_migrations (version, name, applied_at)
VALUES (31, '031_fk_cascade_to_restrict', NOW())
ON CONFLICT DO NOTHING;
