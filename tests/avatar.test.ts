import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// We need to create a temp dir for avatar operations
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-avatar-test-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// We cannot easily import createAvatarHelpers because it requires multer
// and AvatarPool at module load. Instead, test the pure logic portions
// by importing the module and exercising the factory output.
import { createAvatarHelpers } from '../lib/app-context/avatar.js';

function makeConfig() {
  return {
    PUBLIC_DIR: tmpDir,
    AVATAR_MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  };
}

function makeSendError() {
  const calls: any[] = [];
  const fn: any = (res: any, status: number, msg: string, code: string) => { calls.push({ status, msg, code }); };
  fn.calls = calls;
  return fn;
}

const ErrorCodes = { INVALID_INPUT: 'INVALID_INPUT' };

describe('avatar: avatarDirPath', () => {
  it('returns path under PUBLIC_DIR/uploads/avatars', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    const dirPath = helpers.avatarDirPath();
    assert.ok(dirPath.includes('uploads'));
    assert.ok(dirPath.includes('avatars'));
    assert.ok(dirPath.startsWith(tmpDir));
  });
});

describe('avatar: ensureAvatarDir', () => {
  it('creates the avatar directory if it does not exist', () => {
    const sendError = makeSendError();
    const config = makeConfig();
    // Remove the dir first (createAvatarHelpers creates it)
    const helpers = createAvatarHelpers({ config, sendError, ErrorCodes });
    const dirPath = helpers.avatarDirPath();
    assert.ok(fs.existsSync(dirPath));
  });

  it('cleans up .tmp files on ensureAvatarDir call', () => {
    const sendError = makeSendError();
    const config = makeConfig();
    const helpers = createAvatarHelpers({ config, sendError, ErrorCodes });
    const dirPath = helpers.avatarDirPath();
    // Create a stale .tmp file
    fs.writeFileSync(path.join(dirPath, 'stale.tmp'), 'data');
    helpers.ensureAvatarDir();
    const remaining = fs.readdirSync(dirPath).filter((f: string) => f.endsWith('.tmp'));
    assert.equal(remaining.length, 0);
  });
});

describe('avatar: getAvatarFilePath', () => {
  it('returns a .webp path for valid hex key', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    const filePath = helpers.getAvatarFilePath('a'.repeat(32));
    assert.ok(filePath.endsWith('.webp'));
    assert.ok(filePath.includes('a'.repeat(32)));
  });

  it('rejects keys that are not hex', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    assert.throws(() => helpers.getAvatarFilePath('not-hex!@#'), /Invalid avatar key/);
  });

  it('rejects keys that are too short', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    assert.throws(() => helpers.getAvatarFilePath('abc'), /Invalid avatar key/);
  });

  it('accepts keys between 24 and 64 hex chars', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    // 24-char key
    assert.doesNotThrow(() => helpers.getAvatarFilePath('a'.repeat(24)));
    // 64-char key
    assert.doesNotThrow(() => helpers.getAvatarFilePath('f'.repeat(64)));
  });

  it('normalizes key to lowercase', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    const filePath = helpers.getAvatarFilePath('A'.repeat(32));
    assert.ok(filePath.includes('a'.repeat(32)));
  });

  it('handles null/undefined key', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    assert.throws(() => helpers.getAvatarFilePath(null), /Invalid avatar key/);
    assert.throws(() => helpers.getAvatarFilePath(undefined), /Invalid avatar key/);
  });
});

describe('avatar: writeAvatarFile + removeAvatarFile', () => {
  it('writes and then removes an avatar file', async () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    const key = 'a'.repeat(32);
    const buffer = Buffer.from('fake-webp-data');
    await helpers.writeAvatarFile(key, buffer);
    const filePath = helpers.getAvatarFilePath(key);
    assert.ok(fs.existsSync(filePath));
    await helpers.removeAvatarFile(key);
    assert.ok(!fs.existsSync(filePath));
  });

  it('removeAvatarFile is a no-op for null key', async () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    // Should not throw
    await helpers.removeAvatarFile(null);
    await helpers.removeAvatarFile(undefined);
    await helpers.removeAvatarFile('');
    assert.ok(true);
  });
});

describe('avatar: handleAvatarUpload', () => {
  it('is a function', () => {
    const sendError = makeSendError();
    const helpers = createAvatarHelpers({ config: makeConfig(), sendError, ErrorCodes });
    assert.equal(typeof helpers.handleAvatarUpload, 'function');
  });
});
