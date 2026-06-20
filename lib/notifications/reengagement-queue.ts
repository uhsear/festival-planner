// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

//
// M3 Re-engagement: durable fan-out queue (issue #20).
//
// The re-engagement triggers (sendWrapReady / sendLineupDrop / sendCrewReformed)
// already reach EVERY eligible recipient via bounded-concurrency chunks, so the
// old MAX_PUSH_BATCH tail-drop is gone. What this module adds is DURABILITY:
// rather than fanning out on the web process's event loop inside the triggering
// request (where a large lineup import or attendee sweep competes with request
// handling and is lost if the process restarts mid-fan-out), the trigger ENQUEUES
// a small event-descriptor job and an in-process BullMQ worker drains it in the
// background — with automatic retries and survival across restarts.
//
// Why this is safe to retry: the executor (createReengagementTriggers) is
// idempotent. Every send is deduped per-user-per-event via
// notification_log.existsForEvent, so re-running a job (BullMQ retry, or a job
// that survived a crash and re-runs on next boot) never double-sends. Per-type
// opt-out and DND are enforced inside notificationService.send / the email path,
// unchanged.
//
// Degradation: when Redis is disabled or the queue can't be created, this returns
// null and the caller falls back to running the executor INLINE (the prior
// behaviour). If an individual enqueue throws (Redis blips mid-call) we also fall
// back to inline for that call rather than silently dropping the notification.
//
// Topology: the worker runs IN-PROCESS in every web instance (PM2 cluster). No
// separate worker process is required — BullMQ coordinates job ownership across
// instances via Redis, and the dedup guard is the final backstop.

import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const QUEUE_NAME = 'reengagement';

// Map BullMQ job name -> executor method + the stable per-event dedup key used as
// the BullMQ jobId. The jobId only suppresses a duplicate enqueue while a job
// with that id still exists in Redis; we free completed jobs immediately
// (removeOnComplete: true) so a LATER legitimate re-trigger of the same event
// re-enqueues. Note BullMQ's queue.add with an already-present jobId is a silent
// no-op (it returns the existing job, doesn't throw and doesn't re-run) — the
// real double-send backstop is notification_log's per-user eventKey dedup, not
// the jobId.
type JobName = 'wrap_ready' | 'lineup_drop' | 'crew_reformed';

// Bound worker.close() so a long-running fan-out job can't hold up shutdown past
// the process shutdown timeout; on timeout we force-close.
const WORKER_CLOSE_TIMEOUT_MS = 10_000;

export interface ReengagementExecutor {
  sendWrapReady: (festivalId: string) => Promise<any>;
  sendLineupDrop: (festivalId: string) => Promise<any>;
  sendCrewReformed: (args: any) => Promise<any>;
}

export interface ReengagementQueueDeps {
  executor: ReengagementExecutor;
  log?: any;
  redisUrl?: string;
  enabled?: boolean;
  /** BullMQ key namespace (kept distinct from the app's ioredis keyPrefix). */
  bullPrefix?: string;
  /** Worker concurrency — each job itself fans out in chunks, so keep this low. */
  concurrency?: number;
  /**
   * Prometheus metrics object from lib/metrics.ts createMetrics(). Optional —
   * when present, worker failures increment fp_reengagement_queue_worker_errors_total.
   * Queue depth (fp_reengagement_queue_depth) is sampled separately via
   * startReengagementQueueSampler (lib/metrics.ts), which requires the _queue handle.
   */
  promMetrics?: any;
  // ── test seams (default to the real bullmq/ioredis implementations) ──
  _Queue?: typeof Queue;
  _Worker?: typeof Worker;
  _makeConnection?: () => any;
}

/**
 * Build the durable re-engagement dispatcher. Returns an object with the SAME
 * shape as the executor (sendWrapReady / sendLineupDrop / sendCrewReformed) that
 * enqueues instead of running inline, plus `close()`. Returns `null` when the
 * queue is disabled/unavailable so the caller can fall back to the inline executor.
 */
export function createReengagementQueue(deps: ReengagementQueueDeps) {
  const {
    executor,
    log = {},
    redisUrl,
    enabled = true,
    bullPrefix = 'bull',
    concurrency = 2,
    promMetrics,
    _Queue = Queue,
    _Worker = Worker,
    _makeConnection,
  } = deps;

  if (!enabled || !executor) return null;

  // BullMQ requires `maxRetriesPerRequest: null` and forbids an ioredis
  // `keyPrefix` on its connections — so we build dedicated connections rather
  // than reusing the app client (which sets a keyPrefix).
  const makeConnection =
    _makeConnection ||
    (() => {
      if (!redisUrl) return null;
      const conn = new Redis(redisUrl, { maxRetriesPerRequest: null });
      conn.on('error', (err: any) => log?.warn?.('reengagement-queue: redis error', { error: err?.message }));
      return conn;
    });

  let queue: any;
  let worker: any;
  let queueConn: any;
  let workerConn: any;
  try {
    queueConn = makeConnection();
    workerConn = makeConnection();
    if (!queueConn || !workerConn) return null;

    queue = new _Queue(QUEUE_NAME, {
      connection: queueConn,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5000 },
        // Free the completed job's key IMMEDIATELY so a later legitimate
        // re-trigger of the same event (same stable jobId) is not silently
        // swallowed by BullMQ's existing-jobId no-op during a retention window.
        // The notification_log per-user eventKey dedup is the real double-send
        // backstop, so removing the key early can't cause duplicate sends.
        removeOnComplete: true,
        // Keep failed jobs briefly (for visibility/retry) but short, so a failed
        // job's key doesn't block a re-trigger for long.
        removeOnFail: { age: 600 },
      },
    });

    worker = new _Worker(
      QUEUE_NAME,
      async (job: any) => {
        const name = job.name as JobName;
        const data = job.data || {};
        log?.info?.('reengagement-queue: processing', { name, jobId: job.id, attempt: job.attemptsMade + 1 });
        if (name === 'wrap_ready') return executor.sendWrapReady(data.festivalId);
        if (name === 'lineup_drop') return executor.sendLineupDrop(data.festivalId);
        if (name === 'crew_reformed') return executor.sendCrewReformed(data);
        throw new Error(`reengagement-queue: unknown job name ${name}`);
      },
      { connection: workerConn, prefix: bullPrefix, concurrency },
    );

    worker.on('failed', (job: any, err: any) => {
      log?.warn?.('reengagement-queue: job failed', {
        name: job?.name,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        error: err?.message,
      });
      try {
        promMetrics?.reengagementWorkerErrorsCounter?.inc();
      } catch { /* ignore metric errors */ }
    });
    worker.on('completed', (job: any, result: any) =>
      log?.info?.('reengagement-queue: job completed', {
        name: job?.name,
        jobId: job?.id,
        sent: result?.sent,
        emailSent: result?.emailSent,
      }),
    );
    worker.on('error', (err: any) => log?.warn?.('reengagement-queue: worker error', { error: err?.message }));
  } catch (err: any) {
    log?.warn?.('reengagement-queue: init failed — falling back to inline', { error: err?.message });
    return null;
  }

  /**
   * Enqueue a job; on any enqueue failure fall back to running the executor
   * inline so a Redis blip never silently drops the notification.
   */
  async function enqueue(name: JobName, jobId: string, data: any, inline: () => Promise<any>) {
    try {
      await queue.add(name, data, { jobId });
      log?.info?.('reengagement-queue: queued', { name, jobId });
      return { queued: true, jobId };
    } catch (err: any) {
      log?.warn?.('reengagement-queue: enqueue failed — running inline', { name, jobId, error: err?.message });
      return inline();
    }
  }

  return {
    sendWrapReady: (festivalId: string) =>
      enqueue('wrap_ready', `wrap:${festivalId}`, { festivalId }, () => executor.sendWrapReady(festivalId)),
    sendLineupDrop: (festivalId: string) =>
      enqueue('lineup_drop', `lineup:${festivalId}`, { festivalId }, () => executor.sendLineupDrop(festivalId)),
    sendCrewReformed: (args: any) =>
      enqueue('crew_reformed', `reform:${args?.newCrewId}`, args, () => executor.sendCrewReformed(args)),
    async close() {
      // worker.close() waits for in-flight jobs to finish, which is unbounded —
      // a large fan-out can keep one job busy for minutes. Bound it and force a
      // close (worker.close(true)) if the graceful drain doesn't land in time.
      if (worker) {
        try {
          let timedOut = false;
          const timer = new Promise<void>((resolve) => {
            setTimeout(() => {
              timedOut = true;
              resolve();
            }, WORKER_CLOSE_TIMEOUT_MS);
          });
          await Promise.race([worker.close(), timer]);
          if (timedOut) {
            try {
              await worker.close(true); // force
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      }
      try {
        await queue?.close();
      } catch {
        /* ignore */
      }
      try {
        queueConn?.disconnect?.();
        workerConn?.disconnect?.();
      } catch {
        /* ignore */
      }
    },
    _queue: queue,
    _worker: worker,
  };
}
