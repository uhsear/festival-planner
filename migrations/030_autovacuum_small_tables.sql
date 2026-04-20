-- Lower autovacuum thresholds on small tables that never hit the default
-- threshold of 50 dead tuples. Without this, dead tuples accumulate
-- indefinitely and the planner uses stale statistics.

ALTER TABLE calendar_tokens          SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crew_activity            SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crew_expenses            SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crew_poll_votes          SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE set_ratings              SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE notification_preferences SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE password_reset_tokens    SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE festival_profile_notes   SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE login_failures           SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE email_verification_tokens SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crews                    SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crew_meeting_points      SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crew_polls               SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE crew_members             SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE festivals                SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE festival_stages          SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE festival_days            SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE roles                    SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE notification_topic_subs  SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE notification_log         SET (autovacuum_vacuum_threshold = 10, autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_threshold = 10, autovacuum_analyze_scale_factor = 0.05);

INSERT INTO public.schema_migrations (version, name, applied_at)
VALUES (30, '030_autovacuum_small_tables', NOW())
ON CONFLICT DO NOTHING;
