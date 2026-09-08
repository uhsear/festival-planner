import { describe, it, expect, vi, beforeEach } from 'vitest';

// The mobile harness is node-only, so `expo-file-system` is replaced with a tiny
// in-memory filesystem: a uri -> byte-size map plus a settable download impl.
// That is exactly the level at which this module's contract is decidable —
// which paths it writes, when it re-downloads, and what it leaves behind on a
// failed transfer.
const fs = vi.hoisted(() => ({
  files: new Map<string, number>(),
  dirs: new Set<string>(),
  download: vi.fn(),
}));

vi.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');

  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return fs.dirs.has(this.uri);
    }
    create() {
      fs.dirs.add(this.uri);
    }
  }

  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    get size() {
      return fs.files.get(this.uri) ?? 0;
    }
    get lastModified() {
      return fs.files.has(this.uri) ? 1_700_000_000_000 : null;
    }
    delete() {
      fs.files.delete(this.uri);
    }
    rename(newName: string) {
      const size = fs.files.get(this.uri) ?? 0;
      fs.files.delete(this.uri);
      this.uri = this.uri.replace(/[^/]+$/, newName);
      fs.files.set(this.uri, size);
    }
    static downloadFileAsync = fs.download;
  }

  return { File, Directory, Paths: { cache: 'file:///cache' } };
});

const { basemapCacheKey, basemapCacheFile, basemapCacheInfo, ensureBasemapCached } = await import('./basemapCache');

const URL_A = 'https://festie.us/uploads/basemaps/nc-2026.pmtiles';
const cachePath = (url: string) => `file:///cache/festie-basemaps/${basemapCacheKey(url)}`;

/** Make the mocked download write `bytes` to its destination and resolve. */
function downloadWrites(bytes: number) {
  fs.download.mockImplementation(async (_url: string, dest: { uri: string }) => {
    fs.files.set(dest.uri, bytes);
    return dest;
  });
}

beforeEach(() => {
  fs.files.clear();
  fs.dirs.clear();
  fs.download.mockReset();
  downloadWrites(1_513_213);
});

describe('basemapCacheKey', () => {
  it('is stable for a URL and distinct across URLs', () => {
    expect(basemapCacheKey(URL_A)).toBe(basemapCacheKey(URL_A));
    expect(basemapCacheKey(URL_A)).not.toBe(basemapCacheKey(URL_A.replace('nc', 'fk')));
    expect(basemapCacheKey(URL_A)).toMatch(/^[0-9a-f]{8}\.pmtiles$/);
  });
});

describe('ensureBasemapCached', () => {
  it('rejects a non-https URL without touching the network', async () => {
    expect(await ensureBasemapCached('http://festie.us/a.pmtiles')).toBeNull();
    expect(fs.download).not.toHaveBeenCalled();
  });

  it('downloads once, then serves the local copy without re-downloading', async () => {
    const uri = await ensureBasemapCached(URL_A);
    expect(uri).toBe(cachePath(URL_A));
    expect(fs.download).toHaveBeenCalledTimes(1);

    expect(await ensureBasemapCached(URL_A)).toBe(cachePath(URL_A));
    expect(fs.download).toHaveBeenCalledTimes(1);
  });

  it('stages into a .part file so the cache path is never a partial archive', async () => {
    // The transfer fails after writing some bytes — exactly the documented
    // Android behaviour. Nothing may land at the final cache path.
    fs.download.mockImplementation(async (_url: string, dest: { uri: string }) => {
      fs.files.set(dest.uri, 512);
      throw new Error('connection reset');
    });

    expect(await ensureBasemapCached(URL_A)).toBeNull();
    expect(fs.files.has(cachePath(URL_A))).toBe(false);
    expect(basemapCacheInfo(URL_A).cached).toBe(false);
    // No staged leftovers: the staging name is unique per attempt, so a failed
    // transfer that did not clean up would orphan a file nothing reclaims.
    expect([...fs.files.keys()].filter((f) => f.endsWith('.part'))).toEqual([]);

    // The next attempt succeeds and leaves nothing staged behind.
    downloadWrites(1_513_213);
    expect(await ensureBasemapCached(URL_A)).toBe(cachePath(URL_A));
    expect(fs.files.get(cachePath(URL_A))).toBe(1_513_213);
    expect([...fs.files.keys()].filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('treats an empty download as a failure and leaves nothing cached', async () => {
    downloadWrites(0);
    expect(await ensureBasemapCached(URL_A)).toBeNull();
    expect(fs.files.has(cachePath(URL_A))).toBe(false);
  });

  it('re-downloads over a zero-byte file left at the cache path', async () => {
    fs.files.set(cachePath(URL_A), 0);
    expect(await ensureBasemapCached(URL_A)).toBe(cachePath(URL_A));
    expect(fs.download).toHaveBeenCalledTimes(1);
    expect(fs.files.get(cachePath(URL_A))).toBe(1_513_213);
  });
});

describe('basemapCacheInfo', () => {
  it('reports nothing cached for a missing file or a null URL', () => {
    expect(basemapCacheInfo(null)).toEqual({ cached: false, bytes: 0, syncedAt: null });
    expect(basemapCacheInfo(URL_A)).toEqual({ cached: false, bytes: 0, syncedAt: null });
  });

  it('reads readiness from the filesystem, not from remembered state', async () => {
    await ensureBasemapCached(URL_A);
    expect(basemapCacheInfo(URL_A)).toEqual({
      cached: true,
      bytes: 1_513_213,
      syncedAt: 1_700_000_000_000,
    });

    // OS cache eviction: the bytes go, and readiness must go with them.
    basemapCacheFile(URL_A).delete();
    expect(basemapCacheInfo(URL_A).cached).toBe(false);
  });
});
