import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitSqlStatements, usesConcurrently, stripSqlComments } from '../lib/db/sql-split.js';

describe('splitSqlStatements', () => {
  test('splits simple statements and drops the trailing semicolon', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
  });

  test('keeps a final statement with no trailing semicolon', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1;\nSELECT 2'), ['SELECT 1', 'SELECT 2']);
  });

  test('ignores empty statements / stray semicolons', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1;;\n;  ;SELECT 2;'), ['SELECT 1', 'SELECT 2']);
  });

  test('does not split on a semicolon inside a single-quoted string', () => {
    assert.deepEqual(splitSqlStatements("INSERT INTO t VALUES ('a;b;c'); SELECT 2;"), [
      "INSERT INTO t VALUES ('a;b;c')",
      'SELECT 2',
    ]);
  });

  test('handles escaped single quotes', () => {
    assert.deepEqual(splitSqlStatements("SELECT 'it''s; fine'; SELECT 2;"), ["SELECT 'it''s; fine'", 'SELECT 2']);
  });

  test('does not split inside a $$ dollar-quoted DO block', () => {
    const sql = 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;\nSELECT 9;';
    assert.deepEqual(splitSqlStatements(sql), ['DO $$ BEGIN PERFORM 1; PERFORM 2; END $$', 'SELECT 9']);
  });

  test('does not split inside a tagged $tag$ dollar-quote', () => {
    const sql =
      "CREATE FUNCTION f() RETURNS void AS $body$ BEGIN RAISE NOTICE 'a;b'; END $body$ LANGUAGE plpgsql; SELECT 1;";
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.ok(out[0]!.includes("RAISE NOTICE 'a;b'"));
    assert.equal(out[1], 'SELECT 1');
  });

  test('does not split on a semicolon inside a line comment', () => {
    const sql = '-- a; b; c\nSELECT 1;';
    assert.deepEqual(splitSqlStatements(sql), ['-- a; b; c\nSELECT 1']);
  });

  test('does not split on a semicolon inside a block comment', () => {
    const sql = 'SELECT 1 /* x; y; z */; SELECT 2;';
    assert.deepEqual(splitSqlStatements(sql), ['SELECT 1 /* x; y; z */', 'SELECT 2']);
  });

  test('splits a realistic CONCURRENTLY migration into discrete statements', () => {
    const sql = `-- header comment
DROP INDEX CONCURRENTLY IF EXISTS idx_a;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b ON t (col);
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (99, '099_x', NOW())
ON CONFLICT DO NOTHING;`;
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 3);
    assert.ok(out[0]!.endsWith('DROP INDEX CONCURRENTLY IF EXISTS idx_a'));
    assert.ok(out[1]!.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b'));
    assert.ok(out[2]!.startsWith('INSERT INTO schema_migrations'));
  });

  test('does not treat $1-style params as a dollar-quote', () => {
    assert.deepEqual(splitSqlStatements('SELECT * FROM t WHERE id = $1; SELECT 2;'), [
      'SELECT * FROM t WHERE id = $1',
      'SELECT 2',
    ]);
  });
});

describe('usesConcurrently', () => {
  test('detects real CONCURRENTLY usage', () => {
    assert.equal(usesConcurrently('CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t(c);'), true);
    assert.equal(usesConcurrently('DROP INDEX CONCURRENTLY IF EXISTS i;'), true);
  });

  test('ignores CONCURRENTLY that only appears in a comment', () => {
    assert.equal(usesConcurrently('-- note: avoid CONCURRENTLY here\nCREATE INDEX i ON t(c);'), false);
    assert.equal(usesConcurrently('/* CONCURRENTLY */ CREATE INDEX i ON t(c);'), false);
  });

  test('false for a plain migration', () => {
    assert.equal(usesConcurrently('ALTER TABLE t ADD COLUMN c TEXT;'), false);
  });
});

describe('stripSqlComments', () => {
  test('removes line and block comments', () => {
    assert.equal(stripSqlComments('SELECT 1; -- trailing\n').includes('trailing'), false);
    assert.equal(stripSqlComments('A /* mid */ B').replace(/\s+/g, ' ').trim(), 'A  B'.replace(/\s+/g, ' ').trim());
  });
});
