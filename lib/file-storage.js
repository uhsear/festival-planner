module.exports = { createFileStorage, LocalFileStorage };

const fs = require('fs');
const path = require('path');

class LocalFileStorage {
  constructor(uploadDir, cdnBaseUrl) {
    this.uploadDir = uploadDir;
    this.cdnBaseUrl = cdnBaseUrl;
  }

  async write(key, buffer) {
    this._ensureDir();
    const filePath = this._getFilePath(key);
    // Use unique temp name to avoid concurrent upload race conditions
    const tempPath = `${filePath}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, buffer);
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      try { await fs.promises.rm(tempPath, { force: true }); } catch { /* ignored */ }
      throw error;
    }
  }

  async remove(key) {
    if (!key) return;
    const filePath = this._getFilePath(key);
    await fs.promises.rm(filePath, { force: true });
  }

  getUrl(key) {
    if (!key) return null;
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl}/avatars/${key}.webp`;
    }
    return `/uploads/avatars/${key}.webp`;
  }

  _ensureDir() {
    fs.mkdirSync(this.uploadDir, { recursive: true });
    // Clean stale temp files older than 5 minutes (safe for concurrent uploads)
    try {
      const staleFiles = fs.readdirSync(this.uploadDir).filter((f) => f.endsWith('.tmp'));
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      for (const staleFile of staleFiles) {
        const fullPath = path.join(this.uploadDir, staleFile);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < fiveMinAgo) {
            fs.rmSync(fullPath, { force: true });
          }
        } catch { /* ignore stat errors for files already cleaned up */ }
      }
    } catch { /* ignore cleanup errors */ }
  }

  _getFilePath(key) {
    if (!/^[a-f0-9]{24,64}$/i.test(String(key || ''))) {
      throw new Error('Invalid file key');
    }
    return path.join(this.uploadDir, `${key}.webp`);
  }
}

function createFileStorage(config, _log) {
  const storageType = (config.STORAGE_TYPE || 'local').toLowerCase();

  if (storageType === 'local') {
    const uploadDir = path.join(config.PUBLIC_DIR, 'uploads', 'avatars');
    const cdnBaseUrl = config.CDN_BASE_URL || null;
    return new LocalFileStorage(uploadDir, cdnBaseUrl);
  }

  throw new Error(`Unknown storage type: ${storageType}`);
}
