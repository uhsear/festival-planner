import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

let spotify: any;
let originalFetch: any;
let _importCounter = 0;

async function freshModule() {
  return await import(`../lib/spotify.js?v=${++_importCounter}`);
}

function mockFetch(responses: any[]) {
  let callIndex = 0;
  const calls: any[] = [];
  globalThis.fetch = async (url: any, opts: any) => {
    calls.push({ url, opts });
    const resp = responses[callIndex] || { ok: false, status: 500, text: async () => 'error', json: async () => ({}) };
    callIndex++;
    return resp;
  };
  return calls;
}

describe('spotify: getToken', () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    spotify = await freshModule();
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('fetches and caches a token', async () => {
    const calls = mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok-123', expires_in: 3600 }) },
    ]);
    const token = await spotify.getToken('cid', 'csecret');
    assert.equal(token, 'tok-123');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('token'));
  });

  it('returns cached token on second call', async () => {
    const calls = mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'cached-tok', expires_in: 3600 }) },
    ]);
    await spotify.getToken('cid', 'csecret');
    const token2 = await spotify.getToken('cid', 'csecret');
    assert.equal(token2, 'cached-tok');
    assert.equal(calls.length, 1);
  });

  it('throws on non-ok response', async () => {
    mockFetch([
      { ok: false, status: 401, text: async () => 'Unauthorized' },
    ]);
    await assert.rejects(() => spotify.getToken('cid', 'csecret'), /Spotify token request failed/);
  });
});

describe('spotify: searchArtist', () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    spotify = await freshModule();
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('searches and returns artist data', async () => {
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) },
      {
        ok: true, status: 200, json: async () => ({
          artists: {
            items: [{
              id: 'sp-1',
              external_urls: { spotify: 'https://open.spotify.com/artist/sp-1' },
              images: [{ url: 'https://img.spotify.com/1.jpg' }],
              genres: ['edm', 'house'],
            }],
          },
        }),
      },
    ]);
    const result = await spotify.searchArtist('Deadmau5', 'cid', 'csecret');
    assert.equal(result.spotifyId, 'sp-1');
    assert.equal(result.spotifyUrl, 'https://open.spotify.com/artist/sp-1');
    assert.equal(result.imageUrl, 'https://img.spotify.com/1.jpg');
    assert.deepEqual(result.genres, ['edm', 'house']);
  });

  it('handles 401 with token refresh and retry', async () => {
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'old-tok', expires_in: 3600 }) },
      { ok: false, status: 401, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ access_token: 'new-tok', expires_in: 3600 }) },
      {
        ok: true, status: 200, json: async () => ({
          artists: { items: [{ id: 'sp-2', external_urls: {}, images: [], genres: [] }] },
        }),
      },
    ]);
    const result = await spotify.searchArtist('Test', 'cid', 'csecret');
    assert.equal(result.spotifyId, 'sp-2');
  });

  it('returns null on non-ok non-401 response', async () => {
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) },
      { ok: false, status: 500, json: async () => ({}) },
    ]);
    const result = await spotify.searchArtist('Test', 'cid', 'csecret');
    assert.equal(result, null);
  });

  it('returns null when retry also fails', async () => {
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) },
      { ok: false, status: 401, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ access_token: 'tok2', expires_in: 3600 }) },
      { ok: false, status: 503, json: async () => ({}) },
    ]);
    const result = await spotify.searchArtist('Test', 'cid', 'csecret');
    assert.equal(result, null);
  });

  it('returns null for no match', async () => {
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) },
      { ok: true, status: 200, json: async () => ({ artists: { items: [] } }) },
    ]);
    const result = await spotify.searchArtist('NonexistentArtist12345', 'cid', 'csecret');
    assert.equal(result, null);
  });
});

describe('spotify: bulkSearchArtists', () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    spotify = await freshModule();
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('searches multiple artists and returns Map', async () => {
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) },
      { ok: true, status: 200, json: async () => ({ artists: { items: [{ id: '1', external_urls: {}, images: [], genres: [] }] } }) },
      { ok: true, status: 200, json: async () => ({ artists: { items: [{ id: '2', external_urls: {}, images: [], genres: [] }] } }) },
    ]);
    const results = await spotify.bulkSearchArtists(['A', 'B'], 'cid', 'csecret', { delayMs: 0 });
    assert.equal(results.size, 2);
  });

  it('logs warning on search failure', async () => {
    const warnings: any[] = [];
    mockFetch([
      { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) },
    ]);
    globalThis.fetch = async () => { throw new Error('Network error'); };
    const results = await spotify.bulkSearchArtists(['A'], 'cid', 'csecret', {
      delayMs: 0,
      log: { warn: (msg: any, meta: any) => warnings.push({ msg, meta }) },
    });
    assert.equal(results.size, 0);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].meta.error.includes('Network error'));
  });
});
