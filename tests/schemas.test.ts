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

// ── Authentication schemas ──────────────────────────────────────────────

describe('schemas: register', () => {
  it('accepts valid registration', () => {
    const result = schemas.register.safeParse({
      username: 'testuser',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      tosAccepted: true,
    });
    assert.ok(result.success);
  });

  it('rejects empty username', () => {
    const result = schemas.register.safeParse({
      username: '',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects password shorter than 8 chars', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'short',
      confirmPassword: 'short',
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects mismatched passwords', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'different123',
      tosAccepted: true,
    });
    assert.ok(!result.success);
  });

  it('rejects tosAccepted=false', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
      tosAccepted: false,
    });
    assert.ok(!result.success);
  });

  it('allows optional email', () => {
    const result = schemas.register.safeParse({
      username: 'user',
      password: 'Str0ngTest!Pw',
      confirmPassword: 'Str0ngTest!Pw',
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
