// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

import { Pool } from 'pg';

// Simple LRU cache for parsed JSON objects to reduce allocation
const parseJsonCache = new Map<string, any>();
const MAX_PARSE_CACHE_SIZE = 1000;

/**
 * Execute a function within a transaction
 * @param pool - PostgreSQL connection pool
 * @param fn - Async function that receives a client
 * @returns Result of fn
 */
export async function withTransaction(pool: Pool, fn: (client: any) => Promise<any>): Promise<any> {
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

export function parseJsonObject(value: any, fallback: any = {}): any {
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
      if (oldestKey !== undefined) parseJsonCache.delete(oldestKey);
    }

    return result;
  } catch {
    return fallback;
  }
}

export function serializeJson(value: any, fallback: any = {}): string {
  return JSON.stringify(value ?? fallback);
}

/**
 * Open PostgreSQL database connection pool
 * @param opts - Options {databaseUrl, log}
 * @returns {pool} PostgreSQL connection pool
 * @throws If pool cannot be created
 */
export function openPlannerDatabase({ databaseUrl, log = null, poolSize = 15, poolMin = 2 }: { databaseUrl: string; log?: any; poolSize?: number; poolMin?: number }): { pool: Pool } {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: poolSize,
    min: poolMin,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 30000,
  });

  // Optional error logging
  if (log?.error) {
    pool.on('error', (err: Error) => {
      log.error('Unexpected error on idle client', err);
    });
  }

  return { pool };
}
