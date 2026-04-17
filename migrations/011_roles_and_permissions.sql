-- Migration 011: Role-based access control
-- Replaces the separate ADMIN_USER/ADMIN_PASSWORD env-var authentication
-- with a proper roles & permissions system tied to user accounts.

-- Roles table (extensible: user, admin, moderator, etc.)
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction table: which users have which roles
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by TEXT,  -- user_id of who granted, NULL for system-seeded
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- Seed default roles
INSERT INTO roles (name, description) VALUES
  ('user', 'Standard user — can create profiles, pick sets, chat'),
  ('moderator', 'Can moderate chat, manage reports'),
  ('admin', 'Full administrative access — user management, festival CRUD, analytics')
ON CONFLICT (name) DO NOTHING;

-- Grant admin role to user 'asir' (the app owner)
INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
SELECT u.id, r.id, NULL, NOW()
FROM users u, roles r
WHERE u.username = 'asir' AND r.name = 'admin'
  AND u.deleted_at IS NULL
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Clean out admin session rows (no longer needed for auth).
-- Reset tokens that were stored here are now handled by password_reset_tokens.
-- Keep the table for one release cycle, then drop in migration 012.
DELETE FROM admin_sessions WHERE token NOT LIKE 'reset:%';
