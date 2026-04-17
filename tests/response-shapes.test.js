require('dotenv').config();
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const request = require('supertest');
const { createFestivalPlanner } = require('../server');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) { console.error('ERROR: TEST_DATABASE_URL required'); process.exit(1); }
if (!TEST_DATABASE_URL.includes('_test')) { console.error('SAFETY: TEST_DATABASE_URL must contain "_test"'); process.exit(1); }

// Shape validators — assert field names and types, not values
function assertEnvelopeSuccess(body) {
  assert.ok('data' in body, 'Success response must have "data" field');
  assert.ok('error' in body, 'Success response must have "error" field');
  assert.equal(body.error, null, 'Success response "error" must be null');
  assert.notEqual(body.data, null, 'Success response "data" must not be null');
}

function assertEnvelopeError(body) {
  assert.ok('data' in body, 'Error response must have "data" field');
  assert.ok('error' in body, 'Error response must have "error" field');
  assert.equal(body.data, null, 'Error response "data" must be null');
  assert.notEqual(body.error, null, 'Error response "error" must not be null');
  assert.equal(typeof body.error.message, 'string', '"error.message" must be string');
  assert.equal(typeof body.error.status, 'number', '"error.status" must be number');
  assert.equal(typeof body.error.retryable, 'boolean', '"error.retryable" must be boolean');
}

describe('API response shape contracts', () => {
  let app;

  test('setup', async () => {
    const result = await createFestivalPlanner({
      databaseUrl: TEST_DATABASE_URL,
      skipMigrations: false,
      PUBLIC_ORIGIN: '',
    });
    app = result.app;
  });

  describe('envelope structure', () => {
    test('GET /api/health returns success envelope with status and uptime', async () => {
      const res = await request(app).get('/api/health').expect(200);
      assertEnvelopeSuccess(res.body);
      assert.equal(typeof res.body.data.status, 'string');
      assert.equal(typeof res.body.data.uptime, 'number');
    });

    test('POST /api/v1/auth/register with missing fields returns validation error', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({})
        .set('Content-Type', 'application/json');
      assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx, got ${res.status}`);
      assertEnvelopeError(res.body);
    });

    test('POST /api/v1/auth/login with invalid credentials returns error with code', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent_shape_test_user', password: 'badpassword1' })
        .set('Content-Type', 'application/json')
        .expect(401);
      assertEnvelopeError(res.body);
      assert.ok(res.body.error.code, 'Login error should have error code');
    });
  });

  describe('data field shapes', () => {
    test('GET /api/v1/festivals returns array data', async () => {
      const res = await request(app).get('/api/v1/festivals').expect(200);
      assertEnvelopeSuccess(res.body);
      assert.ok(Array.isArray(res.body.data), 'festivals data must be array');
    });

    test('success meta field is object or absent', async () => {
      const res = await request(app).get('/api/health').expect(200);
      if ('meta' in res.body) {
        assert.equal(typeof res.body.meta, 'object');
      }
    });

    test('4xx errors have retryable=false', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent_shape_test_user2', password: 'badpassword1' })
        .set('Content-Type', 'application/json')
        .expect(401);
      assertEnvelopeError(res.body);
      assert.equal(res.body.error.retryable, false, '4xx errors should not be retryable');
    });
  });

  describe('header contracts', () => {
    test('JSON responses set correct content-type', async () => {
      const res = await request(app).get('/api/health');
      assert.ok(
        res.headers['content-type'].includes('application/json'),
        'Content-Type must include application/json'
      );
    });
  });
});
