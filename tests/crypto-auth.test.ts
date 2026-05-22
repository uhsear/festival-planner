import assert from 'node:assert/strict';
import { describe, it, before, after, mock } from 'node:test';

import {
  SCRYPT_KEYLEN,
  hashSessionToken,
  DUMMY_PASSWORD_SALT,
  DUMMY_PASSWORD_HASH,
  timingSafeEqualString,
  hashPassword,
  verifyPassword,
  setLogger,
} from '../lib/crypto-auth';

describe('crypto-auth: hashSessionToken', () => {
  it('returns a hex string of 64 characters (SHA-256)', () => {
    const hash = hashSessionToken('test-token-value');
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it('produces deterministic output for the same input', () => {
    const a = hashSessionToken('my-session');
    const b = hashSessionToken('my-session');
    assert.equal(a, b);
  });

  it('produces different output for different inputs', () => {
    const a = hashSessionToken('token-a');
    const b = hashSessionToken('token-b');
    assert.notEqual(a, b);
  });

  it('coerces non-string input to string', () => {
    const result = hashSessionToken(12345 as any);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 64);
  });

  it('handles empty string', () => {
    const result = hashSessionToken('');
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 64);
  });

  it('handles null by converting to string "null"', () => {
    const result = hashSessionToken(null as any);
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 64);
  });
});

describe('crypto-auth: timingSafeEqualString', () => {
  it('returns true for identical strings', () => {
    assert.equal(timingSafeEqualString('hello', 'hello'), true);
  });

  it('returns false for different strings', () => {
    assert.equal(timingSafeEqualString('hello', 'world'), false);
  });

  it('returns true for identical long strings', () => {
    const long = 'a'.repeat(1000);
    assert.equal(timingSafeEqualString(long, long), true);
  });

  it('returns false for strings that differ by one character', () => {
    assert.equal(timingSafeEqualString('abcdef', 'abcdeg'), false);
  });

  it('handles empty strings', () => {
    assert.equal(timingSafeEqualString('', ''), true);
  });

  it('returns false for empty vs non-empty', () => {
    assert.equal(timingSafeEqualString('', 'something'), false);
  });

  it('coerces non-string input via String()', () => {
    assert.equal(timingSafeEqualString(123 as any, '123'), true);
    assert.equal(timingSafeEqualString(123 as any, '456'), false);
  });
});

describe('crypto-auth: hashPassword', () => {
  it('returns a salt:hash string', async () => {
    const result = await hashPassword('my-password-123');
    assert.equal(typeof result, 'string');
    const parts = result.split(':');
    assert.equal(parts.length, 2);
    assert.ok(parts[0]!.length > 0, 'salt should be non-empty');
    assert.ok(parts[1]!.length > 0, 'hash should be non-empty');
  });

  it('salt is a 32-char hex string (16 random bytes)', async () => {
    const result = await hashPassword('test');
    const salt = result.split(':')[0]!;
    assert.equal(salt.length, 32);
    assert.match(salt, /^[a-f0-9]{32}$/);
  });

  it('hash is 128 chars (64-byte key in hex)', async () => {
    const result = await hashPassword('test');
    const hash = result.split(':')[1]!;
    assert.equal(hash.length, SCRYPT_KEYLEN * 2);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    assert.notEqual(a, b);
  });

  it('produces different hashes for different passwords', async () => {
    const a = await hashPassword('password-one');
    const b = await hashPassword('password-two');
    assert.notEqual(a.split(':')[1], b.split(':')[1]);
  });
});

describe('crypto-auth: verifyPassword', () => {
  it('returns true for correct password', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    const result = await verifyPassword('correct-horse-battery-staple', stored);
    assert.equal(result, true);
  });

  it('returns false for wrong password', async () => {
    const stored = await hashPassword('correct-password');
    const result = await verifyPassword('wrong-password', stored);
    assert.equal(result, false);
  });

  it('returns false for null stored hash', async () => {
    const result = await verifyPassword('test', null as any);
    assert.equal(result, false);
  });

  it('returns false for undefined stored hash', async () => {
    const result = await verifyPassword('test', undefined as any);
    assert.equal(result, false);
  });

  it('returns false for empty stored hash', async () => {
    const result = await verifyPassword('test', '');
    assert.equal(result, false);
  });

  it('returns false for malformed stored hash (no colon)', async () => {
    const result = await verifyPassword('test', 'nocolonhere');
    assert.equal(result, false);
  });

  it('returns false for malformed stored hash (invalid hex)', async () => {
    const result = await verifyPassword('test', 'salt:not-hex-data!!!');
    assert.equal(result, false);
  });

  it('returns false for stored hash with empty salt', async () => {
    const result = await verifyPassword('test', ':abcdef0123456789');
    assert.equal(result, false);
  });

  it('verifies correctly after hash round-trip', async () => {
    const password = 'S3cureP@ssw0rd!';
    const hash = await hashPassword(password);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
  });
});

describe('crypto-auth: DUMMY_PASSWORD_HASH', () => {
  it('contains the dummy salt', () => {
    assert.ok(DUMMY_PASSWORD_HASH.startsWith(DUMMY_PASSWORD_SALT + ':'));
  });

  it('is a valid salt:hash format', () => {
    const parts = DUMMY_PASSWORD_HASH.split(':');
    assert.equal(parts.length, 2);
    assert.match(parts[1]!, /^[a-f0-9]+$/);
  });
});

describe('crypto-auth: SCRYPT_KEYLEN', () => {
  it('is 64 bytes', () => {
    assert.equal(SCRYPT_KEYLEN, 64);
  });
});

describe('crypto-auth: setLogger', () => {
  it('accepts a logger object without error', () => {
    const fakeLog = { debug() {}, warn() {}, info() {}, error() {} };
    assert.doesNotThrow(() => setLogger(fakeLog));
  });

  it('accepts null to disable logging', () => {
    assert.doesNotThrow(() => setLogger(null as any));
  });
});
