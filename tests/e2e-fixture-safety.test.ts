import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTestDatabaseUrl } from './e2e/fixtures.js';

test('E2E DB guard ignores DATABASE_URL and requires explicit TEST_DATABASE_URL', () => {
  const env = {
    DATABASE_URL: 'postgres://user:password@localhost:5432/festie_test',
    TEST_DATABASE_URL: undefined,
  };
  assert.throws(() => resolveTestDatabaseUrl(env), /explicit TEST_DATABASE_URL/);
});

test('E2E DB guard requires exact festie_test database name', () => {
  assert.throws(
    () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://user:password@localhost:5432/festie_test_backup' }),
    /must name the disposable database exactly "festie_test"/,
  );
  assert.equal(
    resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://user:password@localhost:5432/festie_test?sslmode=disable' }),
    'postgres://user:password@localhost:5432/festie_test?sslmode=disable',
  );
});
