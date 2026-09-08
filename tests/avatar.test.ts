import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// We need to create a temp dir for avatar operations
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-avatar-test-'));
});

afterEach(() => {
  mock.restoreAll();
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

// Characterization tests: these pin the avatar storage behaviour as it exists
// today, not what it ought to be. A failure here means a refactor changed
// observable behaviour.

function makeHelpers() {
  return createAvatarHelpers({ config: makeConfig(), sendError: makeSendError(), ErrorCodes });
}

const KEY = 'a'.repeat(24); // routes generate randomBytes(12).toString('hex') = 24 hex chars

describe('avatar characterization: key validation is the only traversal guard', () => {
  it('rejects traversal attempts before any path is built', () => {
    const helpers = makeHelpers();
    for (const bad of ['../../etc/passwd', `../${KEY}`, `${KEY}/../../x`, `${KEY}\\..\\x`, '.'.repeat(24)]) {
      assert.throws(() => helpers.getAvatarFilePath(bad), /Invalid avatar key/, `expected rejection for ${bad}`);
    }
  });

  it('confines every accepted key to the avatar directory', () => {
    const helpers = makeHelpers();
    assert.ok(helpers.getAvatarFilePath('f'.repeat(64)).startsWith(helpers.avatarDirPath() + path.sep));
  });
});

describe('avatar characterization: writeAvatarFile', () => {
  it('writes to <target>.tmp first and only then renames onto the target', async () => {
    const helpers = makeHelpers();
    const target = helpers.getAvatarFilePath(KEY);
    const seen: any = {};
    const realRename = fs.promises.rename;
    mock.method(fs.promises, 'rename', async (from: any, to: any) => {
      // Observed at the moment of the rename: the payload is fully written to
      // the temp path and the target does not exist yet. This is what keeps a
      // concurrent express.static reader from serving a half-written WebP.
      seen.from = from;
      seen.to = to;
      seen.tempContents = fs.readFileSync(from, 'utf8');
      seen.targetExisted = fs.existsSync(to);
      return realRename(from, to);
    });

    await helpers.writeAvatarFile(KEY, Buffer.from('webp-bytes'));

    assert.equal(seen.from, `${target}.tmp`);
    assert.equal(seen.to, target);
    assert.equal(seen.tempContents, 'webp-bytes');
    assert.equal(seen.targetExisted, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'webp-bytes');
    assert.deepEqual(fs.readdirSync(helpers.avatarDirPath()), [`${KEY}.webp`]);
  });

  it('removes the temp file and rethrows the original error when the rename fails', async () => {
    const helpers = makeHelpers();
    const target = helpers.getAvatarFilePath(KEY);
    // A directory sitting on the target path makes rename(2) fail for real.
    fs.mkdirSync(target, { recursive: true });

    const error: any = await helpers.writeAvatarFile(KEY, Buffer.from('webp-bytes')).then(
      () => null,
      (err: any) => err,
    );

    assert.ok(error, 'expected writeAvatarFile to reject');
    // The caller must see the write/rename failure, never the cleanup error —
    // routes/account.ts wraps this as Error('Avatar write failed during upload').
    assert.equal(error.syscall, 'rename');
    assert.equal(error.statusCode, undefined); // keeps the route on its generic 400 branch
    assert.equal(fs.existsSync(`${target}.tmp`), false, 'temp file should be cleaned up');
  });

  it('overwrites in place when the same key is written twice', async () => {
    const helpers = makeHelpers();
    await helpers.writeAvatarFile(KEY, Buffer.from('first'));
    await helpers.writeAvatarFile(KEY, Buffer.from('second'));
    // Re-upload reuses the existing avatarKey, so the old file is replaced and
    // only avatarVersion changes. Cache busting depends entirely on the ?v= token.
    assert.equal(fs.readFileSync(helpers.getAvatarFilePath(KEY), 'utf8'), 'second');
    assert.deepEqual(fs.readdirSync(helpers.avatarDirPath()), [`${KEY}.webp`]);
  });

  it('ensures the directory BEFORE validating the key', async () => {
    const helpers = makeHelpers();
    const dir = helpers.avatarDirPath();
    fs.rmSync(dir, { recursive: true, force: true });
    await assert.rejects(() => helpers.writeAvatarFile('not-a-key', Buffer.from('x')), /Invalid avatar key/);
    // Ordering is observable: an invalid key still creates the directory and
    // still runs the stale .tmp sweep before the throw.
    assert.ok(fs.existsSync(dir), 'directory is created even for an invalid key');
  });
});

describe('avatar characterization: the stale .tmp sweep', () => {
  it('sweeps leftover .tmp files synchronously at factory construction', () => {
    const dir = path.join(tmpDir, 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${KEY}.webp.tmp`), 'interrupted');
    makeHelpers();
    // Synchronous: the sweep has already happened by the time the factory
    // returns, which is what lets lib/middleware.ts hand the directory to
    // express.static immediately afterwards.
    assert.deepEqual(fs.readdirSync(dir), []);
  });

});

