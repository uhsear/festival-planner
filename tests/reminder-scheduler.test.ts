import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { createReminderScheduler } from '../lib/reminder-scheduler.js';

function makeDeps(overrides: any = {}) {
  return {
    pool: {
      query: mock.fn(async () => ({ rows: [] })),
      ...overrides.pool,
    },
    stores: {
      notificationPrefs: { get: mock.fn(async () => null) },
      ...overrides.stores,
    },
    notificationService: {
      send: mock.fn(async () => ({ sent: 1 })),
      ...overrides.notificationService,
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    config: {
      REMINDER_TICK_INTERVAL_MS: 60_000,
      REMINDER_FIRE_WINDOW_MS: 65_000,
      REMINDER_DEDUP_TTL_MS: 7_200_000,
    },
    ...overrides,
  };
}

describe('reminder-scheduler: createReminderScheduler', () => {
  it('returns start, stop, tick, _timer functions', () => {
    const scheduler = createReminderScheduler(makeDeps());
    assert.equal(typeof scheduler.start, 'function');
    assert.equal(typeof scheduler.stop, 'function');
    assert.equal(typeof scheduler.tick, 'function');
    assert.equal(typeof scheduler._timer, 'function');
  });

  it('start and stop do not throw', () => {
    const scheduler = createReminderScheduler(makeDeps());
    assert.doesNotThrow(() => scheduler.start());
    assert.doesNotThrow(() => scheduler.stop());
  });

  it('tick queries for active festivals', async () => {
    const queryFn = mock.fn(async () => ({ rows: [] }));
    const scheduler = createReminderScheduler(makeDeps({ pool: { query: queryFn } }));
    await scheduler.tick();
    assert.ok(queryFn.mock.calls.length >= 1);
    // First call should be for festivals
    const firstCall = (queryFn.mock.calls as any[])[0]!.arguments[0];
    assert.ok(firstCall!.includes('festivals'));
  });

  it('tick handles empty festivals gracefully', async () => {
    const scheduler = createReminderScheduler(makeDeps());
    await assert.doesNotReject(() => scheduler.tick());
  });

  it('tick handles query errors gracefully', async () => {
    const queryFn = mock.fn(async () => { throw new Error('db error'); });
    const scheduler = createReminderScheduler(makeDeps({ pool: { query: queryFn } }));
    // Should not throw -- catches internally
    await assert.doesNotReject(() => scheduler.tick());
  });

  it('timer is null before start', () => {
    const scheduler = createReminderScheduler(makeDeps());
    assert.equal(scheduler._timer(), null);
  });

  it('timer is set after start and cleared after stop', () => {
    const scheduler = createReminderScheduler(makeDeps());
    scheduler.start();
    assert.ok(scheduler._timer() !== null);
    scheduler.stop();
    assert.equal(scheduler._timer(), null);
  });

  it('start is idempotent', () => {
    const scheduler = createReminderScheduler(makeDeps());
    scheduler.start();
    const timer1 = scheduler._timer();
    scheduler.start(); // second call should not create a new timer
    assert.equal(scheduler._timer(), timer1);
    scheduler.stop();
  });
});

describe('reminder-scheduler: processProfileReminders (via tick)', () => {
  it('fires notification for a reminder within the fire window', async () => {
    const now = Date.now();
    const setStartMs = now + 15 * 60000 + 60000; // 16 min from now (fireAt ≈ now+60s, within 65s window even with HH:MM truncation)

    const notifyFn = mock.fn(async () => ({ sent: 1 }));
    const prefsFn = mock.fn(async () => null);

    // computeSetStartMs parses `${date}T${HH:MM}:00` as LOCAL time.
    // Use local date and local hours/minutes consistently so the computed
    // timestamp matches the expected setStartMs (within 1 minute due to
    // HH:MM truncation).
    const setDate = new Date(setStartMs);
    const localDateStr = `${setDate.getFullYear()}-${String(setDate.getMonth() + 1).padStart(2, '0')}-${String(setDate.getDate()).padStart(2, '0')}`;
    const localHours = setDate.getHours();
    const localMinutes = setDate.getMinutes();

    // Build a festival query chain
    let callIndex = 0;
    const queryFn = mock.fn(async (sql: string, params: any) => {
      if (sql.includes('festivals')) {
        return { rows: [{ id: 'fest-1', name: 'Test Fest' }] };
      }
      if (sql.includes('festival_days')) {
        return { rows: [{ day_index: 0, label: 'Day 1', date: localDateStr }] };
      }
      if (sql.includes('festival_stages')) {
        return { rows: [{ id: 'stage-1', name: 'Main Stage' }] };
      }
      if (sql.includes('festival_sets')) {
        const startTime = `${String(localHours).padStart(2, '0')}:${String(localMinutes).padStart(2, '0')}`;
        return {
          rows: [{
            id: 'set-1', day_index: 0, artist: 'DJ Alpha',
            artists: null, stage_id: 'stage-1',
            startTime, endTime: '23:00',
          }],
        };
      }
      if (sql.includes('festival_profiles')) {
        return {
          rows: [{
            id: 'fp-1',
            userId: 'user-1',
            remindersJson: JSON.stringify({ 'set-1': 15 }),
            picksJson: '{}',
          }],
        };
      }
      return { rows: [] };
    });

    const deps = makeDeps({
      pool: { query: queryFn },
      stores: {
        notificationPrefs: { get: prefsFn },
      },
      notificationService: { send: notifyFn },
    });

    const scheduler = createReminderScheduler(deps);
    await scheduler.tick();

    // The notification should have been called for the reminder
    assert.ok(notifyFn.mock.calls.length >= 1, 'notify should be called for the upcoming set');
    const call = (notifyFn.mock.calls as any[])[0]!.arguments[0];
    assert.equal(call!.userId, 'user-1');
    assert.equal(call!.type, 'set_reminder');
    assert.ok(call!.title.includes('DJ Alpha'));
    assert.ok(call!.title.includes('15'));
  });

  it('skips reminders outside the fire window', async () => {
    const now = Date.now();
    const setStartMs = now + 2 * 60 * 60000; // 2 hours from now

    const notifyFn = mock.fn(async () => ({ sent: 1 }));

    const queryFn = mock.fn(async (sql: string) => {
      if (sql.includes('festivals')) {
        return { rows: [{ id: 'fest-1', name: 'Test' }] };
      }
      if (sql.includes('festival_days')) {
        const dateStr = new Date(setStartMs).toISOString().slice(0, 10);
        return { rows: [{ day_index: 0, label: 'Day 1', date: dateStr }] };
      }
      if (sql.includes('festival_stages')) {
        return { rows: [{ id: 's1', name: 'Stage' }] };
      }
      if (sql.includes('festival_sets')) {
        const hours = new Date(setStartMs).getHours();
        const minutes = new Date(setStartMs).getMinutes();
        return {
          rows: [{
            id: 'set-1', day_index: 0, artist: 'Artist',
            artists: null, stage_id: 's1',
            startTime: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
            endTime: '23:00',
          }],
        };
      }
      if (sql.includes('festival_profiles')) {
        return {
          rows: [{
            id: 'fp-1', userId: 'u1',
            remindersJson: JSON.stringify({ 'set-1': 15 }),
            picksJson: '{}',
          }],
        };
      }
      return { rows: [] };
    });

    const deps = makeDeps({
      pool: { query: queryFn },
      notificationService: { send: notifyFn },
    });
    const scheduler = createReminderScheduler(deps);
    await scheduler.tick();

    // Should NOT fire -- set is 2 hours away, reminder is 15 min before
    assert.equal(notifyFn.mock.calls.length, 0);
  });

  it('handles invalid JSON in remindersJson', async () => {
    const notifyFn = mock.fn(async () => ({ sent: 1 }));
    const logWarnFn = mock.fn();

    const queryFn = mock.fn(async (sql: string) => {
      if (sql.includes('festivals')) return { rows: [{ id: 'f1', name: 'F' }] };
      if (sql.includes('festival_days')) return { rows: [{ day_index: 0, label: 'D1', date: '2026-06-01' }] };
      if (sql.includes('festival_stages')) return { rows: [{ id: 's1', name: 'S' }] };
      if (sql.includes('festival_sets')) {
        return { rows: [{ id: 'set-1', day_index: 0, artist: 'A', artists: null, stage_id: 's1', startTime: '12:00', endTime: '13:00' }] };
      }
      if (sql.includes('festival_profiles')) {
        return {
          rows: [{ id: 'fp-1', userId: 'u1', remindersJson: '{invalid json', picksJson: '{}' }],
        };
      }
      return { rows: [] };
    });

    const deps = makeDeps({
      pool: { query: queryFn },
      notificationService: { send: notifyFn },
      log: { info() {}, warn: logWarnFn, error() {}, debug() {} },
    });
    const scheduler = createReminderScheduler(deps);
    await scheduler.tick();

    // Should not crash and not send notifications
    assert.equal(notifyFn.mock.calls.length, 0);
  });

  it('skips profiles with setReminders disabled', async () => {
    const now = Date.now();
    const setStartMs = now + 15 * 60000;

    const notifyFn = mock.fn(async () => ({ sent: 1 }));
    const prefsFn = mock.fn(async () => ({ setReminders: false }));

    const queryFn = mock.fn(async (sql: string) => {
      if (sql.includes('festivals')) return { rows: [{ id: 'f1', name: 'F' }] };
      if (sql.includes('festival_days')) {
        const dateStr = new Date(setStartMs).toISOString().slice(0, 10);
        return { rows: [{ day_index: 0, label: 'D1', date: dateStr }] };
      }
      if (sql.includes('festival_stages')) return { rows: [{ id: 's1', name: 'S' }] };
      if (sql.includes('festival_sets')) {
        const h = new Date(setStartMs).getHours();
        const m = new Date(setStartMs).getMinutes();
        return {
          rows: [{
            id: 'set-1', day_index: 0, artist: 'A', artists: null, stage_id: 's1',
            startTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, endTime: '23:00',
          }],
        };
      }
      if (sql.includes('festival_profiles')) {
        return {
          rows: [{ id: 'fp-1', userId: 'u1', remindersJson: JSON.stringify({ 'set-1': 15 }), picksJson: '{}' }],
        };
      }
      return { rows: [] };
    });

    const deps = makeDeps({
      pool: { query: queryFn },
      stores: { notificationPrefs: { get: prefsFn } },
      notificationService: { send: notifyFn },
    });
    const scheduler = createReminderScheduler(deps);
    await scheduler.tick();

    // setReminders is false, should not notify
    assert.equal(notifyFn.mock.calls.length, 0);
  });
});
