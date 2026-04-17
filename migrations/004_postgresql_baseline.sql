-- Festival Planner PostgreSQL Baseline Schema
-- This schema defines all tables with PostgreSQL-native types
-- Run after data migration from SQLite

-- Enable CITEXT extension for case-insensitive usernames
CREATE EXTENSION IF NOT EXISTS citext;

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username CITEXT NOT NULL UNIQUE,
  password_hash TEXT,
  avatar_key TEXT,
  avatar_version TEXT,
  avatar_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT,
  created_at BIGINT,
  last_access BIGINT
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_created_at ON user_sessions(created_at);

-- Admin sessions table
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at BIGINT,
  last_access BIGINT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_created_at ON admin_sessions(created_at);

-- Festivals table
CREATE TABLE IF NOT EXISTS festivals (
  id TEXT PRIMARY KEY,
  name TEXT,
  location TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_festivals_deleted_at ON festivals(deleted_at);
CREATE INDEX IF NOT EXISTS idx_festivals_created_at ON festivals(created_at);

-- Festival stages
CREATE TABLE IF NOT EXISTS festival_stages (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT,
  color TEXT,
  sort_order INTEGER,
  PRIMARY KEY (festival_id, id)
);

CREATE INDEX IF NOT EXISTS idx_festival_stages_festival_id ON festival_stages(festival_id);
CREATE INDEX IF NOT EXISTS idx_festival_stages_sort ON festival_stages(festival_id, sort_order);

-- Festival days
CREATE TABLE IF NOT EXISTS festival_days (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL,
  label TEXT,
  date TEXT,
  PRIMARY KEY (festival_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_festival_days_festival_id ON festival_days(festival_id);

-- Festival sets (performances)
CREATE TABLE IF NOT EXISTS festival_sets (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  day_index INTEGER,
  artist TEXT,
  stage_id TEXT,
  start_time TEXT,
  end_time TEXT,
  sort_order INTEGER
);

CREATE INDEX IF NOT EXISTS idx_festival_sets_festival_id ON festival_sets(festival_id);
CREATE INDEX IF NOT EXISTS idx_festival_sets_day_index ON festival_sets(day_index);
CREATE INDEX IF NOT EXISTS idx_festival_sets_sort ON festival_sets(festival_id, day_index, sort_order);
CREATE INDEX IF NOT EXISTS idx_festival_sets_artist ON festival_sets(artist);

-- Festival profiles (user's personal festival data)
CREATE TABLE IF NOT EXISTS festival_profiles (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  picks_json JSONB DEFAULT '{}',
  notes_json JSONB DEFAULT '{}',
  reminders_json JSONB DEFAULT '{}',
  live_status_json JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_festival_profiles_festival_id ON festival_profiles(festival_id);
CREATE INDEX IF NOT EXISTS idx_festival_profiles_user_id ON festival_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_festival_profiles_deleted_at ON festival_profiles(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_festival_profiles_user_festival ON festival_profiles(user_id, festival_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- Festival profile picks
CREATE TABLE IF NOT EXISTS festival_profile_picks (
  profile_id TEXT NOT NULL REFERENCES festival_profiles(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES festival_sets(id),
  priority TEXT,
  PRIMARY KEY (profile_id, set_id)
);

CREATE INDEX IF NOT EXISTS idx_festival_profile_picks_set_id ON festival_profile_picks(set_id);

-- Festival profile notes
CREATE TABLE IF NOT EXISTS festival_profile_notes (
  profile_id TEXT NOT NULL REFERENCES festival_profiles(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES festival_sets(id),
  text TEXT,
  PRIMARY KEY (profile_id, set_id)
);

CREATE INDEX IF NOT EXISTS idx_festival_profile_notes_set_id ON festival_profile_notes(set_id);

-- Festival profile reminders
CREATE TABLE IF NOT EXISTS festival_profile_reminders (
  profile_id TEXT NOT NULL REFERENCES festival_profiles(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES festival_sets(id),
  minutes_before INTEGER,
  PRIMARY KEY (profile_id, set_id)
);

CREATE INDEX IF NOT EXISTS idx_festival_profile_reminders_set_id ON festival_profile_reminders(set_id);

-- Crews (user groups for festivals)
CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  name TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE,
  max_members INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crews_festival_id ON crews(festival_id);
CREATE INDEX IF NOT EXISTS idx_crews_created_by ON crews(created_by);
CREATE INDEX IF NOT EXISTS idx_crews_invite_code ON crews(invite_code);

-- Crew members
CREATE TABLE IF NOT EXISTS crew_members (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (crew_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crew_members_user_id ON crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_crew_id ON crew_members(crew_id);

-- Festival messages / chat
CREATE TABLE IF NOT EXISTS festival_messages (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  text TEXT,
  timestamp TIMESTAMPTZ,
  sort_order INTEGER,
  reactions_json JSONB,
  deleted_at TIMESTAMPTZ,
  sequence INTEGER,
  crew_id TEXT REFERENCES crews(id) ON DELETE CASCADE,
  client_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_festival_messages_festival_id ON festival_messages(festival_id);
CREATE INDEX IF NOT EXISTS idx_festival_messages_user_id ON festival_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_festival_messages_crew_id ON festival_messages(crew_id);
CREATE INDEX IF NOT EXISTS idx_festival_messages_timestamp ON festival_messages(festival_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_festival_messages_sequence ON festival_messages(festival_id, sequence);
CREATE INDEX IF NOT EXISTS idx_festival_messages_deleted_at ON festival_messages(deleted_at);

-- Message sequence counter per festival
CREATE TABLE IF NOT EXISTS message_sequences (
  festival_id TEXT PRIMARY KEY REFERENCES festivals(id) ON DELETE CASCADE,
  next_sequence INTEGER DEFAULT 1
);

-- Device tokens for push notifications
CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  platform TEXT DEFAULT 'web',
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '90 days'
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_device_tokens_expires_at ON device_tokens(expires_at);

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  crew_updates INTEGER DEFAULT 1,
  set_reminders INTEGER DEFAULT 1,
  schedule_changes INTEGER DEFAULT 1,
  chat_messages INTEGER DEFAULT 1,
  dnd_start TEXT,
  dnd_end TEXT
);

-- Notification log for audit trail
CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT,
  title TEXT,
  body TEXT,
  data_json JSONB,
  status TEXT DEFAULT 'sent',
  platform TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user_id ON notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at ON notification_log(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log(status);

-- Notification counts per user/festival
CREATE TABLE IF NOT EXISTS notification_counts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  unread_chat INTEGER DEFAULT 0,
  unread_updates INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, festival_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_counts_user_id ON notification_counts(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_counts_festival_id ON notification_counts(festival_id);

-- Notification topic subscriptions
CREATE TABLE IF NOT EXISTS notification_topic_subs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  subscribed INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, festival_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_notification_topic_subs_user_id ON notification_topic_subs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_topic_subs_festival_id ON notification_topic_subs(festival_id);

-- Audit log for security and compliance
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT,
  actor_id TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  details_json JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_id ON audit_log(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
