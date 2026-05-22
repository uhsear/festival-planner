import assert from 'node:assert/strict';
import { describe, it, afterEach, mock } from 'node:test';

import { AvatarPool } from '../lib/avatar-pool';

// ---------------------------------------------------------------------------
// Note: AvatarPool creates real Worker threads that import avatar-worker.js
// which requires Sharp. We test the pool's lifecycle and queue logic.
// For the _drain/process path we need Sharp installed; if it is not, the
// worker will error, which exercises the error-handling path instead.
// ---------------------------------------------------------------------------

describe('AvatarPool: constructor', () => {
  it('starts with empty state', () => {
    const pool = new AvatarPool();
    assert.equal(pool._initialized, false);
    assert.equal(pool._workers.length, 0);
    assert.equal(pool._queue.length, 0);
    assert.equal(pool._available.length, 0);
  });
});

describe('AvatarPool: init', () => {
  let pool: any;
  afterEach(async () => {
    if (pool) await pool.terminate();
  });

  it('creates 2 workers on first init call', () => {
    pool = new AvatarPool();
    pool.init();
    assert.equal(pool._initialized, true);
    assert.equal(pool._workers.length, 2);
    assert.equal(pool._available.length, 2);
  });

  it('is idempotent — second init call is a no-op', () => {
    pool = new AvatarPool();
    pool.init();
    const workers = pool._workers;
    pool.init();
    assert.equal(pool._workers, workers, 'should be the same array reference');
    assert.equal(pool._workers.length, 2);
  });
});

describe('AvatarPool: terminate', () => {
  it('terminates all workers and resets state', async () => {
    const pool = new AvatarPool();
    pool.init();
    assert.equal(pool._workers.length, 2);

    await pool.terminate();
    assert.equal(pool._workers.length, 0);
    assert.equal(pool._available.length, 0);
    assert.equal(pool._initialized, false);
  });

  it('can be called multiple times safely', async () => {
    const pool = new AvatarPool();
    pool.init();
    await pool.terminate();
    await pool.terminate(); // should not throw
    assert.equal(pool._workers.length, 0);
  });

  it('allows re-initialization after terminate', async () => {
    const pool = new AvatarPool();
    pool.init();
    await pool.terminate();

    pool.init();
    assert.equal(pool._initialized, true);
    assert.equal(pool._workers.length, 2);
    await pool.terminate();
  });
});

describe('AvatarPool: process', () => {
  let pool: any;
  afterEach(async () => {
    if (pool) await pool.terminate();
  });

  it('auto-initializes the pool on first process call', async () => {
    pool = new AvatarPool();
    assert.equal(pool._initialized, false);

    // Process will auto-init, then the worker will attempt sharp processing.
    // With invalid data this will reject — that's fine, we're testing auto-init.
    const promise = pool.process(Buffer.from('not-a-real-image'), {
      AVATAR_MAX_PIXELS: 4000 * 4000,
      AVATAR_SIZE: 256,
      AVATAR_WEBP_QUALITY: 80,
    });

    assert.equal(pool._initialized, true);
    assert.equal(pool._workers.length, 2);

    // The worker will reject because this isn't valid image data
    await assert.rejects(promise);
  });

  it('queues tasks and drains them', async () => {
    pool = new AvatarPool();

    // Submit 3 tasks in parallel — pool has 2 workers, so one will queue
    const results = await Promise.allSettled([
      pool.process(Buffer.from('bad1'), { AVATAR_MAX_PIXELS: 1, AVATAR_SIZE: 1, AVATAR_WEBP_QUALITY: 1 }),
      pool.process(Buffer.from('bad2'), { AVATAR_MAX_PIXELS: 1, AVATAR_SIZE: 1, AVATAR_WEBP_QUALITY: 1 }),
      pool.process(Buffer.from('bad3'), { AVATAR_MAX_PIXELS: 1, AVATAR_SIZE: 1, AVATAR_WEBP_QUALITY: 1 }),
    ]);

    // All should complete (either resolved or rejected — likely rejected with bad data)
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.ok(r.status === 'fulfilled' || r.status === 'rejected');
    }
  });
});

describe('AvatarPool: _drain', () => {
  let pool: any;
  afterEach(async () => {
    if (pool) await pool.terminate();
  });

  it('does nothing when queue is empty', () => {
    pool = new AvatarPool();
    pool.init();
    // _drain with empty queue should not throw
    pool._drain();
    assert.equal(pool._queue.length, 0);
  });

  it('does nothing when no workers are available', () => {
    pool = new AvatarPool();
    pool.init();
    // Mark all workers as unavailable
    pool._available = [];
    pool._queue.push({ buffer: Buffer.from('x'), config: {}, resolve: () => {}, reject: () => {} });
    pool._drain();
    // Task should remain in queue
    assert.equal(pool._queue.length, 1);
  });
});

describe('AvatarPool: worker error recovery', () => {
  let pool: any;
  afterEach(async () => {
    if (pool) await pool.terminate();
  });

  it('workers have error listeners attached', () => {
    pool = new AvatarPool();
    pool.init();
    // Each worker should have at least one error listener
    for (const w of pool._workers) {
      const listeners = w.listeners('error');
      assert.ok(listeners.length >= 1, 'worker should have error listener');
    }
  });
});
