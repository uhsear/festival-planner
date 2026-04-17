/**
 * Avatar file operations — extracted from app-context.js
 * Handles avatar directory, file read/write/delete, and image processing.
 */
'use strict';

const path = require('path');
const fs = require('fs');

function createAvatarFileHelpers({ config, avatarPool, log }) {
  function avatarDirPath() {
    return path.join(config.DATA_DIR, config.AVATAR_SUBDIR);
  }

  function ensureAvatarDir() {
    const dir = avatarDirPath();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log.info('created avatar directory', { path: dir });
    }
    return dir;
  }

  function getAvatarFilePath(avatarKey) {
    if (!avatarKey || typeof avatarKey !== 'string') return null;
    const safeKey = path.basename(avatarKey);
    return path.join(avatarDirPath(), safeKey);
  }

  async function processAvatarUpload(buffer) {
    return avatarPool.process(buffer, config.AVATAR_SIZE, config.AVATAR_WEBP_QUALITY, config.AVATAR_MAX_PIXELS);
  }

  async function writeAvatarFile(avatarKey, buffer) {
    ensureAvatarDir();
    const filePath = getAvatarFilePath(avatarKey);
    if (!filePath) throw new Error('Invalid avatar key');
    await fs.promises.writeFile(filePath, buffer);
    log.info('avatar written', { key: avatarKey, size: buffer.length });
    return filePath;
  }

  async function removeAvatarFile(avatarKey) {
    const filePath = getAvatarFilePath(avatarKey);
    if (!filePath) return;
    try {
      await fs.promises.unlink(filePath);
      log.info('avatar removed', { key: avatarKey });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.warn('avatar removal failed', { key: avatarKey, error: err.message });
      }
    }
  }

  return { avatarDirPath, ensureAvatarDir, getAvatarFilePath, processAvatarUpload, writeAvatarFile, removeAvatarFile };
}

module.exports = { createAvatarFileHelpers };
