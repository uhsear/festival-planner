/**
 * Avatar storage — the single filesystem seam for the avatar path.
 *
 * Path construction and avatar-key validation deliberately stay in
 * `lib/app-context/avatar.ts` — this module receives real absolute paths and
 * never invents one. `avatarDirPath()` must keep returning a plain string
 * because `lib/middleware.ts` (express.static) and `lib/shutdown.ts` (orphan
 * sweep) consume that same directory directly.
 */
import fs from 'fs';
import path from 'path';

export interface AvatarStorage {
  /** Synchronous on purpose — see `ensureDir` below. */
  ensureDir(dir: string): void;
  writeFileAtomic(targetPath: string, buffer: any): Promise<void>;
  removeFile(targetPath: string): Promise<void>;
}

export const avatarStorage: AvatarStorage = {
  /**
   * Create the directory and sweep leftover temp files from interrupted writes.
   *
   * Must stay SYNCHRONOUS: it is called at app-context construction time, and
   * the directory has to exist before `lib/middleware.ts` hands it to
   * express.static. An async version would make that call fire-and-forget.
   */
  ensureDir(dir) {
    // No explicit mode: permissions stay default 0o777 masked by the umask.
    fs.mkdirSync(dir, { recursive: true });
    // Staleness is the '.tmp' suffix alone — no age or ownership check, so a
    // concurrent upload's in-flight temp file is swept too. Preserved as-is.
    const staleFiles = fs.readdirSync(dir).filter((f: string) => f.endsWith('.tmp'));
    for (const staleFile of staleFiles) {
      // force (missing file is fine) but NOT recursive: a *.tmp directory
      // still throws out of here, aborting the sweep, exactly as before.
      fs.rmSync(path.join(dir, staleFile), { force: true });
    }
  },

  async writeFileAtomic(targetPath, buffer) {
    // Deterministic temp name, same directory as the target — not unique per
    // request. Two writes of the same key collide on it, as they always have.
    const tempPath = `${targetPath}.tmp`;
    try {
      await fs.promises.writeFile(tempPath, buffer);
      // Same-directory rename(2) is an atomic replace, and it is the only
      // thing stopping the concurrent express.static reader from serving a
      // half-written WebP. Never write the target in place instead.
      await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
      // Best effort cleanup whose own failure is swallowed: the caller must
      // see the original write/rename error, since routes/account.ts wraps it
      // and relies on it carrying no statusCode.
      try { await fs.promises.rm(tempPath, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  },

  async removeFile(targetPath) {
    // force swallows ENOENT only, so a double delete is safe while EACCES and
    // friends still reject — callers absorb those with .catch(() => {}).
    await fs.promises.rm(targetPath, { force: true });
  },
};
