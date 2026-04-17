-- Migration 005: Add link_url column to festival_sets table
-- Allows storing a single URL/link per festival set (useful for artist links, Spotify, YouTube, etc.)

ALTER TABLE festival_sets ADD COLUMN IF NOT EXISTS link_url TEXT;
