import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createReengagementQueue } from '../lib/notifications/reengagement-queue.js';

// ---------------------------------------------------------------------------
// Test doubles: a fake BullMQ Queue/Worker so we can assert enqueue behaviour
// and job routing without a live Redis.
// ---------------------------------------------------------------------------
const log = { info() {}, warn() {}, debug() {}, error() {} };

function makeExecutor() {
  const calls: any[] = [];
  return {
    calls,
    sendWrapReady: async (festivalId: string) => {
      calls.push(['wrap', festivalId]);
      return { sent: 1, eventKey: `wrap:${festivalId}` };
    },
    sendLineupDrop: async (festivalId: string) => {
      calls.push(['lineup', festivalId]);
      return { sent: 2, eventKey: `lineup:${festivalId}` };
    },
    sendCrewReformed: async (args: any) => {
      calls.push(['reform', args]);
      return { sent: 3, eventKey: `reform:${args.newCrewId}` };
    },
  };
}

function makeFakes(opts: { addThrows?: boolean; modelJobIdNoop?: boolean } = {}) {
  const added: any[] = [];
  const byJobId = new Map<string, any>();
  let processor: any = null;
  let closed = { queue: false, worker: false };

  class FakeQueue {
    constructor(
      public name: string,
      public cfg: any,
    ) {}
    async add(name: string, data: any, jobOpts: any) {
      if (opts.addThrows) throw new Error('redis down');
      const jobId = jobOpts?.jobId;
      // Model BullMQ's existing-jobId behavior: queue.add with a jobId that
      // still exists is a NO-OP — it returns the existing job WITHOUT appending
      // a new one (and without throwing).
      if (opts.modelJobIdNoop && jobId != null && byJobId.has(jobId)) {
        return byJobId.get(jobId);
      }
      const job = { id: jobId };
      added.push({ name, data, jobOpts });
      if (jobId != null) byJobId.set(jobId, job);
      return job;
    }
    async close() {
      closed.queue = true;
    }
  }
  class FakeWorker {
    public listeners: Record<string, any> = {};
    constructor(
      public name: string,
      public proc: any,
      public cfg: any,
    ) {
      processor = proc;
    }
    on(evt: string, fn: any) {
      this.listeners[evt] = fn;
    }
    async close() {
      closed.worker = true;
    }
  }
  return {
    added,
    byJobId,
    closed,
    getProcessor: () => processor,
    _Queue: FakeQueue as any,
    _Worker: FakeWorker as any,
    _makeConnection: () => ({ disconnect() {} }),
  };
}

describe('createReengagementQueue', () => {
  it('returns null when disabled (caller falls back to inline executor)', () => {
    const q = createReengagementQueue({ executor: makeExecutor() as any, log, enabled: false });
    assert.equal(q, null);
  });

  it('returns null when no executor is provided', () => {
    const q = createReengagementQueue({ executor: undefined as any, log, enabled: true });
    assert.equal(q, null);
  });

  it('enqueues wrap/lineup/reform with stable dedup jobIds', async () => {
    const fakes = makeFakes();
    const q = createReengagementQueue({ executor: makeExecutor() as any, log, ...fakes });
    assert.ok(q);

    await q!.sendWrapReady('fk-2026');
    await q!.sendLineupDrop('nc-2026');
    await q!.sendCrewReformed({ newCrewId: 'crew-9', crewName: 'Wolves' });

    assert.equal(fakes.added.length, 3);
    assert.deepEqual(fakes.added[0], {
      name: 'wrap_ready',
      data: { festivalId: 'fk-2026' },
      jobOpts: { jobId: 'wrap:fk-2026' },
    });
    assert.deepEqual(fakes.added[1], {
      name: 'lineup_drop',
      data: { festivalId: 'nc-2026' },
      jobOpts: { jobId: 'lineup:nc-2026' },
    });
    assert.equal(fakes.added[2].name, 'crew_reformed');
    assert.equal(fakes.added[2].jobOpts.jobId, 'reform:crew-9');
    assert.equal(fakes.added[2].data.crewName, 'Wolves');
  });

  it('a duplicate enqueue with an existing jobId is a no-op (BullMQ existing-jobId semantics)', async () => {
    // FIX 3 documents that the stable jobId only suppresses a duplicate enqueue
    // WHILE a job with that id still exists; queue.add with an existing jobId is
    // a silent no-op (returns the existing job, does not append, does not throw).
    // removeOnComplete:true frees the key after completion so a LATER re-trigger
    // re-enqueues — the notification_log per-user dedup is the real backstop.
    const fakes = makeFakes({ modelJobIdNoop: true });
    const q = createReengagementQueue({ executor: makeExecutor() as any, log, ...fakes });
    assert.ok(q);

    const r1 = await q!.sendWrapReady('fk-2026');
    const r2 = await q!.sendWrapReady('fk-2026'); // same jobId, still present

    // Only ONE job was actually appended; the second add was a no-op.
    assert.equal(fakes.added.length, 1);
    assert.equal(fakes.added[0].jobOpts.jobId, 'wrap:fk-2026');
    // Both calls report queued against the same stable jobId.
    assert.equal(r1.queued, true);
    assert.equal(r1.jobId, 'wrap:fk-2026');
    assert.equal(r2.queued, true);
    assert.equal(r2.jobId, 'wrap:fk-2026');

    // After the key is freed (removeOnComplete:true frees it post-completion),
    // a later re-trigger re-enqueues. Simulate the key being gone:
    fakes.byJobId.delete('wrap:fk-2026');
    await q!.sendWrapReady('fk-2026');
    assert.equal(fakes.added.length, 2);
  });

  it('defaultJobOptions: removeOnComplete frees the key immediately, removeOnFail is short', () => {
    const fakes = makeFakes();
    const q = createReengagementQueue({ executor: makeExecutor() as any, log, ...fakes });
    assert.ok(q);
    // FakeQueue stores its config (2nd ctor arg) on `cfg`.
    const opts = (q as any)._queue.cfg.defaultJobOptions;
    assert.equal(opts.removeOnComplete, true);
    assert.deepEqual(opts.removeOnFail, { age: 600 });
  });

  it('worker routes job.name to the matching executor method', async () => {
    const fakes = makeFakes();
    const executor = makeExecutor();
    const q = createReengagementQueue({ executor: executor as any, log, ...fakes });
    assert.ok(q);
    const proc = fakes.getProcessor();
    assert.equal(typeof proc, 'function');

    const r1 = await proc({ name: 'wrap_ready', data: { festivalId: 'f1' }, id: 'wrap:f1', attemptsMade: 0 });
    assert.equal(r1.sent, 1);
    const r2 = await proc({ name: 'lineup_drop', data: { festivalId: 'f2' }, id: 'lineup:f2', attemptsMade: 0 });
    assert.equal(r2.sent, 2);
    const r3 = await proc({ name: 'crew_reformed', data: { newCrewId: 'c3' }, id: 'reform:c3', attemptsMade: 0 });
    assert.equal(r3.sent, 3);

    assert.deepEqual(executor.calls, [
      ['wrap', 'f1'],
      ['lineup', 'f2'],
      ['reform', { newCrewId: 'c3' }],
    ]);
  });

  it('worker throws on an unknown job name (so BullMQ retries/surfaces it)', async () => {
    const fakes = makeFakes();
    const q = createReengagementQueue({ executor: makeExecutor() as any, log, ...fakes });
    const proc = fakes.getProcessor();
    await assert.rejects(() => proc({ name: 'bogus', data: {}, id: 'x', attemptsMade: 0 }), /unknown job name/);
  });

  it('falls back to inline execution when enqueue throws (no silent drop)', async () => {
    const fakes = makeFakes({ addThrows: true });
    const executor = makeExecutor();
    const q = createReengagementQueue({ executor: executor as any, log, ...fakes });
    assert.ok(q);

    const r = await q!.sendWrapReady('fk-2026');
    // enqueue threw -> the inline executor ran and its result is returned
    assert.equal(r.sent, 1);
    assert.deepEqual(executor.calls, [['wrap', 'fk-2026']]);
  });

  it('close() shuts down the worker and queue', async () => {
    const fakes = makeFakes();
    const q = createReengagementQueue({ executor: makeExecutor() as any, log, ...fakes });
    await q!.close();
    assert.equal(fakes.closed.worker, true);
    assert.equal(fakes.closed.queue, true);
  });
});
