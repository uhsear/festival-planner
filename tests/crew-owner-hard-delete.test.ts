import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createStores } from '../lib/db/index.js';

// Real-DB test (skip-gated like the other integration suites): verifies that
// deleting a user who CREATED a crew transfers ownership to the longest-standing
// remaining member, or deletes the crew only if they were its sole member — for
// BOTH the interactive path (users.hardDelete) and the batch path
// (retention_cleanup(), migration 060). crews.created_by is ON DELETE RESTRICT
// (migration 031), so without this handling the user delete aborts on the FK.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('GDPR delete — owned-crew ownership handling', { skip }, () => {
  let pool: Pool;
  let stores: any;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    stores = createStores(pool);
  });

  after(async () => {
    // Festival delete cascades to any surviving crews/members; users are removed
    // by the code under test, but sweep any leftovers on failure paths.
    await pool.query("DELETE FROM crew_members WHERE user_id LIKE 'gdpr-test-%'").catch(() => {});
    await pool.query("DELETE FROM crews WHERE id LIKE 'gdpr-test-%'").catch(() => {});
    await pool.query("DELETE FROM festivals WHERE id LIKE 'gdpr-test-%'").catch(() => {});
    await pool.query("DELETE FROM users WHERE id LIKE 'gdpr-test-%'").catch(() => {});
    await pool.end();
  });

  const mkUser = (id: string) => stores.users.create({ id, username: id, passwordHash: 'x' });
  const mkFestival = (id: string) =>
    pool.query('INSERT INTO festivals (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, 'GDPR Test Fest']);
  const mkCrew = (id: string, festivalId: string, createdBy: string) =>
    stores.crews.create({ id, festivalId, name: `Crew ${id}`, createdBy, inviteCode: `${id}-inv`, maxMembers: 10 });
  const addMember = (crewId: string, userId: string, role: string, joinedAt: string) =>
    pool.query('INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)', [
      crewId,
      userId,
      role,
      joinedAt,
    ]);

  test('hardDelete transfers ownership to the longest-standing remaining member', async () => {
    await mkFestival('gdpr-test-f1');
    await mkUser('gdpr-test-owner');
    await mkUser('gdpr-test-b');
    await mkUser('gdpr-test-c');
    await mkCrew('gdpr-test-crew1', 'gdpr-test-f1', 'gdpr-test-owner');
    await addMember('gdpr-test-crew1', 'gdpr-test-owner', 'owner', '2020-01-01T00:00:00Z');
    await addMember('gdpr-test-crew1', 'gdpr-test-c', 'member', '2020-03-01T00:00:00Z');
    await addMember('gdpr-test-crew1', 'gdpr-test-b', 'member', '2020-02-01T00:00:00Z'); // earliest non-owner

    await stores.users.hardDelete('gdpr-test-owner');

    const { rows } = await pool.query("SELECT created_by FROM crews WHERE id = 'gdpr-test-crew1'");
    assert.equal(rows.length, 1, 'crew with other members survives the owner deletion');
    assert.equal(rows[0].created_by, 'gdpr-test-b', 'ownership goes to the earliest-joined remaining member');
    const { rows: role } = await pool.query(
      "SELECT role FROM crew_members WHERE crew_id = 'gdpr-test-crew1' AND user_id = 'gdpr-test-b'",
    );
    assert.equal(role[0].role, 'owner', 'new owner is promoted in crew_members');
    const { rows: gone } = await pool.query("SELECT 1 FROM users WHERE id = 'gdpr-test-owner'");
    assert.equal(gone.length, 0, 'the user row is actually deleted (no FK abort)');
  });

  test('hardDelete deletes a crew whose creator was its sole member', async () => {
    await mkFestival('gdpr-test-f2');
    await mkUser('gdpr-test-solo');
    await mkCrew('gdpr-test-crew2', 'gdpr-test-f2', 'gdpr-test-solo');
    await addMember('gdpr-test-crew2', 'gdpr-test-solo', 'owner', '2020-01-01T00:00:00Z');

    await stores.users.hardDelete('gdpr-test-solo');

    const { rows } = await pool.query("SELECT 1 FROM crews WHERE id = 'gdpr-test-crew2'");
    assert.equal(rows.length, 0, 'sole-member crew is deleted with the user');
  });

  test('retention_cleanup transfers/deletes owned crews for users soft-deleted > 30 days', async () => {
    await mkFestival('gdpr-test-f3');
    await mkUser('gdpr-test-rc-owner');
    await mkUser('gdpr-test-rc-heir');
    await mkUser('gdpr-test-rc-solo');
    await mkCrew('gdpr-test-crew3', 'gdpr-test-f3', 'gdpr-test-rc-owner');
    await addMember('gdpr-test-crew3', 'gdpr-test-rc-owner', 'owner', '2020-01-01T00:00:00Z');
    await addMember('gdpr-test-crew3', 'gdpr-test-rc-heir', 'member', '2020-02-01T00:00:00Z');
    await mkCrew('gdpr-test-crew4', 'gdpr-test-f3', 'gdpr-test-rc-solo');
    await addMember('gdpr-test-crew4', 'gdpr-test-rc-solo', 'owner', '2020-01-01T00:00:00Z');
    // Purge window: both owners soft-deleted 40 days ago; the heir stays active.
    await pool.query(
      "UPDATE users SET deleted_at = now() - interval '40 days' WHERE id IN ('gdpr-test-rc-owner', 'gdpr-test-rc-solo')",
    );

    await pool.query('SELECT retention_cleanup()');

    const { rows: transferred } = await pool.query("SELECT created_by FROM crews WHERE id = 'gdpr-test-crew3'");
    assert.equal(transferred.length, 1, 'crew with an active member survives the batch purge');
    assert.equal(transferred[0].created_by, 'gdpr-test-rc-heir', 'batch transfers ownership to the active member');
    const { rows: deleted } = await pool.query("SELECT 1 FROM crews WHERE id = 'gdpr-test-crew4'");
    assert.equal(deleted.length, 0, 'sole-owner crew is deleted in the batch purge');
    const { rows: usersGone } = await pool.query(
      "SELECT 1 FROM users WHERE id IN ('gdpr-test-rc-owner', 'gdpr-test-rc-solo')",
    );
    assert.equal(usersGone.length, 0, 'purged users are deleted (retention_cleanup no longer aborts on the crews FK)');
  });
});

// The avatar orphan sweep in lib/shutdown.ts deletes any file in the avatar
// directory whose key is not in `users.avatar_key`. It used to build that set
// from getUsers(), which filters `WHERE deleted_at IS NULL`, so a soft-deleted
// account lost its avatar file on the next sweep — within six hours, not at the
// end of the 30-day grace period. Restoring inside the window then pointed at a
// missing file, and packages/mobile/app/privacy.tsx promises the avatar survives
// until day 30. This pins the query the sweep now uses.
describe('avatar orphan sweep — soft-deleted accounts keep their file', { skip }, () => {
  let pool: Pool;
  let stores: any;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    stores = createStores(pool);
  });

  after(async () => {
    await pool.query("DELETE FROM users WHERE id LIKE 'avatar-sweep-%'").catch(() => {});
    await pool.end();
  });

  test('a soft-deleted user still protects its avatar key', async () => {
    await stores.users.create({ id: 'avatar-sweep-1', username: 'avatar-sweep-1', passwordHash: 'x' });
    await pool.query("UPDATE users SET avatar_key = 'abc123deadbeef' WHERE id = $1", ['avatar-sweep-1']);

    // Exactly the query lib/shutdown.ts runs to build the valid-key set.
    const live = await pool.query('SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL');
    assert.ok(
      live.rows.some((r: any) => r.avatar_key === 'abc123deadbeef'),
      'active account must protect its avatar',
    );

    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', ['avatar-sweep-1']);

    const afterSoftDelete = await pool.query('SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL');
    assert.ok(
      afterSoftDelete.rows.some((r: any) => r.avatar_key === 'abc123deadbeef'),
      'soft-deleted account must STILL protect its avatar until the 30-day purge removes the row',
    );

    // And the old behaviour, kept explicit so the regression is unmistakable:
    // the filtered query is what dropped the key early.
    const filtered = await pool.query(
      'SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL AND deleted_at IS NULL',
    );
    assert.ok(
      !filtered.rows.some((r: any) => r.avatar_key === 'abc123deadbeef'),
      'the deleted_at-filtered query is the one that used to orphan the file',
    );
  });
});
