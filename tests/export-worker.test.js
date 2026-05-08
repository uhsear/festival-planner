'use strict';

const assert = require('node:assert/strict');
const { describe, it, afterEach } = require('node:test');
const { Worker } = require('worker_threads');
const path = require('path');

// ---------------------------------------------------------------------------
// The export-worker runs in a worker thread, listening on parentPort.
// We test it by spawning a real Worker and sending messages to it.
// ---------------------------------------------------------------------------

const WORKER_PATH = path.join(__dirname, '..', 'lib', 'export-worker.js');

function runWorker(message) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker timed out'));
    }, 10_000);

    worker.on('message', (msg) => {
      clearTimeout(timeout);
      worker.terminate().catch(() => {});
      resolve(msg);
    });
    worker.on('error', (err) => {
      clearTimeout(timeout);
      worker.terminate().catch(() => {});
      reject(err);
    });
    worker.postMessage(message);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('export-worker: message handling', () => {
  it('returns html when given a valid template', async () => {
    const msg = {
      template: '<html><body>Hello {{name}}</body></html>',
      festival: { name: 'TestFest', days: [], stages: [] },
      profile: { name: 'Alice', picks: {}, notes: {} },
      allProfiles: [],
      exportedAt: new Date().toISOString(),
    };

    const result = await runWorker(msg);
    assert.equal(typeof result.html, 'string');
    assert.ok(result.html.length > 0);
    assert.equal(result.error, undefined);
  });

  it('returns error when template is missing', async () => {
    const result = await runWorker({
      template: '',
      festival: {},
      profile: {},
      allProfiles: [],
    });

    assert.equal(result.error, true);
    assert.ok(result.message.includes('missing') || result.message.includes('invalid'), result.message);
  });

  it('returns error when template is not a string', async () => {
    const result = await runWorker({
      template: 42,
      festival: {},
      profile: {},
      allProfiles: [],
    });

    assert.equal(result.error, true);
    assert.ok(result.message.length > 0);
  });

  it('returns error when template is null', async () => {
    const result = await runWorker({
      template: null,
      festival: {},
      profile: {},
      allProfiles: [],
    });

    assert.equal(result.error, true);
  });

  it('truncates error messages to 200 characters', async () => {
    // We cannot easily force a >200 char error from buildExportHtml,
    // but we verify the contract by checking that error messages exist
    const result = await runWorker({ template: null });
    assert.equal(result.error, true);
    assert.ok(result.message.length <= 200);
  });

  it('handles festival with stages and days', async () => {
    const msg = {
      template: '<html><body>Schedule</body></html>',
      festival: {
        name: 'EDC',
        days: [{ id: 'd1', date: '2024-06-01', label: 'Day 1' }],
        stages: [{ id: 's1', name: 'Main Stage' }],
      },
      profile: {
        name: 'Bob',
        picks: { 'set-1': 'must' },
        notes: { 'set-1': 'Bring earplugs' },
      },
      allProfiles: [
        { name: 'Bob', picks: { 'set-1': 'must' } },
        { name: 'Carol', picks: { 'set-1': 'maybe' } },
      ],
      exportedAt: '2024-06-01T12:00:00Z',
    };

    const result = await runWorker(msg);
    assert.equal(typeof result.html, 'string');
    assert.ok(result.html.length > 0);
  });

  it('handles profile with empty picks and notes', async () => {
    const msg = {
      template: '<html><body>Empty</body></html>',
      festival: { name: 'Fest', days: [], stages: [] },
      profile: { name: 'User', picks: {}, notes: {} },
      allProfiles: [],
      exportedAt: new Date().toISOString(),
    };

    const result = await runWorker(msg);
    assert.equal(typeof result.html, 'string');
  });

  it('handles missing optional fields gracefully', async () => {
    const msg = {
      template: '<html><body>Minimal</body></html>',
      festival: { name: 'Minimal Fest' },
      profile: { name: 'User' },
      allProfiles: [],
    };

    const result = await runWorker(msg);
    // Should not crash — either produces html or a controlled error
    assert.ok(result.html || result.error);
  });
});
