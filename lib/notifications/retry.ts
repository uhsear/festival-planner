// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * In-memory retry queue for failed FCM notifications.
 * Retries up to 3 times with exponential backoff. Entries older than 15 minutes are discarded.
 */
export function createRetryQueue({ log, maxRetries = 3, maxAgeMs = 15 * 60 * 1000 }: any) {
  const queue: any[] = [];
  let draining = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;

  function enqueue(entry: any) {
    if (queue.length >= 500) {
      log.warn('fcm retry queue full, dropping oldest entry');
      queue.shift();
    }
    queue.push({ ...entry, retries: entry.retries || 0, enqueuedAt: Date.now() });
    scheduleDrain();
  }

  function scheduleDrain() {
    if (drainTimer || draining) return;
    const delay = Math.min(2000 * Math.pow(2, (queue[0]?.retries || 0)), 30000);
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drain().catch((err: any) => log.warn('fcm drain failed', { error: err && err.message }));
    }, delay);
    if (drainTimer.unref) drainTimer.unref();
  }

  async function drain() {
    if (draining || queue.length === 0) return;
    draining = true;
    const now = Date.now();
    const batch: any[] = [];
    while (queue.length > 0 && batch.length < 10) {
      const entry = queue.shift()!;
      if (now - entry.enqueuedAt > maxAgeMs) continue;
      batch.push(entry);
    }
    for (const entry of batch) {
      try {
        await entry.sendFn();
        log.debug('fcm retry: resend succeeded', { userId: entry.userId, retries: entry.retries });
      } catch (err: any) {
        const code = err.code || '';
        if (code.includes('not-registered') || code.includes('invalid-registration') || code.includes('invalid-argument')) continue;
        if (entry.retries < maxRetries) {
          entry.retries++;
          queue.push(entry);
        } else {
          log.warn('fcm retry: max retries exceeded', { userId: entry.userId });
        }
      }
    }
    draining = false;
    if (queue.length > 0) scheduleDrain();
  }

  function shutdown() {
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    queue.length = 0;
  }

  return { enqueue, shutdown, get pending() { return queue.length; } };
}
