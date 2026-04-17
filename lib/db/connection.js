// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const { Pool } = require('pg');

// Simple LRU cache for parsed JSON objects to reduce allocation
const parseJsonCache = new Map();
const MAX_PARSE_CACHE_SIZE = 1000;

/**
 * Execute a function within a transaction
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Function} fn - Async function that receives a client
 * @returns {Promise} - Result of fn
 */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;

  // PostgreSQL JSONB returns JavaScript objects directly — no parsing needed
  if (typeof value === 'object') return value;

  // Check cache first (for string values)
  if (parseJsonCache.has(value)) {
    return parseJsonCache.get(value);
  }

  try {
    const parsed = JSON.parse(value);
    const result = parsed && typeof parsed === 'object' ? parsed : fallback;

    // Cache the parsed result
    parseJsonCache.set(value, result);
    if (parseJsonCache.size > MAX_PARSE_CACHE_SIZE) {
      // Remove oldest entry (LRU eviction)
      const oldestKey = parseJsonCache.keys().next().value;
      parseJsonCache.delete(oldestKey);
    }

    return result;
  } catch {
    return fallback;
  }
}

function serializeJson(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

/**
 * Open PostgreSQL database connection pool
 * @param {Object} opts - Options {databaseUrl, log}
 * @param {string} opts.databaseUrl - PostgreSQL connection string
 * @param {Object} opts.log - Optional logger
 * @returns {Object} - {pool} PostgreSQL connection pool
 * @throws {Error} - If pool cannot be created
 */
function openPlannerDatabase({ databaseUrl, log = null, poolSize = 15 }) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: poolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
  });

  // Optional error logging
  if (log?.error) {
    pool.on('error', (err) => {
      log.error('Unexpected error on idle client', err);
    });
  }

  return { pool };
}

module.exports = {
  openPlannerDatabase,
  withTransaction,
  parseJsonObject,
  serializeJson,
};
