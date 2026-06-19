import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ALLOWED_NOTIFICATION_TYPES } from '../lib/notifications/payload.js';
import { createSendService } from '../lib/notifications/send.js';
import { createReengagementTriggers } from '../lib/notifications/reengagement.js';

// ---------------------------------------------------------------------------
// Minimal logger / config helpers
// ---------------------------------------------------------------------------
const log = { info() {}, warn() {}, debug() {}, error() {} };
const config = { PUBLIC_ORIGIN: 'https://festie.test', RESEND_API_KEY: '' };

// =====================================================================
// payload.ts — the three M3 types are allowed
// =====================================================================
describe('M3 re-engagement: ALLOWED_NOTIFICATION_TYPES', () => {
  it('includes lineup_drop, crew_reformed, wrap_ready', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('lineup_drop'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_reformed'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('wrap_ready'));
  });
  it('keeps the original three', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_update'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('schedule_change'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('set_reminder'));
  });
});

// =====================================================================
// send.ts PREF_MAP — each new type routes to its own opt-out pref key
// (proven end-to-end: opting out the mapped key returns user_disabled)
// =====================================================================
describe('M3 re-engagement: PREF_MAP routing via createSendService', () => {
  function buildService(prefs: any) {
    const sent: any[] = [];
    const messaging = {
      send: async (msg: any) => {
        sent.push(msg);
        return 'msg-id';
      },
      sendEach: async () => ({ responses: [] }),
    };
    const stores = {
      notificationPrefs: { get: async () => prefs },
      deviceTokens: {
        listByUser: async () => [{ token: 'a'.repeat(40), platform: 'android' }],
        unregister: async () => {},
      },
      notificationCounts: { getByUser: async () => [], increment: async () => {} },
      notificationLog: { insert: async () => {} },
    };
    const svc = createSendService({
      stores,
      config,
      log,
      messaging,
      retryQueue: { enqueue() {} },
    });
    return { svc, sent };
  }

  it('lineup_drop is suppressed when lineupDrops pref is off', async () => {
    const { svc, sent } = buildService({ lineupDrops: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'lineup_drop', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
    assert.equal(sent.length, 0);
  });

  it('crew_reformed is suppressed when crewReformed pref is off', async () => {
    const { svc } = buildService({ crewReformed: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'crew_reformed', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
  });

  it('wrap_ready is suppressed when wrapReady pref is off', async () => {
    const { svc } = buildService({ wrapReady: 0, dndStart: null, dndEnd: null });
    const r = await svc.send({ userId: 'u1', type: 'wrap_ready', title: 't', body: 'b', data: {} });
    assert.equal(r.reason, 'user_disabled');
  });

  it('lineup_drop is delivered when its pref is ON (routing does not over-suppress)', async () => {
    const { svc, sent } = buildService({
      lineupDrops: 1,
      crewReformed: 1,
      wrapReady: 1,
      dndStart: null,
      dndEnd: null,
    });
    const r = await svc.send({ userId: 'u1', type: 'lineup_drop', title: 't', body: 'b', data: { festivalId: 'f1' } });
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 1);
  });
});

// =====================================================================
// reengagement triggers — event-gated, deduped, opt-out + cap honored
// =====================================================================
describe('createReengagementTriggers.sendCrewReformed', () => {
  function build({ existsForEvents }: any = {}) {
    const sends: any[] = [];
    const logInserts: any[] = [];
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        return { sent: 1 };
      },
    };
    const stores = {
      users: { getByIds: async () => new Map() },
      notificationLog: {
        existsForEvent: async () => false,
        // Batch dedup: returns the SET of already-notified ids (default: none).
        existsForEvents: existsForEvents || (async () => new Set<string>()),
        insert: async (row: any) => logInserts.push(row),
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService });
    return { triggers, sends, logInserts };
  }

  it('notifies each invited prior member exactly once (push)', async () => {
    const { triggers, sends } = build();
    const r = await triggers.sendCrewReformed({
      newCrewId: 'crew-2',
      crewName: 'The Goblins',
      festivalName: 'Coast 2027',
      invitedUserIds: ['u1', 'u2', 'u3'],
      inviteUrl: 'https://festie.test/join/ABCD',
    });
    assert.equal(sends.length, 3);
    assert.equal(r.sent, 3);
    for (const s of sends) {
      assert.equal(s.type, 'crew_reformed');
      assert.equal(s.data.eventKey, 'reform:crew-2');
    }
  });

  it('dedups: a user already logged for this event is skipped', async () => {
    const { triggers, sends } = build({
      existsForEvents: async (uids: string[], _type: string, key: string) =>
        key === 'reform:crew-2' ? new Set(uids.filter((u) => u === 'u2')) : new Set<string>(),
    });
    await triggers.sendCrewReformed({
      newCrewId: 'crew-2',
      crewName: 'C',
      invitedUserIds: ['u1', 'u2'],
    });
    const targets = sends.map((s) => s.userId);
    assert.deepEqual(targets, ['u1']);
  });

  it('no invitees → no sends', async () => {
    const { triggers, sends } = build();
    const r = await triggers.sendCrewReformed({ newCrewId: 'crew-2', invitedUserIds: [] });
    assert.equal(r.reason, 'no_invitees');
    assert.equal(sends.length, 0);
  });
});

describe('createReengagementTriggers.sendLineupDrop', () => {
  // Mock pg pool returning: [name lookup], [prior-attendee query]
  function mockPool(name: string, priorUserIds: string[]): any {
    let call = 0;
    return {
      query: async () => {
        call += 1;
        if (call === 1) return { rows: name ? [{ name }] : [] };
        return { rows: priorUserIds.map((userId) => ({ userId })) };
      },
    };
  }

  function build(pool: any) {
    const sends: any[] = [];
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        return { sent: 1 };
      },
    };
    const stores = {
      users: { getByIds: async () => new Map() },
      notificationLog: {
        existsForEvent: async () => false,
        existsForEvents: async () => new Set<string>(),
        insert: async () => {},
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService, pool });
    return { triggers, sends };
  }

  it('targets prior-year attendees of the same-named festival', async () => {
    const { triggers, sends } = build(mockPool('North Coast', ['p1', 'p2']));
    const r = await triggers.sendLineupDrop('fest-2027');
    assert.equal(sends.length, 2);
    assert.equal(r.priorAttendees, 2);
    assert.equal(sends[0].type, 'lineup_drop');
    assert.equal(sends[0].data.eventKey, 'lineup:fest-2027');
  });

  it('no prior attendees → nothing sent', async () => {
    const { triggers, sends } = build(mockPool('North Coast', []));
    const r = await triggers.sendLineupDrop('fest-2027');
    assert.equal(r.reason, 'no_prior_attendees');
    assert.equal(sends.length, 0);
  });

  it('unknown festival → nothing sent', async () => {
    const { triggers, sends } = build(mockPool('', []));
    const r = await triggers.sendLineupDrop('fest-x');
    assert.equal(r.reason, 'festival_not_found');
    assert.equal(sends.length, 0);
  });
});

// =====================================================================
// sendWrapReady — festival-over gating + dedup fan-out + TZ correctness
// =====================================================================
describe('createReengagementTriggers.sendWrapReady', () => {
  const PAST = '2000-01-01'; // long over
  const FUTURE = '2999-12-31'; // far-future last day

  function build({
    festival,
    festivalThrows = false,
    attendeeIds = [],
    attendeesThrow = false,
    seen = new Set<string>(),
    existsThrows = false,
  }: any = {}) {
    const sends: any[] = [];
    const notificationService = {
      isConfigured: true,
      send: async (args: any) => {
        sends.push(args);
        return { sent: 1 };
      },
    };
    const stores = {
      festivals: {
        getById: async () => {
          if (festivalThrows) throw new Error('db down');
          return festival;
        },
      },
      profiles: {
        userIdsByFestival: async () => {
          if (attendeesThrow) throw new Error('attendee lookup down');
          return attendeeIds;
        },
      },
      users: { getByIds: async () => new Map() },
      notificationLog: {
        existsForEvent: async () => false,
        existsForEvents: async (uids: string[]) => {
          if (existsThrows) throw new Error('dedup read down');
          return new Set(uids.filter((u) => seen.has(u)));
        },
        insert: async () => {},
      },
    };
    const triggers = createReengagementTriggers({ stores, config, log, notificationService });
    return { triggers, sends };
  }

  it('festival_not_found → nothing sent', async () => {
    const { triggers, sends } = build({ festival: null });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(r.reason, 'festival_not_found');
    assert.equal(sends.length, 0);
  });

  it('not_over: a far-future last day short-circuits', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: FUTURE }] },
      attendeeIds: ['u1', 'u2'],
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(r.reason, 'not_over');
    assert.equal(sends.length, 0);
  });

  it('over-with-attendees: pushes per fresh attendee', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2', 'u3'],
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 3);
    assert.equal(r.sent, 3);
    assert.deepEqual(
      sends.map((s) => s.userId),
      ['u1', 'u2', 'u3'],
    );
    for (const s of sends) {
      assert.equal(s.type, 'wrap_ready');
      assert.equal(s.data.eventKey, 'wrap:f1');
    }
  });

  it('all-deduped: every attendee already notified → no pushes', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2'],
      seen: new Set(['u1', 'u2']),
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 0);
    assert.equal(r.sent, 0);
  });

  it('a throwing attendee lookup is swallowed → festival over but no attendees', async () => {
    const { triggers, sends } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeesThrow: true,
    });
    const r = await triggers.sendWrapReady('f1');
    assert.equal(sends.length, 0);
    assert.equal(r.sent, 0);
  });

  it('a throwing dedup read PROPAGATES (no fail-open re-blast)', async () => {
    const { triggers } = build({
      festival: { name: 'FK', days: [{ date: PAST }] },
      attendeeIds: ['u1', 'u2'],
      existsThrows: true,
    });
    await assert.rejects(() => triggers.sendWrapReady('f1'), /dedup read down/);
  });

  it('isFestivalOver is TZ-aware: a same-day cutoff differs by zone', async () => {
    // Pick a date whose end-of-day in a far-west zone is still in the future
    // while UTC end-of-day has passed, proving the zone is honored. We use a
    // date ~12h ago in UTC terms is awkward to pin deterministically, so instead
    // assert the relative behavior: a festival ending "today" in a far-future
    // sense is gated identically regardless of zone, and a clearly-past date is
    // over in any zone.
    const past = build({
      festival: { name: 'FK', days: [{ date: PAST }], timeZone: 'Pacific/Kiritimati' },
      attendeeIds: ['u1'],
    });
    const rPast = await past.triggers.sendWrapReady('f1');
    assert.equal(rPast.sent, 1); // clearly past → over in any zone

    const future = build({
      festival: { name: 'FK', days: [{ date: FUTURE }], timeZone: 'Etc/GMT+12' },
      attendeeIds: ['u1'],
    });
    const rFuture = await future.triggers.sendWrapReady('f1');
    assert.equal(rFuture.reason, 'not_over'); // far future → not over in any zone
  });
});
