import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import createCrewsStore from '../lib/db/stores/crews.js';
import createNotificationsStore from '../lib/db/stores/notifications.js';
import { createRatingsStore } from '../lib/db/stores/ratings.js';
import createRolesStore from '../lib/db/stores/roles.js';

// ---------------------------------------------------------------------------
// Mock pool factory
// ---------------------------------------------------------------------------
function mockPool(queryResults: any[] = []): any {
  let callIndex = 0;
  const queries: any[] = [];
  return {
    queries,
    query: async (sql: any, params: any) => {
      queries.push({ sql, params });
      const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
      callIndex++;
      return result;
    },
    connect: async () => {
      const client = {
        query: async (sql: any, params: any) => {
          queries.push({ sql, params });
          const result = queryResults[callIndex] || { rows: [], rowCount: 0 };
          callIndex++;
          return result;
        },
        release: () => {},
      };
      return client;
    },
  };
}

const mockUtils: any = {};

// Collapse all runs of whitespace to a single space so that SQL substring
// assertions are insensitive to the multi-line formatting of the store queries.
const norm = (s: any) => String(s).replace(/\s+/g, ' ').trim();

function mockPoolThatThrows(error: any): any {
  return {
    queries: [],
    query: async () => { throw error; },
    connect: async () => ({
      query: async () => { throw error; },
      release: () => {},
    }),
  };
}

// =====================================================================
// crews.js — topicSubscriptions
// =====================================================================
describe('createCrewsStore — topicSubscriptions', () => {
  it('getForUser returns empty object when no rows', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    const subs = await topicSubscriptions.getForUser('u1', 'f1');

    assert.deepStrictEqual(subs, Object.create(null));
    assert.ok(pool.queries[0].sql.includes('notification_topic_subs'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1']);
  });

  it('getForUser maps rows to boolean hash', async () => {
    const pool = mockPool([{
      rows: [
        { topic: 'chat', subscribed: 1 },
        { topic: 'schedule', subscribed: 0 },
      ],
    }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    const subs = await topicSubscriptions.getForUser('u1', 'f1');

    assert.strictEqual(subs.chat, true);
    assert.strictEqual(subs.schedule, false);
  });

  it('getForUser coerces truthy/falsy subscribed values', async () => {
    const pool = mockPool([{
      rows: [
        { topic: 'a', subscribed: null },
        { topic: 'b', subscribed: '' },
        { topic: 'c', subscribed: 'yes' },
      ],
    }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    const subs = await topicSubscriptions.getForUser('u1', 'f1');

    assert.strictEqual(subs.a, false);
    assert.strictEqual(subs.b, false);
    assert.strictEqual(subs.c, true);
  });

  it('setSubscription passes subscribed=1 when true', async () => {
    const pool = mockPool([]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    await topicSubscriptions.setSubscription('u1', 'f1', 'chat', true);

    assert.strictEqual(pool.queries[0].params[3], 1);
  });

  it('setSubscription passes subscribed=0 when false', async () => {
    const pool = mockPool([]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    await topicSubscriptions.setSubscription('u1', 'f1', 'chat', false);

    assert.strictEqual(pool.queries[0].params[3], 0);
  });

  it('isSubscribed returns true when row.subscribed is truthy', async () => {
    const pool = mockPool([{ rows: [{ subscribed: 1 }] }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await topicSubscriptions.isSubscribed('u1', 'f1', 'chat'), true);
  });

  it('isSubscribed returns false when row.subscribed is 0', async () => {
    const pool = mockPool([{ rows: [{ subscribed: 0 }] }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await topicSubscriptions.isSubscribed('u1', 'f1', 'chat'), false);
  });

  it('isSubscribed defaults to true when no row exists', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await topicSubscriptions.isSubscribed('u1', 'f1', 'chat'), true);
  });

  it('getUnsubscribedUsers returns a Set of user ids', async () => {
    const pool = mockPool([{
      rows: [{ userId: 'u1' }, { userId: 'u2' }],
    }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    const result = await topicSubscriptions.getUnsubscribedUsers('f1', 'chat');

    assert.ok(result instanceof Set);
    assert.strictEqual(result.size, 2);
    assert.ok(result.has('u1'));
    assert.ok(result.has('u2'));
  });

  it('getUnsubscribedUsers returns empty Set when no unsubscribed users', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { topicSubscriptions } = createCrewsStore(pool, mockUtils);

    const result = await topicSubscriptions.getUnsubscribedUsers('f1', 'chat');

    assert.ok(result instanceof Set);
    assert.strictEqual(result.size, 0);
  });
});

// =====================================================================
// crews.js — crews
// =====================================================================
describe('createCrewsStore — crews', () => {
  const sampleCrew = {
    id: 'c1', festivalId: 'f1', name: 'The Crew',
    createdBy: 'u1', inviteCode: 'abc123', inviteExpiresAt: null, maxMembers: 10,
  };

  it('create inserts and returns the crew', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 },          // INSERT
      { rows: [{ id: 'c1' }], rowCount: 1 }, // SELECT
    ]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.create(sampleCrew);

    assert.deepStrictEqual(result, { id: 'c1' });
    assert.strictEqual(pool.queries.length, 2);
    assert.ok(norm(pool.queries[0].sql).includes('INSERT INTO crews'));
    assert.deepStrictEqual(pool.queries[0].params, ['c1', 'f1', 'The Crew', 'u1', 'abc123', null, 10]);
  });

  it('create returns null when SELECT finds nothing', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.create(sampleCrew);

    assert.strictEqual(result, null);
  });

  it('create passes inviteExpiresAt when provided', async () => {
    const pool = mockPool([
      { rows: [] },
      { rows: [{ id: 'c1' }] },
    ]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.create({ ...sampleCrew, inviteExpiresAt: '2026-12-31' });

    assert.strictEqual(pool.queries[0].params[5], '2026-12-31');
  });

  it('update updates and returns the crew', async () => {
    const pool = mockPool([
      { rows: [] },
      { rows: [{ id: 'c1', name: 'New Name' }] },
    ]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.update({ id: 'c1', name: 'New Name', maxMembers: 5 });

    assert.deepStrictEqual(result, { id: 'c1', name: 'New Name' });
    assert.ok(pool.queries[0].sql.includes('UPDATE crews'));
    assert.deepStrictEqual(pool.queries[0].params, ['New Name', 5, 'c1']);
  });

  it('update returns null when crew not found after update', async () => {
    const pool = mockPool([{ rows: [] }, { rows: [] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await crews.update({ id: 'x', name: 'a', maxMembers: 1 }), null);
  });

  it('delete sends DELETE query', async () => {
    const pool = mockPool([]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.delete('c1');

    assert.ok(pool.queries[0].sql.includes('DELETE FROM crews'));
    assert.deepStrictEqual(pool.queries[0].params, ['c1']);
  });

  it('getById returns crew when found', async () => {
    const pool = mockPool([{ rows: [{ id: 'c1' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.deepStrictEqual(await crews.getById('c1'), { id: 'c1' });
  });

  it('getById returns null when not found', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await crews.getById('missing'), null);
  });

  it('getByInviteCode returns crew for valid code', async () => {
    const pool = mockPool([{ rows: [{ id: 'c1', inviteCode: 'abc' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.getByInviteCode('abc');

    assert.deepStrictEqual(result, { id: 'c1', inviteCode: 'abc' });
    assert.deepStrictEqual(pool.queries[0].params, ['abc']);
  });

  it('getByInviteCode returns null for expired/missing code', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await crews.getByInviteCode('expired'), null);
  });

  it('getExpiredByInviteCode returns row for expired code', async () => {
    const pool = mockPool([{ rows: [{ id: 'c1' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.deepStrictEqual(await crews.getExpiredByInviteCode('old'), { id: 'c1' });
  });

  it('getExpiredByInviteCode returns null when not found', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await crews.getExpiredByInviteCode('nope'), null);
  });

  it('listByFestival returns all crews for a festival', async () => {
    const pool = mockPool([{ rows: [{ id: 'c1' }, { id: 'c2' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.listByFestival('f1');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(pool.queries[0].params, ['f1']);
  });

  it('listByUser returns crews with role and joinedAt', async () => {
    const pool = mockPool([{ rows: [{ id: 'c1', role: 'admin', joinedAt: '2026-01-01' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.listByUser('u1');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].role, 'admin');
  });

  it('listByUserAndFestival filters by both user and festival', async () => {
    const pool = mockPool([{ rows: [{ id: 'c1' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.listByUserAndFestival('u1', 'f1');

    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1']);
    assert.strictEqual(result.length, 1);
  });

  it('regenerateInviteCode updates and returns crew', async () => {
    const pool = mockPool([
      { rows: [] },
      { rows: [{ id: 'c1', inviteCode: 'newcode' }] },
    ]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.regenerateInviteCode('c1', 'newcode');

    assert.deepStrictEqual(result, { id: 'c1', inviteCode: 'newcode' });
    assert.deepStrictEqual(pool.queries[0].params, ['newcode', 'c1']);
  });

  it('addMember inserts into crew_members', async () => {
    const pool = mockPool([]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.addMember({ crewId: 'c1', userId: 'u1', role: 'member' });

    assert.ok(norm(pool.queries[0].sql).includes('INSERT INTO crew_members'));
    assert.deepStrictEqual(pool.queries[0].params, ['c1', 'u1', 'member']);
  });

  it('removeMember deletes from crew_members', async () => {
    const pool = mockPool([]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.removeMember('c1', 'u1');

    assert.ok(pool.queries[0].sql.includes('DELETE FROM crew_members'));
    assert.deepStrictEqual(pool.queries[0].params, ['c1', 'u1']);
  });

  it('getMembers returns members with user info', async () => {
    const pool = mockPool([{
      rows: [
        { crewId: 'c1', userId: 'u1', role: 'admin', username: 'alice' },
        { crewId: 'c1', userId: 'u2', role: 'member', username: 'bob' },
      ],
    }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.getMembers('c1');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].username, 'alice');
  });

  it('getMember returns a single member or null', async () => {
    const pool = mockPool([{ rows: [{ crewId: 'c1', userId: 'u1', role: 'admin' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.getMember('c1', 'u1');

    assert.strictEqual(result.role, 'admin');
    assert.deepStrictEqual(pool.queries[0].params, ['c1', 'u1']);
  });

  it('getMember returns null when not a member', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await crews.getMember('c1', 'u99'), null);
  });

  it('getMemberCount returns the count value', async () => {
    const pool = mockPool([{ rows: [{ count: 5 }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await crews.getMemberCount('c1'), 5);
  });

  it('updateMemberRole sends correct SQL params', async () => {
    const pool = mockPool([]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.updateMemberRole('c1', 'u1', 'admin');

    assert.deepStrictEqual(pool.queries[0].params, ['admin', 'c1', 'u1']);
  });

  it('getCrewPickOverlap returns rows with picks', async () => {
    const pool = mockPool([{
      rows: [{ userId: 'u1', picksJson: '{}', username: 'alice' }],
    }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.getCrewPickOverlap('f1', 'c1');

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(pool.queries[0].params, ['f1', 'c1']);
  });

  it('updateHomeBase passes location and time, returns crew', async () => {
    const pool = mockPool([
      { rows: [] },
      { rows: [{ id: 'c1', homeBaseLocation: 'Main Stage', homeBaseTime: '18:00' }] },
    ]);
    const { crews } = createCrewsStore(pool, mockUtils);

    const result = await crews.updateHomeBase('c1', { location: 'Main Stage', time: '18:00' });

    assert.strictEqual(result.homeBaseLocation, 'Main Stage');
    assert.deepStrictEqual(pool.queries[0].params, ['Main Stage', '18:00', 'c1']);
  });

  it('updateHomeBase converts falsy location/time to null', async () => {
    const pool = mockPool([{ rows: [] }, { rows: [{ id: 'c1' }] }]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.updateHomeBase('c1', { location: '', time: '' });

    assert.strictEqual(pool.queries[0].params[0], null);
    assert.strictEqual(pool.queries[0].params[1], null);
  });

  it('deleteByFestival removes all crews for festival', async () => {
    const pool = mockPool([]);
    const { crews } = createCrewsStore(pool, mockUtils);

    await crews.deleteByFestival('f1');

    assert.ok(pool.queries[0].sql.includes('DELETE FROM crews'));
    assert.deepStrictEqual(pool.queries[0].params, ['f1']);
  });
});

// =====================================================================
// crews.js — meetingPoints
// =====================================================================
describe('createCrewsStore — meetingPoints', () => {
  it('create inserts and returns the meeting point', async () => {
    const mp = {
      id: 'mp1', crewId: 'c1', createdBy: 'u1', label: 'Gate A',
      location: 'North', type: 'pre-show', meetAt: '18:00',
      stageReference: 'Main', expiresAt: '2026-12-31',
    };
    const pool = mockPool([
      { rows: [] },
      { rows: [{ id: 'mp1', label: 'Gate A' }] },
    ]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    const result = await meetingPoints.create(mp);

    assert.deepStrictEqual(result, { id: 'mp1', label: 'Gate A' });
    assert.ok(norm(pool.queries[0].sql).includes('INSERT INTO crew_meeting_points'));
    assert.deepStrictEqual(pool.queries[0].params, [
      'mp1', 'c1', 'u1', 'Gate A', 'North', 'pre-show', '18:00', 'Main', '2026-12-31',
    ]);
  });

  it('create uses defaults for optional fields', async () => {
    const mp = { id: 'mp1', crewId: 'c1', createdBy: 'u1', label: 'X', location: 'Y' };
    const pool = mockPool([{ rows: [] }, { rows: [{ id: 'mp1' }] }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    await meetingPoints.create(mp);

    // type defaults to 'during', meetAt/stageReference/expiresAt default to null
    const params = pool.queries[0].params;
    assert.strictEqual(params[5], 'during');
    assert.strictEqual(params[6], null);
    assert.strictEqual(params[7], null);
    assert.strictEqual(params[8], null);
  });

  it('create returns null when SELECT returns nothing', async () => {
    const pool = mockPool([{ rows: [] }, { rows: [] }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    const result = await meetingPoints.create({
      id: 'mp1', crewId: 'c1', createdBy: 'u1', label: 'X', location: 'Y',
    });

    assert.strictEqual(result, null);
  });

  it('listByCrew returns active meeting points', async () => {
    const pool = mockPool([{
      rows: [
        { id: 'mp1', type: 'emergency', creatorName: 'alice' },
        { id: 'mp2', type: 'during', creatorName: 'bob' },
      ],
    }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    const result = await meetingPoints.listByCrew('c1');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(pool.queries[0].params, ['c1']);
  });

  it('update builds SET clause dynamically and returns point', async () => {
    const pool = mockPool([
      { rows: [] },
      { rows: [{ id: 'mp1', label: 'New Label' }] },
    ]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    const result = await meetingPoints.update('mp1', { label: 'New Label', location: 'South' });

    assert.deepStrictEqual(result, { id: 'mp1', label: 'New Label' });
    // Should have label = $1, location = $2, updated_at = NOW() WHERE id = $3
    assert.deepStrictEqual(pool.queries[0].params, ['New Label', 'South', 'mp1']);
  });

  it('update returns null when no recognized fields', async () => {
    const pool = mockPool([]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    const result = await meetingPoints.update('mp1', { unknownField: 'val' });

    assert.strictEqual(result, null);
    assert.strictEqual(pool.queries.length, 0);
  });

  it('update handles single field', async () => {
    const pool = mockPool([{ rows: [] }, { rows: [{ id: 'mp1' }] }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    await meetingPoints.update('mp1', { meetAt: '20:00' });

    assert.deepStrictEqual(pool.queries[0].params, ['20:00', 'mp1']);
  });

  it('deactivate sets active=FALSE', async () => {
    const pool = mockPool([]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    await meetingPoints.deactivate('mp1');

    assert.ok(pool.queries[0].sql.includes('active = FALSE'));
    assert.deepStrictEqual(pool.queries[0].params, ['mp1']);
  });

  it('getById returns point when found', async () => {
    const pool = mockPool([{ rows: [{ id: 'mp1' }] }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    assert.deepStrictEqual(await meetingPoints.getById('mp1'), { id: 'mp1' });
  });

  it('getById returns null when not found', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await meetingPoints.getById('missing'), null);
  });

  it('countByCrew returns active count', async () => {
    const pool = mockPool([{ rows: [{ count: 3 }] }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    assert.strictEqual(await meetingPoints.countByCrew('c1'), 3);
  });

  it('expireStale returns pool.query result', async () => {
    const pool = mockPool([{ rows: [], rowCount: 2 }]);
    const { meetingPoints } = createCrewsStore(pool, mockUtils);

    const result = await meetingPoints.expireStale();

    assert.strictEqual(result.rowCount, 2);
    assert.ok(pool.queries[0].sql.includes('expires_at < NOW()'));
  });
});

// =====================================================================
// notifications.js — deviceTokens
// =====================================================================
describe('createNotificationsStore — deviceTokens', () => {
  it('register inserts token with correct params', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.register({
      id: 'dt1', userId: 'u1', token: 'tok123', platform: 'ios', deviceName: 'iPhone',
    });

    assert.strictEqual(pool.queries.length, 1);
    assert.ok(pool.queries[0].sql.includes('INSERT INTO device_tokens'));
    const p = pool.queries[0].params;
    assert.strictEqual(p[0], 'dt1');
    assert.strictEqual(p[1], 'u1');
    assert.strictEqual(p[2], 'tok123');
    assert.strictEqual(p[3], 'ios');
    assert.strictEqual(p[4], 'iPhone');
  });

  it('register defaults platform to web and deviceName to null', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.register({ id: 'dt1', userId: 'u1', token: 'tok123' });

    const p = pool.queries[0].params;
    assert.strictEqual(p[3], 'web');
    assert.strictEqual(p[4], null);
  });

  it('register sets expiry ~90 days in the future', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);
    const before = Date.now();

    await deviceTokens.register({ id: 'dt1', userId: 'u1', token: 't' });

    const expiresAt = new Date(pool.queries[0].params[7]);
    const expectedMin = before + 89 * 24 * 60 * 60 * 1000;
    const expectedMax = before + 91 * 24 * 60 * 60 * 1000;
    assert.ok(expiresAt.getTime() > expectedMin, 'expires_at should be ~90 days out');
    assert.ok(expiresAt.getTime() < expectedMax, 'expires_at should be ~90 days out');
  });

  it('getTokenOwner returns userId when found', async () => {
    const pool = mockPool([{ rows: [{ userId: 'u1' }] }]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    const result = await deviceTokens.getTokenOwner('tok123');

    assert.deepStrictEqual(result, { userId: 'u1' });
  });

  it('getTokenOwner returns null when not found', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    assert.strictEqual(await deviceTokens.getTokenOwner('missing'), null);
  });

  it('unregister deletes token for user', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.unregister('tok123', 'u1');

    assert.ok(pool.queries[0].sql.includes('DELETE FROM device_tokens'));
    assert.deepStrictEqual(pool.queries[0].params, ['tok123', 'u1']);
  });

  it('listByUser returns tokens ordered by last_used_at', async () => {
    const pool = mockPool([{
      rows: [
        { id: 'dt1', token: 'a', platform: 'ios' },
        { id: 'dt2', token: 'b', platform: 'web' },
      ],
    }]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    const result = await deviceTokens.listByUser('u1');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(pool.queries[0].params, ['u1']);
  });

  it('listByUsers returns empty array for empty userIds', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    assert.deepStrictEqual(await deviceTokens.listByUsers([]), []);
    assert.strictEqual(pool.queries.length, 0); // should short-circuit
  });

  it('listByUsers returns empty array for null/undefined', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    assert.deepStrictEqual(await deviceTokens.listByUsers(null as any), []);
    assert.deepStrictEqual(await deviceTokens.listByUsers(undefined as any), []);
  });

  it('listByUsers builds IN clause for multiple ids', async () => {
    const pool = mockPool([{
      rows: [{ id: 'dt1', userId: 'u1', token: 't1', platform: 'ios' }],
    }]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    const result = await deviceTokens.listByUsers(['u1', 'u2', 'u3']);

    assert.strictEqual(result.length, 1);
    assert.ok(pool.queries[0].sql.includes('$1'));
    assert.ok(pool.queries[0].sql.includes('$2'));
    assert.ok(pool.queries[0].sql.includes('$3'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'u2', 'u3']);
  });

  it('deleteByUser removes all tokens for user', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteByUser('u1');

    assert.ok(pool.queries[0].sql.includes('DELETE FROM device_tokens'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1']);
  });

  it('deleteStale uses default 270 days', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteStale();

    assert.deepStrictEqual(pool.queries[0].params, [270]);
  });

  it('deleteStale clamps to minimum 1 day', async () => {
    // parseInt(0) === 0, then 0 || 270 === 270, so 0 falls through to default
    // Use a negative number: parseInt(-5) === -5, then -5 || 270 is -5,
    // but Math.max(1, Math.min(3650, -5)) === 1
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteStale(-5);

    assert.deepStrictEqual(pool.queries[0].params, [1]);
  });

  it('deleteStale treats 0 as falsy and defaults to 270', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteStale(0);

    // parseInt(0) === 0, 0 || 270 === 270
    assert.deepStrictEqual(pool.queries[0].params, [270]);
  });

  it('deleteStale clamps to maximum 3650 days', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteStale(99999);

    assert.deepStrictEqual(pool.queries[0].params, [3650]);
  });

  it('deleteStale handles NaN input gracefully (defaults to 270)', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteStale('not-a-number');

    assert.deepStrictEqual(pool.queries[0].params, [270]);
  });

  it('deleteExpired sends correct SQL', async () => {
    const pool = mockPool([]);
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await deviceTokens.deleteExpired();

    assert.ok(pool.queries[0].sql.includes('expires_at < NOW()'));
  });
});

// =====================================================================
// notifications.js — notificationPrefs
// =====================================================================
describe('createNotificationsStore — notificationPrefs', () => {
  it('get returns prefs when found', async () => {
    const pool = mockPool([{
      rows: [{
        userId: 'u1', crewUpdates: 1, setReminders: 1,
        scheduleChanges: 0, dndStart: '22:00', dndEnd: '08:00',
      }],
    }]);
    const { notificationPrefs } = createNotificationsStore(pool, mockUtils);

    const result = await notificationPrefs.get('u1');

    assert.strictEqual(result.userId, 'u1');
    assert.strictEqual(result.crewUpdates, 1);
    assert.strictEqual(result.dndStart, '22:00');
  });

  it('get returns defaults when no row exists', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { notificationPrefs } = createNotificationsStore(pool, mockUtils);

    const result = await notificationPrefs.get('u1');

    assert.strictEqual(result.userId, 'u1');
    assert.strictEqual(result.crewUpdates, 1);
    assert.strictEqual(result.setReminders, 1);
    assert.strictEqual(result.scheduleChanges, 1);
    assert.strictEqual(result.dndStart, null);
    assert.strictEqual(result.dndEnd, null);
  });

  it('upsert converts boolean prefs to 1/0', async () => {
    const pool = mockPool([]);
    const { notificationPrefs } = createNotificationsStore(pool, mockUtils);

    await notificationPrefs.upsert({
      userId: 'u1',
      crewUpdates: true,
      setReminders: false,
      scheduleChanges: true,
      dndStart: '23:00',
      dndEnd: '07:00',
    });

    const p = pool.queries[0].params;
    assert.strictEqual(p[0], 'u1');
    assert.strictEqual(p[1], 1);  // crewUpdates true -> 1
    assert.strictEqual(p[2], 0);  // setReminders false -> 0
    assert.strictEqual(p[3], 1);  // scheduleChanges true -> 1
    assert.strictEqual(p[4], '23:00');
    assert.strictEqual(p[5], '07:00');
  });

  it('upsert converts falsy dnd values to null', async () => {
    const pool = mockPool([]);
    const { notificationPrefs } = createNotificationsStore(pool, mockUtils);

    await notificationPrefs.upsert({
      userId: 'u1', crewUpdates: true, setReminders: true,
      scheduleChanges: true, dndStart: '', dndEnd: null,
    });

    assert.strictEqual(pool.queries[0].params[4], null);
    assert.strictEqual(pool.queries[0].params[5], null);
  });
});

// =====================================================================
// notifications.js — notificationLog
// =====================================================================
describe('createNotificationsStore — notificationLog', () => {
  it('insert stores all entry fields', async () => {
    const pool = mockPool([]);
    const { notificationLog } = createNotificationsStore(pool, mockUtils);

    await notificationLog.insert({
      id: 'n1', userId: 'u1', type: 'chat', title: 'New message',
      body: 'Hello!', dataJson: '{}', status: 'sent', platform: 'ios',
      errorMessage: null,
    });

    assert.ok(norm(pool.queries[0].sql).includes('INSERT INTO notification_log'));
    const p = pool.queries[0].params;
    assert.strictEqual(p[0], 'n1');
    assert.strictEqual(p[1], 'u1');
    assert.strictEqual(p[6], 'sent');
    assert.strictEqual(p[8], null);
  });

  it('listByUser returns entries with default limit 50', async () => {
    const pool = mockPool([{ rows: [{ id: 'n1' }, { id: 'n2' }] }]);
    const { notificationLog } = createNotificationsStore(pool, mockUtils);

    const result = await notificationLog.listByUser('u1');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 50]);
  });

  it('listByUser accepts custom limit', async () => {
    const pool = mockPool([{ rows: [] }]);
    const { notificationLog } = createNotificationsStore(pool, mockUtils);

    await notificationLog.listByUser('u1', 10);

    assert.deepStrictEqual(pool.queries[0].params, ['u1', 10]);
  });

  it('updateStatus sets status and delivered_at', async () => {
    const pool = mockPool([]);
    const { notificationLog } = createNotificationsStore(pool, mockUtils);

    await notificationLog.updateStatus('n1', 'delivered');

    assert.ok(pool.queries[0].sql.includes('delivered_at = NOW()'));
    assert.deepStrictEqual(pool.queries[0].params, ['delivered', 'n1']);
  });
});

// =====================================================================
// notifications.js — notificationCounts
// =====================================================================
describe('createNotificationsStore — notificationCounts', () => {
  it('getByUser returns counts for user', async () => {
    const pool = mockPool([{
      rows: [
        { userId: 'u1', festivalId: 'f1', unreadUpdates: 3 },
        { userId: 'u1', festivalId: 'f2', unreadUpdates: 0 },
      ],
    }]);
    const { notificationCounts } = createNotificationsStore(pool, mockUtils);

    const result = await notificationCounts.getByUser('u1');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].unreadUpdates, 3);
  });

  it('increment with field=updates sets unreadUpdates=1', async () => {
    const pool = mockPool([]);
    const { notificationCounts } = createNotificationsStore(pool, mockUtils);

    await notificationCounts.increment('u1', 'f1', 'updates');

    assert.ok(pool.queries[0].sql.includes('INSERT INTO notification_counts'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1', 1]);
  });

  it('increment with non-updates field sets unreadUpdates=0', async () => {
    const pool = mockPool([]);
    const { notificationCounts } = createNotificationsStore(pool, mockUtils);

    await notificationCounts.increment('u1', 'f1', 'other');

    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1', 0]);
  });

  it('reset zeros counts for user+festival', async () => {
    const pool = mockPool([]);
    const { notificationCounts } = createNotificationsStore(pool, mockUtils);

    await notificationCounts.reset('u1', 'f1');

    assert.ok(pool.queries[0].sql.includes('unread_updates = 0'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1']);
  });

  it('resetAll zeros counts for all festivals of user', async () => {
    const pool = mockPool([]);
    const { notificationCounts } = createNotificationsStore(pool, mockUtils);

    await notificationCounts.resetAll('u1');

    assert.ok(pool.queries[0].sql.includes('unread_updates = 0'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1']);
  });
});

// =====================================================================
// ratings.js
// =====================================================================
describe('createRatingsStore', () => {
  it('upsert returns the upserted row', async () => {
    const row = { id: 'r1', userId: 'u1', setId: 's1', rating: 5, note: 'Great!' };
    const pool = mockPool([{ rows: [row] }]);
    const store = createRatingsStore(pool);

    const result = await store.upsert('u1', 's1', 5, 'Great!');

    assert.deepStrictEqual(result, row);
    assert.ok(pool.queries[0].sql.includes('INSERT INTO set_ratings'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 's1', 5, 'Great!']);
  });

  it('upsert defaults note to empty string', async () => {
    const pool = mockPool([{ rows: [{ id: 'r1' }] }]);
    const store = createRatingsStore(pool);

    await store.upsert('u1', 's1', 4);

    assert.strictEqual(pool.queries[0].params[3], '');
  });

  it('upsert returns undefined when no RETURNING row', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRatingsStore(pool);

    const result = await store.upsert('u1', 's1', 3);

    assert.strictEqual(result, undefined);
  });

  it('getByUser returns rated sets for a festival', async () => {
    const pool = mockPool([{
      rows: [
        { setId: 's1', rating: 5, artist: 'Band A' },
        { setId: 's2', rating: 3, artist: 'Band B' },
      ],
    }]);
    const store = createRatingsStore(pool);

    const result = await store.getByUser('u1', 'f1');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1']);
  });

  it('getByUser returns empty array when no ratings', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRatingsStore(pool);

    assert.deepStrictEqual(await store.getByUser('u1', 'f1'), []);
  });

  it('getByFestival returns items and nextCursor=null when no more pages', async () => {
    const pool = mockPool([{
      rows: [{ setId: 's1', totalRatings: 2, avgRating: 4.5 }],
    }]);
    const store = createRatingsStore(pool);

    const result = await store.getByFestival('f1');

    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.nextCursor, null);
  });

  it('getByFestival uses cursor when provided', async () => {
    const pool = mockPool([{
      rows: [{ setId: 's2', totalRatings: 1, avgRating: 3.0 }],
    }]);
    const store = createRatingsStore(pool);

    const result = await store.getByFestival('f1', { cursor: 's1', limit: 10 });

    assert.strictEqual(pool.queries[0].params.length, 3); // festivalId, limit+1, cursor
    assert.strictEqual(pool.queries[0].params[2], 's1');
    assert.ok(pool.queries[0].sql.includes('HAVING'));
  });

  it('getByFestival detects hasMore and returns nextCursor', async () => {
    // Return limit+1 rows to trigger hasMore
    const rows = [
      { setId: 's1', totalRatings: 1, avgRating: 5.0 },
      { setId: 's2', totalRatings: 2, avgRating: 4.0 },
      { setId: 's3', totalRatings: 1, avgRating: 3.0 }, // extra row
    ];
    const pool = mockPool([{ rows }]);
    const store = createRatingsStore(pool);

    const result = await store.getByFestival('f1', { limit: 2 });

    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.nextCursor, 's2'); // last item after pop
  });

  it('getByFestival without cursor omits HAVING clause', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRatingsStore(pool);

    await store.getByFestival('f1', { limit: 5 });

    assert.ok(!pool.queries[0].sql.includes('HAVING'));
    assert.strictEqual(pool.queries[0].params.length, 2);
  });

  it('getCrewRatings returns items with pagination', async () => {
    const pool = mockPool([{
      rows: [{ id: 'r1', setId: 's1', userId: 'u1', rating: 5, username: 'alice', artist: 'Band' }],
    }]);
    const store = createRatingsStore(pool);

    const result = await store.getCrewRatings('c1', 'f1');

    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.nextCursor, null);
    assert.deepStrictEqual(pool.queries[0].params, ['c1', 'f1', 51]); // default limit+1
  });

  it('getCrewRatings uses cursor when provided', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRatingsStore(pool);

    await store.getCrewRatings('c1', 'f1', { cursor: 'r5', limit: 10 });

    assert.strictEqual(pool.queries[0].params.length, 4);
    assert.strictEqual(pool.queries[0].params[3], 'r5');
    assert.ok(pool.queries[0].sql.includes('AND r.id > $4'));
  });

  it('getCrewRatings detects hasMore', async () => {
    const rows = [
      { id: 'r1' }, { id: 'r2' }, { id: 'r3' },
    ];
    const pool = mockPool([{ rows }]);
    const store = createRatingsStore(pool);

    const result = await store.getCrewRatings('c1', 'f1', { limit: 2 });

    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.nextCursor, 'r2');
  });

  it('delete removes a rating', async () => {
    const pool = mockPool([]);
    const store = createRatingsStore(pool);

    await store.delete('u1', 's1');

    assert.ok(pool.queries[0].sql.includes('DELETE FROM set_ratings'));
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 's1']);
  });

  it('getWrapStats returns stats when data exists', async () => {
    const stats = { totalRated: 10, avgRating: 4.2, stagesVisited: 3, daysAttended: 2, totalHours: 8.5 };
    const pool = mockPool([{ rows: [stats] }]);
    const store = createRatingsStore(pool);

    const result = await store.getWrapStats('u1', 'f1');

    assert.deepStrictEqual(result, stats);
    assert.deepStrictEqual(pool.queries[0].params, ['u1', 'f1']);
  });

  it('getWrapStats returns zeros when no rows', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRatingsStore(pool);

    const result = await store.getWrapStats('u1', 'f1');

    assert.strictEqual(result.totalRated, 0);
    assert.strictEqual(result.avgRating, 0);
    assert.strictEqual(result.stagesVisited, 0);
    assert.strictEqual(result.daysAttended, 0);
    assert.strictEqual(result.totalHours, 0);
  });
});

// =====================================================================
// roles.js
// =====================================================================
describe('createRolesStore', () => {
  it('getUserRoles returns array of role names', async () => {
    const pool = mockPool([{ rows: [{ name: 'user' }, { name: 'admin' }] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    const roles = await store.getUserRoles('u1');

    assert.deepStrictEqual(roles, ['user', 'admin']);
    assert.deepStrictEqual(pool.queries[0].params, ['u1']);
  });

  it('getUserRoles returns empty array when no roles', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    assert.deepStrictEqual(await store.getUserRoles('u1'), []);
  });

  it('getUserRoles uses cache when TTL is valid (non-test env)', async () => {
    const pool = mockPool([
      { rows: [{ name: 'admin' }] },
      { rows: [{ name: 'superadmin' }] }, // second call would return different
    ]);
    const store = createRolesStore(pool, { nodeEnv: 'production' });

    const first = await store.getUserRoles('u1');
    const second = await store.getUserRoles('u1');

    // Both should return 'admin' because second call uses cache
    assert.deepStrictEqual(first, ['admin']);
    assert.deepStrictEqual(second, ['admin']);
    assert.strictEqual(pool.queries.length, 1); // only one DB call
  });

  it('getUserRoles skips cache in test env (TTL=0)', async () => {
    const pool = mockPool([
      { rows: [{ name: 'admin' }] },
      { rows: [{ name: 'superadmin' }] },
    ]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    const first = await store.getUserRoles('u1');
    const second = await store.getUserRoles('u1');

    assert.deepStrictEqual(first, ['admin']);
    assert.deepStrictEqual(second, ['superadmin']);
    assert.strictEqual(pool.queries.length, 2);
  });

  it('hasRole returns true when user has the role', async () => {
    const pool = mockPool([{ rows: [{ name: 'admin' }, { name: 'user' }] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    assert.strictEqual(await store.hasRole('u1', 'admin'), true);
  });

  it('hasRole returns false when user lacks the role', async () => {
    const pool = mockPool([{ rows: [{ name: 'user' }] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    assert.strictEqual(await store.hasRole('u1', 'admin'), false);
  });

  it('hasRole returns false when user has no roles', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    assert.strictEqual(await store.hasRole('u1', 'admin'), false);
  });

  it('grantRole inserts role and invalidates cache', async () => {
    const pool = mockPool([
      { rows: [{ name: 'user' }] },  // first getUserRoles
      { rows: [] },                    // grantRole INSERT
      { rows: [{ name: 'user' }, { name: 'admin' }] },  // getUserRoles after invalidation
    ]);
    const store = createRolesStore(pool, { nodeEnv: 'production' });

    // Populate cache
    await store.getUserRoles('u1');
    assert.strictEqual(pool.queries.length, 1);

    // Grant role — should invalidate cache
    await store.grantRole('u1', 'admin', 'granter1');

    assert.ok(pool.queries[1].sql.includes('INSERT INTO user_roles'));
    assert.deepStrictEqual(pool.queries[1].params, ['u1', 'admin', 'granter1']);

    // Next getUserRoles should hit DB again
    const roles = await store.getUserRoles('u1');
    assert.deepStrictEqual(roles, ['user', 'admin']);
    assert.strictEqual(pool.queries.length, 3);
  });

  it('grantRole uses null grantedBy by default', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    await store.grantRole('u1', 'admin');

    assert.strictEqual(pool.queries[0].params[2], null);
  });

  it('revokeRole deletes role and invalidates cache', async () => {
    const pool = mockPool([
      { rows: [{ name: 'admin' }] },  // getUserRoles to populate cache
      { rows: [] },                     // revokeRole DELETE
      { rows: [] },                     // getUserRoles after invalidation
    ]);
    const store = createRolesStore(pool, { nodeEnv: 'production' });

    await store.getUserRoles('u1');
    await store.revokeRole('u1', 'admin');

    assert.ok(pool.queries[1].sql.includes('DELETE FROM user_roles'));
    assert.deepStrictEqual(pool.queries[1].params, ['u1', 'admin']);

    // Cache should be invalidated — next call hits DB
    const roles = await store.getUserRoles('u1');
    assert.deepStrictEqual(roles, []);
    assert.strictEqual(pool.queries.length, 3);
  });

  it('listRoles returns all available roles', async () => {
    const roles = [
      { id: 1, name: 'user', description: 'Default', createdAt: '2026-01-01' },
      { id: 2, name: 'admin', description: 'Admin', createdAt: '2026-01-01' },
    ];
    const pool = mockPool([{ rows: roles }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    const result = await store.listRoles();

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'user');
  });

  it('listRoles returns empty array when no roles defined', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    assert.deepStrictEqual(await store.listRoles(), []);
  });

  it('getUsersByRole returns users with role details', async () => {
    const pool = mockPool([{
      rows: [{ id: 'u1', username: 'alice', grantedAt: '2026-01-01', grantedBy: 'system' }],
    }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    const result = await store.getUsersByRole('admin');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].username, 'alice');
    assert.deepStrictEqual(pool.queries[0].params, ['admin']);
  });

  it('getUsersByRole returns empty array when nobody has role', async () => {
    const pool = mockPool([{ rows: [] }]);
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    assert.deepStrictEqual(await store.getUsersByRole('superadmin'), []);
  });

  it('invalidateCache removes a specific user from cache', async () => {
    const pool = mockPool([
      { rows: [{ name: 'admin' }] },
      { rows: [{ name: 'user' }] },
    ]);
    const store = createRolesStore(pool, { nodeEnv: 'production' });

    await store.getUserRoles('u1');
    assert.strictEqual(pool.queries.length, 1);

    store.invalidateCache('u1');

    // Should hit DB again
    await store.getUserRoles('u1');
    assert.strictEqual(pool.queries.length, 2);
  });

  it('invalidateAllCaches clears entire cache', async () => {
    const pool = mockPool([
      { rows: [{ name: 'admin' }] },
      { rows: [{ name: 'user' }] },
      { rows: [{ name: 'admin' }] },
      { rows: [{ name: 'user' }] },
    ]);
    const store = createRolesStore(pool, { nodeEnv: 'production' });

    // Populate cache for two users
    await store.getUserRoles('u1');
    await store.getUserRoles('u2');
    assert.strictEqual(pool.queries.length, 2);

    store.invalidateAllCaches();

    // Both should hit DB again
    await store.getUserRoles('u1');
    await store.getUserRoles('u2');
    assert.strictEqual(pool.queries.length, 4);
  });
});

// =====================================================================
// Error propagation
// =====================================================================
describe('Store error propagation', () => {
  it('crews.create propagates pool.query errors', async () => {
    const pool = mockPoolThatThrows(new Error('connection refused'));
    const { crews } = createCrewsStore(pool, mockUtils);

    await assert.rejects(
      () => crews.create({ id: 'c1', festivalId: 'f1', name: 'X', createdBy: 'u1', inviteCode: 'x', maxMembers: 5 }),
      { message: 'connection refused' },
    );
  });

  it('deviceTokens.register propagates pool.query errors', async () => {
    const pool = mockPoolThatThrows(new Error('timeout'));
    const { deviceTokens } = createNotificationsStore(pool, mockUtils);

    await assert.rejects(
      () => deviceTokens.register({ id: 'd1', userId: 'u1', token: 't' }),
      { message: 'timeout' },
    );
  });

  it('ratings.upsert propagates pool.query errors', async () => {
    const pool = mockPoolThatThrows(new Error('unique violation'));
    const store = createRatingsStore(pool);

    await assert.rejects(
      () => store.upsert('u1', 's1', 5),
      { message: 'unique violation' },
    );
  });

  it('roles.getUserRoles propagates pool.query errors', async () => {
    const pool = mockPoolThatThrows(new Error('db down'));
    const store = createRolesStore(pool, { nodeEnv: 'test' });

    await assert.rejects(
      () => store.getUserRoles('u1'),
      { message: 'db down' },
    );
  });
});
