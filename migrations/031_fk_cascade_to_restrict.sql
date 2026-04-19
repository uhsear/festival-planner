-- DB-05: Change CASCADE to RESTRICT on FKs referencing soft-deleted tables.
--
-- Both `users` and `festivals` use soft-delete (SET deleted_at), so the
-- CASCADE action never fires by design. Changing to RESTRICT prevents
-- accidental hard-DELETE from silently wiping all child data. The
-- application-level cascade in routes/account.js handles soft-delete
-- propagation (device_tokens, festival_profiles, refresh_tokens, etc.).

-- ── users-referencing FKs ──────────────────────────────────────────────

ALTER TABLE calendar_tokens DROP CONSTRAINT calendar_tokens_user_id_fkey,
  ADD CONSTRAINT calendar_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE crew_activity DROP CONSTRAINT crew_activity_user_id_fkey,
  ADD CONSTRAINT crew_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE crew_expenses DROP CONSTRAINT crew_expenses_paid_by_fkey,
  ADD CONSTRAINT crew_expenses_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE crew_members DROP CONSTRAINT crew_members_user_id_fkey,
  ADD CONSTRAINT crew_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE crews DROP CONSTRAINT crews_created_by_fkey,
  ADD CONSTRAINT crews_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE device_tokens DROP CONSTRAINT device_tokens_user_id_fkey,
  ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE email_verification_tokens DROP CONSTRAINT email_verification_tokens_user_id_fkey,
  ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE festival_profiles DROP CONSTRAINT festival_profiles_user_id_fkey,
  ADD CONSTRAINT festival_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE login_failures DROP CONSTRAINT login_failures_user_id_fkey,
  ADD CONSTRAINT login_failures_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE notification_counts DROP CONSTRAINT notification_counts_user_id_fkey,
  ADD CONSTRAINT notification_counts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE notification_log DROP CONSTRAINT notification_log_user_id_fkey,
  ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_user_id_fkey,
  ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE notification_topic_subs DROP CONSTRAINT notification_topic_subs_user_id_fkey,
  ADD CONSTRAINT notification_topic_subs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE password_reset_tokens DROP CONSTRAINT password_reset_tokens_user_id_fkey,
  ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_user_id_fkey,
  ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE set_ratings DROP CONSTRAINT set_ratings_user_id_fkey,
  ADD CONSTRAINT set_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE user_roles DROP CONSTRAINT user_roles_user_id_fkey,
  ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_user_id_fkey,
  ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ── festivals-referencing FKs ──────────────────────────────────────────

ALTER TABLE calendar_tokens DROP CONSTRAINT calendar_tokens_festival_id_fkey,
  ADD CONSTRAINT calendar_tokens_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE crews DROP CONSTRAINT crews_festival_id_fkey,
  ADD CONSTRAINT crews_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE festival_days DROP CONSTRAINT festival_days_festival_id_fkey,
  ADD CONSTRAINT festival_days_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE festival_profiles DROP CONSTRAINT festival_profiles_festival_id_fkey,
  ADD CONSTRAINT festival_profiles_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE festival_sets DROP CONSTRAINT festival_sets_festival_id_fkey,
  ADD CONSTRAINT festival_sets_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE festival_stages DROP CONSTRAINT festival_stages_festival_id_fkey,
  ADD CONSTRAINT festival_stages_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE notification_counts DROP CONSTRAINT notification_counts_festival_id_fkey,
  ADD CONSTRAINT notification_counts_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

ALTER TABLE notification_topic_subs DROP CONSTRAINT notification_topic_subs_festival_id_fkey,
  ADD CONSTRAINT notification_topic_subs_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES festivals(id) ON DELETE RESTRICT;

INSERT INTO public.schema_migrations (version, name, applied_at)
SELECT COALESCE(MAX(version), 0) + 1, '031_fk_cascade_to_restrict', NOW()
FROM public.schema_migrations
WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = '031_fk_cascade_to_restrict');
