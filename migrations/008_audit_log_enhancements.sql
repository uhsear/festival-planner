-- Audit Log Enhancements — Add columns, indexes, and aliases
-- Adds user_agent, request_id, status for better traceability
-- Adds resource_type/resource_id aliases for target_type/target_id

ALTER TABLE audit_log
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS request_id UUID,
ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'success';

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created_at
ON audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_request_id
ON audit_log(request_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created_at
ON audit_log(actor_id, created_at DESC);

-- Add views for resource_type/resource_id aliases (no column rename needed)
-- These allow queries to use resource_type/resource_id interchangeably
CREATE OR REPLACE VIEW audit_log_view AS
SELECT
  id,
  actor_type,
  actor_id,
  action,
  target_type AS resource_type,
  target_id AS resource_id,
  target_type,
  target_id,
  details_json,
  ip,
  user_agent,
  request_id,
  status,
  created_at
FROM audit_log;
