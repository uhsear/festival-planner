import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  schemas,
  validate,
  normalizePickPayload,
  normalizeNotePayload,
  normalizeReminderPayload,
  artistDisplayName,
  normalizeSetArtists,
} from '../lib/schemas.js';
import {
  userResponseSchema,
  festivalDepth1ResponseSchema,
  crewResponseSchema,
  meetingPointResponseSchema,
} from '../lib/responseSchemas.js';
import { serializePublicUser } from '../lib/helpers.js';

// ── Authentication schemas ──────────────────────────────────────────────

describe('schemas: register', () => {
  const DOB = '1995-01-01'; // an adult DOB that clears the 18+ gate

  it('accepts valid registration', () => {
    const result = schemas.register.safeParse({
      username: 'testuser',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: DOB,
      tosAccepted: true,
    });
    assert.ok(result.success);
  });

  it('rejects empty username', () => {
    const result = schemas.register.safeParse({
      username: '',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: DOB,
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects password shorter than 8 chars', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'short',
      confirmPassword: 'short',
      dateOfBirth: DOB,
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects mismatched passwords', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'different123',
      dateOfBirth: DOB,
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects tosAccepted=false', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: DOB,
      tosAccepted: false,
    });
    assert.ok(!result.success);
  });

  it('rejects a registrant under 18', () => {
    const tenYearsAgo = `${new Date().getUTCFullYear() - 10}-01-01`;
    const result = schemas.register.safeParse({
      username: 'kiddo',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: tenYearsAgo,
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects a missing/malformed date of birth', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: 'not-a-date',
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('allows optional email', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: DOB,
      tosAccepted: true,
      email: 'test@example.com',
    });
    assert.ok(result.success);
  });

  it('allows empty email string', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      dateOfBirth: DOB,
      tosAccepted: true,
      email: '',
    });
    assert.ok(result.success);
  });
});

describe('schemas: login', () => {
  it('accepts valid login', () => {
    const result = schemas.login.safeParse({
      username: 'testuser',
      password: 'Str0ngTest!Pw',
    });
    assert.ok(result.success);
  });

  it('rejects empty username', () => {
    const result = schemas.login.safeParse({ username: '', password: 'pass' });
    assert.ok(!result.success);
  });

  it('rejects empty password', () => {
    const result = schemas.login.safeParse({ username: 'user', password: '' });
    assert.ok(!result.success);
  });

  it('rejects missing fields', () => {
    const result = schemas.login.safeParse({});
    assert.ok(!result.success);
  });
});

describe('schemas: changePassword', () => {
  it('accepts valid password change', () => {
    const result = schemas.changePassword.safeParse({
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
      confirmPassword: 'newpass456',
    });
    assert.ok(result.success);
  });

  it('rejects mismatched confirm', () => {
    const result = schemas.changePassword.safeParse({
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
      confirmPassword: 'different789',
    });
    assert.ok(!result.success);
  });

  it('rejects short new password', () => {
    const result = schemas.changePassword.safeParse({
      currentPassword: 'oldpass123',
      newPassword: 'short',
      confirmPassword: 'short',
    });
    assert.ok(!result.success);
  });
});

// ── Notification schemas ────────────────────────────────────────────────

describe('schemas: notificationPrefs', () => {
  it('accepts valid preferences', () => {
    const result = schemas.notificationPrefs.safeParse({
      crewUpdates: true,
      setReminders: false,
      scheduleChanges: true,
    });
    assert.ok(result.success);
  });

  it('accepts DND times', () => {
    const result = schemas.notificationPrefs.safeParse({
      dndStart: '22:00',
      dndEnd: '08:00',
    });
    assert.ok(result.success);
  });

  it('rejects invalid DND time format', () => {
    const result = schemas.notificationPrefs.safeParse({
      dndStart: '25:00',
    });
    assert.ok(!result.success);
  });

  it('rejects extra properties (strict mode)', () => {
    const result = schemas.notificationPrefs.safeParse({
      crewUpdates: true,
      unknownField: 'bad',
    });
    assert.ok(!result.success);
  });
});

describe('schemas: pushToken', () => {
  it('accepts valid token', () => {
    const result = schemas.pushToken.safeParse({
      token: 'a'.repeat(50),
      platform: 'web',
    });
    assert.ok(result.success);
  });

  it('rejects token shorter than 20 chars', () => {
    const result = schemas.pushToken.safeParse({
      token: 'short',
      platform: 'web',
    });
    assert.ok(!result.success);
  });

  it('defaults platform to web', () => {
    const result = schemas.pushToken.safeParse({ token: 'a'.repeat(50) });
    assert.ok(result.success);
    assert.equal(result.data.platform, 'web');
  });

  it('rejects invalid platform', () => {
    const result = schemas.pushToken.safeParse({
      token: 'a'.repeat(50),
      platform: 'windows',
    });
    assert.ok(!result.success);
  });
});

// ── Crew schemas ────────────────────────────────────────────────────────

describe('schemas: crewCreate', () => {
  it('accepts valid crew', () => {
    const result = schemas.crewCreate.safeParse({
      name: 'My Crew',
      festivalId: 'fest-123',
    });
    assert.ok(result.success);
  });

  it('rejects empty crew name', () => {
    const result = schemas.crewCreate.safeParse({
      name: '',
      festivalId: 'fest-123',
    });
    assert.ok(!result.success);
  });

  it('rejects crew name over 60 chars', () => {
    const result = schemas.crewCreate.safeParse({
      name: 'a'.repeat(61),
      festivalId: 'fest-123',
    });
    assert.ok(!result.success);
  });
});

describe('schemas: crewJoin', () => {
  it('accepts valid invite code', () => {
    const result = schemas.crewJoin.safeParse({ inviteCode: 'ABC123' });
    assert.ok(result.success);
  });

  it('rejects code shorter than 4 chars', () => {
    const result = schemas.crewJoin.safeParse({ inviteCode: 'AB' });
    assert.ok(!result.success);
  });

  it('rejects code longer than 12 chars', () => {
    const result = schemas.crewJoin.safeParse({ inviteCode: 'a'.repeat(13) });
    assert.ok(!result.success);
  });
});

// ── Festival schemas ────────────────────────────────────────────────────

describe('schemas: festivalCreate', () => {
  it('accepts valid festival', () => {
    const result = schemas.festivalCreate.safeParse({
      name: 'Summer Fest',
      stages: [{ name: 'Main Stage' }],
      days: [{ date: '2026-06-01' }],
    });
    assert.ok(result.success);
  });

  it('rejects empty name', () => {
    const result = schemas.festivalCreate.safeParse({ name: '' });
    assert.ok(!result.success);
  });

  it('rejects more than 20 stages', () => {
    const stages = Array.from({ length: 21 }, (_, i) => ({ name: `Stage ${i}` }));
    const result = schemas.festivalCreate.safeParse({ name: 'Fest', stages });
    assert.ok(!result.success);
  });

  it('rejects more than 10 days', () => {
    const days = Array.from({ length: 11 }, () => ({ date: '2026-06-01' }));
    const result = schemas.festivalCreate.safeParse({ name: 'Fest', days });
    assert.ok(!result.success);
  });
});

// ── Payload normalizers ─────────────────────────────────────────────────

describe('schemas: normalizePickPayload', () => {
  it('normalizes valid picks', () => {
    const result = normalizePickPayload({ 'set-1': 'must', 'set-2': 'maybe' }, { MAX_PICKS: 500 });
    assert.ok(result.value);
    assert.equal(result.value['set-1'], 'must');
    assert.equal(result.value['set-2'], 'maybe');
  });

  it('rejects invalid priority', () => {
    const result = normalizePickPayload({ 'set-1': 'invalid' }, { MAX_PICKS: 500 });
    assert.ok(result.error);
    assert.ok(result.error.includes('Invalid priority'));
  });

  it('rejects non-object input', () => {
    assert.ok(normalizePickPayload(null, { MAX_PICKS: 10 }).error);
    assert.ok(normalizePickPayload([], { MAX_PICKS: 10 }).error);
    assert.ok(normalizePickPayload('string', { MAX_PICKS: 10 }).error);
  });

  it('rejects when too many picks', () => {
    const picks: Record<string, string> = {};
    for (let i = 0; i < 10; i++) picks[`set-${i}`] = 'must';
    const result = normalizePickPayload(picks, { MAX_PICKS: 5 });
    assert.ok(result.error);
    assert.ok(result.error.includes('Too many'));
  });

  it('strips dangerous record keys (__proto__)', () => {
    const result = normalizePickPayload({ '__proto__': 'must' }, { MAX_PICKS: 500 });
    assert.ok(!result.error);
    assert.equal(Object.keys(result.value).length, 0);
  });
});

describe('schemas: normalizeNotePayload', () => {
  it('normalizes valid notes', () => {
    const result = normalizeNotePayload(
      { 'set-1': 'Great show!' },
      { MAX_NOTES: 500, MAX_NOTE_LENGTH: 1000 },
    );
    assert.ok(result.value);
    assert.equal(result.value['set-1'], 'Great show!');
  });

  it('rejects non-string note', () => {
    const result = normalizeNotePayload({ 'set-1': 123 }, { MAX_NOTES: 500, MAX_NOTE_LENGTH: 1000 });
    assert.ok(result.error);
  });

  it('rejects too many notes', () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i < 10; i++) notes[`set-${i}`] = 'note';
    const result = normalizeNotePayload(notes, { MAX_NOTES: 5, MAX_NOTE_LENGTH: 1000 });
    assert.ok(result.error);
  });

  it('rejects note that is too long', () => {
    const result = normalizeNotePayload(
      { 'set-1': 'x'.repeat(3000) },
      { MAX_NOTES: 500, MAX_NOTE_LENGTH: 1000 },
    );
    assert.ok(result.error);
  });
});

describe('schemas: normalizeReminderPayload', () => {
  it('normalizes valid reminders', () => {
    const result = normalizeReminderPayload(
      { 'set-1': 15, 'set-2': 30 },
      { MAX_REMINDERS: 100 },
    );
    assert.ok(result.value);
    assert.equal(result.value['set-1'], 15);
    assert.equal(result.value['set-2'], 30);
  });

  it('rejects invalid reminder minutes', () => {
    const result = normalizeReminderPayload({ 'set-1': 7 }, { MAX_REMINDERS: 100 });
    assert.ok(result.error);
  });

  it('rejects non-object input', () => {
    assert.ok(normalizeReminderPayload(null, { MAX_REMINDERS: 10 }).error);
  });
});

describe('schemas: artistDisplayName', () => {
  it('joins multiple artists with separator', () => {
    const artists = [{ name: 'DJ A' }, { name: 'DJ B' }];
    assert.equal(artistDisplayName(artists, 'b2b'), 'DJ A b2b DJ B');
  });

  it('returns single artist name', () => {
    assert.equal(artistDisplayName([{ name: 'Solo' }]), 'Solo');
  });

  it('returns Unknown for empty array', () => {
    assert.equal(artistDisplayName([]), 'Unknown');
  });

  it('returns Unknown for null', () => {
    assert.equal(artistDisplayName(null as any), 'Unknown');
  });

  it('uses custom separator', () => {
    const artists = [{ name: 'A' }, { name: 'B' }];
    assert.equal(artistDisplayName(artists, 'vs'), 'A vs B');
  });
});

describe('schemas: normalizeSetArtists', () => {
  it('normalizes artists array', () => {
    const result = normalizeSetArtists({
      artists: [{ name: 'DJ Alpha', links: { spotify: 'https://open.spotify.com/artist/123' } }],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'DJ Alpha');
  });

  it('falls back to old artist field', () => {
    const result = normalizeSetArtists({ artist: 'DJ Legacy' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'DJ Legacy');
  });

  it('returns empty array for missing artist', () => {
    const result = normalizeSetArtists({});
    assert.equal(result.length, 0);
  });

  it('limits to MAX_ARTISTS_PER_SET', () => {
    const artists = Array.from({ length: 10 }, (_, i) => ({ name: `Artist ${i}` }));
    const result = normalizeSetArtists({ artists });
    assert.ok(result.length <= 4); // MAX_ARTISTS_PER_SET = 4
  });

  it('includes linkUrl as spotify link in backward compat', () => {
    const result = normalizeSetArtists({
      artist: 'DJ Test',
      linkUrl: 'https://open.spotify.com/abc',
    });
    assert.equal(result[0].links.spotify, 'https://open.spotify.com/abc');
  });

  it('ignores non-http linkUrl in backward compat', () => {
    const result = normalizeSetArtists({
      artist: 'DJ Test',
      linkUrl: 'not-a-url',
    });
    assert.deepEqual(result[0].links, {});
  });
});

// ── validate middleware factory ──────────────────────────────────────────

describe('schemas: validate middleware', () => {
  it('sets req.validatedBody on success and calls next', () => {
    const middleware = validate(schemas.login);
    const req: any = { body: { username: 'test', password: 'pass123' } };
    let nextCalled = false;
    const res: any = {};
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.equal(req.validatedBody.username, 'test');
  });

  it('calls sendError on validation failure', () => {
    const middleware = validate(schemas.login);
    const req: any = { body: {} };
    let statusSet: any = null;
    let jsonSent: any = null;
    const res: any = {
      setHeader() {},
      status(s: number) { statusSet = s; return res; },
      json(body: any) { jsonSent = body; return res; },
    };
    middleware(req, res, () => { throw new Error('next should not be called'); });
    assert.equal(statusSet, 400);
    assert.ok(jsonSent.error);
  });
});

// ── Response (OUTPUT) schemas ────────────────────────────────────────────
// Guard that a REAL serialized payload parses against its response schema. Each
// payload is JSON-round-tripped first to mimic the wire (timestamptz → ISO
// string), exactly as a client would decode it.

describe('responseSchemas: serialized payloads parse', () => {
  const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

  it('userResponseSchema parses serializePublicUser output (full + minimal)', () => {
    // Full user (every optional populated) — uses the REAL serializer.
    const full = serializePublicUser({
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      avatarKey: 'k123',
      avatarVersion: 'v9',
      email: 'a@b.com',
      emailVerifiedAt: new Date().toISOString(),
      venmoHandle: '@alice',
      cashappCashtag: null,
      paypalHandle: null,
    });
    const parsedFull = userResponseSchema.parse(wire(full));
    assert.equal(parsedFull.id, 'user-1');
    assert.equal(parsedFull.emailVerified, true);
    assert.ok(parsedFull.avatarUrl && parsedFull.avatarUrl.includes('avatars'));

    // Minimal user → nulls for name/avatarUrl/email/handles, emailVerified false.
    const minimal = serializePublicUser({ id: 'u2', username: 'bob' });
    const parsedMin = userResponseSchema.parse(wire(minimal));
    assert.equal(parsedMin.name, null);
    assert.equal(parsedMin.avatarUrl, null);
    assert.equal(parsedMin.emailVerified, false);
  });

  it('festivalDepth1ResponseSchema parses a depth=1 festival payload', () => {
    // Mirrors routes/festivals.ts depth===1 mapper exactly.
    const now = new Date().toISOString();
    const payload = {
      id: 'fest-1',
      name: 'Test Fest',
      location: 'Open Field',
      stages: [{ id: 'stage-1', name: 'Main', color: '#666666', latitude: 51.5, longitude: -0.12 }],
      days: [
        {
          label: 'Day 1',
          date: '2026-07-01',
          sets: [
            {
              id: 'set-1',
              artist: 'DJ A',
              artists: [{ name: 'DJ A', links: { spotify: 'https://open.spotify.com/x' } }],
              stageId: 'stage-1',
              startTime: '12:00',
              endTime: '13:00',
            },
          ],
        },
      ],
      mapConfig: null,
      createdAt: now,
      updatedAt: now,
    };
    const parsed = festivalDepth1ResponseSchema.parse(wire(payload));
    assert.equal(parsed.stages[0]!.latitude, 51.5);
    assert.equal(parsed.days[0]!.sets[0]!.id, 'set-1');

    // mapConfig present (reuses the strict request validator's shape) also parses.
    const mapped = festivalDepth1ResponseSchema.parse(
      wire({ ...payload, mapConfig: { version: 1, center: [-0.12, 51.5] } }),
    );
    assert.equal(mapped.mapConfig?.version, 1);
  });

  it('crewResponseSchema parses serializeCrewWithMembers output (owner view)', () => {
    // Mirrors routes/crews.ts serializeCrewWithMembers for an owner requester.
    const now = new Date().toISOString();
    const payload = {
      id: 'crew-1',
      festivalId: 'fest-1',
      name: 'The Crew',
      owner: 'user-1',
      createdBy: 'user-1',
      maxMembers: 30,
      reformedFrom: null,
      createdAt: now,
      updatedAt: now,
      homeBaseLocation: null,
      homeBaseTime: null,
      homeBaseUpdatedAt: null,
      photoAlbumUrl: null,
      totem_name: null,
      totem_emoji: null,
      role: 'owner',
      joinedAt: now,
      inviteCode: 'ABCD12',
      inviteExpiresAt: null,
      members: [
        {
          userId: 'user-1',
          username: 'alice',
          name: 'alice',
          avatarKey: null,
          avatarVersion: null,
          role: 'owner',
          joinedAt: now,
        },
      ],
      memberCount: 1,
    };
    const parsed = crewResponseSchema.parse(wire(payload));
    assert.equal(parsed.owner, 'user-1');
    assert.equal(parsed.inviteCode, 'ABCD12');
    assert.equal(parsed.members[0]!.role, 'owner');
    assert.equal(parsed.memberCount, 1);
  });

  it('meetingPointResponseSchema parses a store row (Date timestamps → ISO)', () => {
    // Mirrors lib/db/stores/crews.ts meetingPoints.listByCrew row (pg returns
    // timestamptz as Date; JSON.stringify renders them as ISO on the wire).
    const row = {
      id: 'mp-1',
      crew_id: 'crew-1',
      created_by: 'user-1',
      label: 'The big tree',
      location: 'North field',
      type: 'during',
      meet_at: new Date(),
      stage_reference: null,
      expires_at: null,
      latitude: 51.5,
      longitude: -0.12,
      recurs_daily: false,
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
      creator_name: 'alice',
    };
    const parsed = meetingPointResponseSchema.parse(wire(row));
    assert.equal(parsed.id, 'mp-1');
    assert.equal(parsed.recurs_daily, false);
    assert.equal(typeof parsed.meet_at, 'string');
    assert.equal(parsed.creator_name, 'alice');
  });
});
