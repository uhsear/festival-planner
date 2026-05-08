-- Migration 040: Add missing indexes for notification-related tables
-- Identified by DB query optimization audit 2026-05-08

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_tokens_user_id
  ON device_tokens (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_log_user_created
  ON notification_log (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_counts_user_id
  ON notification_counts (user_id);
