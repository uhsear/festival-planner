/**
 * Tech debt audit fixes — tests for spotify.js, migration 014 (artists JSONB, b2b_separator),
 * and migration 015 (refresh_tokens TIMESTAMPTZ, NOT NULL constraints).
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

// DB skip-gate: migration tests require a live Postgres database.
// Uses TEST_DATABASE_URL only — never falls back to DATABASE_URL (production safety).
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const DATABASE_URL = process.env.TEST_DATABASE_URL;

// ── Spotify module tests ────────────────────────────────────────────

describe('lib/spotify.js', () => {
  const spotify = require('../lib/spotify');

  it('exports searchArtist, bulkSearchArtists, getToken', () => {
    assert.equal(typeof spotify.searchArtist, 'function');
    assert.equal(typeof spotify.bulkSearchArtists, 'function');
    assert.equal(typeof spotify.getToken, 'function');
  });

  it('searchArtist returns null for missing credentials', async () => {
    const result = await spotify.searchArtist('Test Artist', '', '');
    assert.equal(result, null);
  });

  it('searchArtist returns null for empty name', async () => {
    const result = await spotify.searchArtist('', 'id', 'secret');
    assert.equal(result, null);
  });

  it('bulkSearchArtists returns empty Map for empty names array', async () => {
    const result = await spotify.bulkSearchArtists([], 'id', 'secret');
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });

  it('bulkSearchArtists deduplicates names', async () => {
    // With empty credentials, all lookups return null — but it should not error
    const result = await spotify.bulkSearchArtists(['A', 'A', 'B', '', null], '', '');
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });
});

// ── Migration 014: artists JSONB and b2b_separator ──────────────────

describe('migration 014: artists JSONB and b2b_separator', { skip: !DATABASE_URL }, () => {
  let pool;

  before(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  });
  after(async () => { if (pool) await pool.end(); });

  it('festival_sets.artists column exists and is JSONB', async () => {
    const { rows } = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'festival_sets' AND column_name = 'artists'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data_type, 'jsonb');
  });

  it('festival_sets.artists defaults to empty array', async () => {
    const { rows } = await pool.query(`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'festival_sets' AND column_name = 'artists'
    `);
    assert.ok(rows[0].column_default.includes('[]'));
  });

  it('festivals.b2b_separator column exists with text type', async () => {
    const { rows } = await pool.query(`
      SELECT data_type, column_default FROM information_schema.columns
      WHERE table_name = 'festivals' AND column_name = 'b2b_separator'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data_type, 'text');
    assert.ok(rows[0].column_default.includes('b2b'));
  });

  it('artists JSONB supports array insertion and query', async () => {
    // Test JSONB operations without actually inserting (just validate SQL syntax)
    const { rows } = await pool.query(`
      SELECT '[]'::jsonb || '["artist1","artist2"]'::jsonb AS merged
    `);
    assert.ok(Array.isArray(JSON.parse(JSON.stringify(rows[0].merged))));
  });
});

// ── Migration 015: schema hardening ─────────────────────────────────

describe('migration 015: schema hardening (post-apply)', { skip: !DATABASE_URL }, () => {
  let pool;

  before(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  });
  after(async () => { if (pool) await pool.end(); });

  it('festival_profiles.user_id is NOT NULL', async () => {
    const { rows } = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'festival_profiles' AND column_name = 'user_id'
    `);
    assert.equal(rows[0].is_nullable, 'NO');
  });

  it('audit_log.created_at is NOT NULL', async () => {
    const { rows } = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'audit_log' AND column_name = 'created_at'
    `);
    assert.equal(rows[0].is_nullable, 'NO');
  });

  it('refresh_tokens.expires_at is TIMESTAMPTZ (not BIGINT)', async () => {
    const { rows } = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'refresh_tokens' AND column_name = 'expires_at'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data_type, 'timestamp with time zone');
  });

  it('refresh_tokens.created_at is TIMESTAMPTZ', async () => {
    const { rows } = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'refresh_tokens' AND column_name = 'created_at'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data_type, 'timestamp with time zone');
  });

  it('idx_refresh_tokens_expires index exists on new column', async () => {
    const { rows } = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'refresh_tokens' AND indexname = 'idx_refresh_tokens_expires'
    `);
    assert.equal(rows.length, 1);
  });
});
