#!/usr/bin/env node
/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Database Query Analysis Tool
 * Analyzes performance of key queries using EXPLAIN ANALYZE
 * Usage: node scripts/analyze-queries.js
 *
 * Output: EXPLAIN ANALYZE results for critical queries to identify missing indexes
 */

'use strict';

const { Pool } = require('pg');
require('dotenv').config();

async function analyzeQueries() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost/festival_planner';
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  console.log('📊 Festie Query Analysis');
  console.log('═'.repeat(60));

  const queries = [
    {
      name: 'Festival Load (by ID)',
      sql: `
        EXPLAIN ANALYZE
        SELECT f.*,
          json_agg(json_build_object('id', s.id, 'name', s.name, 'color', s.color)) as stages
        FROM festivals f
        LEFT JOIN stages s ON s.festival_id = f.id
        WHERE f.id = $1
        GROUP BY f.id
      `,
      params: ['test-festival-id'],
    },
    {
      name: 'Profile Load (user + festival)',
      sql: `
        EXPLAIN ANALYZE
        SELECT p.*, u.username, u.email
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        WHERE u.id = $1 AND p.festival_id = $2
      `,
      params: ['user-id', 'festival-id'],
    },
    {
      name: 'User Lookup (by username)',
      sql: `
        EXPLAIN ANALYZE
        SELECT id, username, password_hash, email
        FROM users
        WHERE username = $1
        LIMIT 1
      `,
      params: ['testuser'],
    },
    {
      name: 'Session Validation',
      sql: `
        EXPLAIN ANALYZE
        SELECT u.id, u.username, s.token_hash, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > NOW()
        LIMIT 1
      `,
      params: ['token-hash'],
    },
    {
      name: 'Festival List with Member Count',
      sql: `
        EXPLAIN ANALYZE
        SELECT f.id, f.name, COUNT(p.id) as member_count
        FROM festivals f
        LEFT JOIN profiles p ON p.festival_id = f.id
        WHERE f.created_at > NOW() - INTERVAL '90 days'
        GROUP BY f.id
        ORDER BY f.created_at DESC
        LIMIT 50
      `,
      params: [],
    },
    {
      name: 'Recent Sets (time range)',
      sql: `
        EXPLAIN ANALYZE
        SELECT s.*, f.name as festival_name
        FROM sets s
        JOIN festivals f ON f.id = s.festival_id
        WHERE s.start_time >= $1 AND s.start_time < $2
        ORDER BY s.start_time ASC
      `,
      params: ['2026-03-22T00:00:00', '2026-03-23T00:00:00'],
    },
  ];

  try {
    for (const query of queries) {
      console.log(`\n${query.name}`);
      console.log('─'.repeat(60));
      try {
        const result = await pool.query(query.sql, query.params);
        console.log(result.rows.map((r) => r['QUERY PLAN']).join('\n'));
        console.log('');
      } catch (err) {
        console.log(`⚠️  Error analyzing query: ${err.message}`);
      }
    }
  } finally {
    await pool.end();
  }

  console.log('═'.repeat(60));
  console.log('✅ Analysis complete. Check for sequential scans (Seq Scan) and');
  console.log('   consider adding indexes on frequently filtered columns.');
  console.log('');
  console.log('Index recommendation tips:');
  console.log('  • Add indexes on festival_id, user_id for JOINs');
  console.log('  • Add indexes on username (CITEXT) for auth lookups');
  console.log('  • Add indexes on start_time for time-range queries');
  console.log('  • Consider composite indexes for multi-column filters');
}

analyzeQueries().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
