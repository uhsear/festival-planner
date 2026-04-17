'use strict';
/**
 * Avatar helpers — filesystem + multer upload wiring.
 *
 * Extracted from `lib/app-context/index.js` during sprint-6. The factory
 * below takes the three things avatar code needs from the surrounding
 * context (config, sendError, ErrorCodes) and returns every helper the
 * composer used to build inline. Behaviour is byte-identical.
 *
 * Why this cut is clean:
 *   - No shared closures with the rest of the context (no cache versions,
 *     no `_io`, no `state` mutation).
 *   - `AvatarPool` is instantiated here but owned by the caller in the
 *     sense that it's also returned so the composer can expose it on the
 *     context object (`avatarPool` field, consumed by close handlers).
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { AvatarPool } = require('../avatar-pool');
const { ALLOWED_AVATAR_MIME_TYPES } = require('../constants');

/**
 * Build avatar helpers bound to the supplied config + response helpers.
 * @param {object} args
 * @param {object} args.config    - loaded config (needs PUBLIC_DIR, AVATAR_MAX_UPLOAD_BYTES)
 * @param {Function} args.sendError  - response sendError(res, status, msg, code)
 * @param {object} args.ErrorCodes   - error-code enum (needs INVALID_INPUT)
 * @returns {object} avatar helpers + pool
 */
function createAvatarHelpers({ config, sendError, ErrorCodes }) {
  function avatarDirPath() {
    return path.join(config.PUBLIC_DIR, 'uploads', 'avatars');
  }

  function ensureAvatarDir() {
    const dir = avatarDirPath();
    fs.mkdirSync(dir, { recursive: true });
    const staleFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    for (const staleFile of staleFiles) {
      fs.rmSync(path.join(dir, staleFile), { force: true });
    }
  }

  function getAvatarFilePath(avatarKey) {
    const normalizedKey = String(avatarKey || '').toLowerCase();
    if (!/^[a-f0-9]{24,64}$/.test(normalizedKey)) {
      throw new Error('Invalid avatar key');
    }
    return path.join(avatarDirPath(), `${normalizedKey}.webp`);
  }

  const avatarPool = new AvatarPool();
  async function processAvatarUpload(buffer) {
    return avatarPool.process(buffer, config);
  }

  async function writeAvatarFile(avatarKey, buffer) {
    ensureAvatarDir();
    const targetPath = getAvatarFilePath(avatarKey);
    const tempPath = `${targetPath}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, buffer);
      await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
      try { await fs.promises.rm(tempPath, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  async function removeAvatarFile(avatarKey) {
    if (!avatarKey) return;
    const targetPath = getAvatarFilePath(avatarKey);
    await fs.promises.rm(targetPath, { force: true });
  }

  // Multer instance + the request-middleware wrapper that converts its
  // errors into our sendError format.
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.AVATAR_MAX_UPLOAD_BYTES,
      files: 1,
      parts: 10,
    },
    fileFilter: (_req, file, callback) => {
      if (!ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
        const error = new Error('Only JPEG, PNG, GIF, or WebP images are allowed');
        error.statusCode = 400;
        callback(error);
        return;
      }
      callback(null, true);
    },
  });

  function handleAvatarUpload(req, res, next) {
    avatarUpload.single('avatar')(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 400, `Avatar must be ${Math.floor(config.AVATAR_MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller`, ErrorCodes.INVALID_INPUT);
      }
      if (error instanceof multer.MulterError) {
        return sendError(res, 400, 'Invalid avatar upload', ErrorCodes.INVALID_INPUT);
      }
      if (error.statusCode) {
        return sendError(res, error.statusCode, error.message, ErrorCodes.INVALID_INPUT);
      }
      return sendError(res, 400, 'Invalid avatar upload', ErrorCodes.INVALID_INPUT);
    });
  }

  // Startup housekeeping — identical to pre-extract behaviour, which ran
  // `ensureAvatarDir()` once inline near the tail of the avatar block.
  ensureAvatarDir();

  return {
    avatarPool,
    avatarDirPath,
    ensureAvatarDir,
    getAvatarFilePath,
    processAvatarUpload,
    writeAvatarFile,
    removeAvatarFile,
    handleAvatarUpload,
  };
}

module.exports = { createAvatarHelpers };
