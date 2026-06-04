import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  extractArtistId,
  matchSuggestions,
  SPOTIFY_SCOPES,
  type ListeningArtist,
  type SuggestionSet,
} from '../lib/spotify-oauth.js';

import {
  encryptRefreshToken,
  decryptRefreshToken,
  createSpotifyAccountsStore,
} from '../lib/db/stores/spotify-accounts.js';

// ───────────────────────────────────────────────────────────────────────────
// PKCE helpers
// ───────────────────────────────────────────────────────────────────────────

describe('spotify-oauth: PKCE helpers', () => {
  it('generates a verifier of RFC-7636-legal length (43-128) and charset', () => {
    for (let i = 0; i < 50; i++) {
      const v = generateCodeVerifier();
      assert.ok(v.length >= 43 && v.length <= 128, `length ${v.length}`);
      assert.match(v, /^[A-Za-z0-9\-_]+$/, 'base64url charset, no padding');
    }
  });

  it('derives an S256 challenge = base64url(SHA256(verifier))', () => {
    const verifier = 'test-verifier-1234567890-abcdefghijklmnop';
    const expected = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assert.equal(deriveCodeChallenge(verifier), expected);
  });

  it('challenge differs from the verifier and is deterministic', () => {
    const v = generateCodeVerifier();
    const c1 = deriveCodeChallenge(v);
    const c2 = deriveCodeChallenge(v);
    assert.equal(c1, c2);
    assert.notEqual(c1, v);
  });

  it('generates a random URL-safe state', () => {
    const a = generateState();
    const b = generateState();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9\-_]+$/);
  });

  it('builds an authorize URL with all required PKCE params', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://festie.us/api/v1/spotify/auth/callback',
      codeChallenge: 'chal',
      state: 'st',
    });
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
    assert.equal(u.searchParams.get('client_id'), 'cid');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('code_challenge'), 'chal');
    assert.equal(u.searchParams.get('state'), 'st');
    assert.equal(u.searchParams.get('scope'), SPOTIFY_SCOPES);
    assert.equal(u.searchParams.get('redirect_uri'), 'https://festie.us/api/v1/spotify/auth/callback');
  });

  it('requests all four scopes together', () => {
    assert.deepEqual(SPOTIFY_SCOPES.split(' ').sort(), [
      'playlist-modify-private',
      'playlist-modify-public',
      'user-follow-read',
      'user-top-read',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Token exchange / refresh (mock fetch)
// ───────────────────────────────────────────────────────────────────────────

function mockFetchOnce(response: any) {
  const calls: any[] = [];
  const fetchImpl = (async (url: any, opts: any) => {
    calls.push({ url, opts });
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('spotify-oauth: exchangeCodeForTokens', () => {
  it('posts grant_type=authorization_code + verifier and normalizes the response', async () => {
    const { fetchImpl, calls } = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: SPOTIFY_SCOPES,
        token_type: 'Bearer',
      }),
    });
    const tokens = await exchangeCodeForTokens({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'the-code',
      redirectUri: 'https://festie.us/cb',
      codeVerifier: 'the-verifier',
      fetchImpl,
    });
    assert.equal(tokens.accessToken, 'at');
    assert.equal(tokens.refreshToken, 'rt');
    assert.equal(tokens.expiresIn, 3600);

    const body = String(calls[0].opts.body);
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /code=the-code/);
    assert.match(body, /code_verifier=the-verifier/);
    // Web confidential client sends Basic auth.
    assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  });

  it('omits Basic auth when no client secret (mobile pure PKCE)', async () => {
    const { fetchImpl, calls } = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    });
    await exchangeCodeForTokens({
      clientId: 'cid',
      code: 'c',
      redirectUri: 'festie://spotify-callback',
      codeVerifier: 'v',
      fetchImpl,
    });
    assert.equal(calls[0].opts.headers.Authorization, undefined);
    assert.match(String(calls[0].opts.body), /client_id=cid/);
  });

  it('throws a token-free error on non-OK (message has no secrets)', async () => {
    const { fetchImpl } = mockFetchOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'code expired' }),
    });
    await assert.rejects(
      () =>
        exchangeCodeForTokens({
          clientId: 'cid',
          code: 'c',
          redirectUri: 'r',
          codeVerifier: 'v',
          fetchImpl,
        }),
      /code exchange failed \(400\): code expired/,
    );
  });
});

describe('spotify-oauth: refreshAccessToken', () => {
  it('posts grant_type=refresh_token and returns a new access token', async () => {
    const { fetchImpl, calls } = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'fresh', expires_in: 3600 }),
    });
    const tokens = await refreshAccessToken({ clientId: 'cid', refreshToken: 'rt', fetchImpl });
    assert.equal(tokens.accessToken, 'fresh');
    assert.equal(tokens.refreshToken, null); // not rotated this time
    assert.match(String(calls[0].opts.body), /grant_type=refresh_token/);
    assert.match(String(calls[0].opts.body), /refresh_token=rt/);
  });

  it('surfaces a rotated refresh token when Spotify returns one', async () => {
    const { fetchImpl } = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'a', refresh_token: 'rotated', expires_in: 3600 }),
    });
    const tokens = await refreshAccessToken({ clientId: 'cid', refreshToken: 'old', fetchImpl });
    assert.equal(tokens.refreshToken, 'rotated');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// extractArtistId
// ───────────────────────────────────────────────────────────────────────────

describe('spotify-oauth: extractArtistId', () => {
  it('extracts an ID from a full open.spotify.com URL', () => {
    assert.equal(extractArtistId('https://open.spotify.com/artist/2CIMQHirSU0MQqyYHq0eOx'), '2CIMQHirSU0MQqyYHq0eOx');
  });
  it('accepts a bare ID', () => {
    assert.equal(extractArtistId('2CIMQHirSU0MQqyYHq0eOx'), '2CIMQHirSU0MQqyYHq0eOx');
  });
  it('returns null for non-spotify links / empty', () => {
    assert.equal(extractArtistId('https://soundcloud.com/x'), null);
    assert.equal(extractArtistId(''), null);
    assert.equal(extractArtistId(null), null);
    assert.equal(extractArtistId(undefined), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// matchSuggestions — the server-side join
// ───────────────────────────────────────────────────────────────────────────

describe('spotify-oauth: matchSuggestions join', () => {
  const sets: SuggestionSet[] = [
    {
      id: 'set-1',
      artists: [{ name: 'Bonobo', links: { spotify: 'https://open.spotify.com/artist/AAA' } }],
    },
    {
      id: 'set-2',
      artists: [{ name: 'Caribou', links: { spotify: 'https://open.spotify.com/artist/BBB' } }],
    },
    {
      id: 'set-3',
      artists: [{ name: 'Unknown', links: { spotify: 'https://open.spotify.com/artist/ZZZ' } }],
    },
    {
      id: 'set-4',
      artists: [{ name: 'NoLink', links: null }],
    },
  ];

  it('matches sets whose artist ID appears in the listening signals', () => {
    const listening: ListeningArtist[] = [
      { id: 'AAA', source: 'top_short', rank: 2 },
      { id: 'BBB', source: 'followed' },
    ];
    const matches = matchSuggestions(sets, listening);
    const ids = matches.map((m) => m.setId).sort();
    assert.deepEqual(ids, ['set-1', 'set-2']);
  });

  it('assigns "must" for a top-10 artist, "want" for top-30, "maybe" for followed-only', () => {
    const listening: ListeningArtist[] = [
      { id: 'AAA', source: 'top_long', rank: 1 }, // top 10 → must
      { id: 'BBB', source: 'followed' }, // followed only → maybe
    ];
    const m = matchSuggestions(sets, listening);
    const byId = Object.fromEntries(m.map((x) => [x.setId, x]));
    assert.equal(byId['set-1']!.suggestedPriority, 'must');
    assert.equal(byId['set-2']!.suggestedPriority, 'maybe');
  });

  it('assigns "want" for a mid-ranked (top 11-30) artist', () => {
    const m = matchSuggestions(sets, [{ id: 'AAA', source: 'top_medium', rank: 20 }]);
    assert.equal(m[0]!.suggestedPriority, 'want');
  });

  it('uses the strongest (lowest-rank) signal when an artist appears in several terms', () => {
    const listening: ListeningArtist[] = [
      { id: 'AAA', source: 'top_long', rank: 40 }, // maybe alone
      { id: 'AAA', source: 'top_short', rank: 3 }, // must
    ];
    const m = matchSuggestions(sets, listening);
    assert.equal(m[0]!.suggestedPriority, 'must');
    assert.deepEqual(m[0]!.reasons.sort(), ['top_long', 'top_short']);
  });

  it('returns no matches when nothing overlaps', () => {
    assert.equal(matchSuggestions(sets, [{ id: 'NOPE', source: 'followed' }]).length, 0);
  });

  it('ignores artists with no stored Spotify link', () => {
    // set-4 has no link → never matched even if some ID is in listening.
    const m = matchSuggestions(sets, [{ id: 'whatever', source: 'followed' }]);
    assert.ok(!m.some((x) => x.setId === 'set-4'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Refresh-token encryption at rest
// ───────────────────────────────────────────────────────────────────────────

describe('spotify-accounts: encryption at rest', () => {
  const secret = 'a-strong-session-secret-for-tests-0123456789';

  it('round-trips a refresh token', () => {
    const enc = encryptRefreshToken('my-refresh-token', secret)!;
    assert.notEqual(enc, 'my-refresh-token');
    assert.match(enc, /^[^.]+\.[^.]+\.[^.]+$/); // iv.tag.ciphertext
    assert.equal(decryptRefreshToken(enc, secret), 'my-refresh-token');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptRefreshToken('same', secret);
    const b = encryptRefreshToken('same', secret);
    assert.notEqual(a, b);
    assert.equal(decryptRefreshToken(a, secret), 'same');
    assert.equal(decryptRefreshToken(b, secret), 'same');
  });

  it('fails to decrypt with the wrong secret (auth tag)', () => {
    const enc = encryptRefreshToken('secret-token', secret)!;
    assert.equal(decryptRefreshToken(enc, 'a-totally-different-secret-value-zzz'), null);
  });

  it('returns null on malformed / tampered input', () => {
    assert.equal(decryptRefreshToken('not-valid', secret), null);
    assert.equal(decryptRefreshToken('', secret), null);
    assert.equal(decryptRefreshToken(null, secret), null);
    assert.equal(encryptRefreshToken('', secret), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Store: never returns the refresh token; encrypts on write (mock pool)
// ───────────────────────────────────────────────────────────────────────────

describe('spotify-accounts store: mock-pool behavior', () => {
  const secret = 'store-test-secret-abcdefghijklmnop';

  function mockPool() {
    const queries: any[] = [];
    let stored: Record<string, any> | null = null;
    const pool: any = {
      async query(sql: string, params: any[]) {
        queries.push({ sql, params });
        if (/INSERT INTO spotify_accounts/.test(sql)) {
          stored = {
            user_id: params[0],
            spotify_user_id: params[1],
            refresh_token_encrypted: params[2],
            scopes: params[3],
            connected_at: new Date(),
            updated_at: new Date(),
          };
          // RETURNING omits the encrypted token (per SQL).
          return {
            rows: [
              {
                user_id: stored.user_id,
                spotify_user_id: stored.spotify_user_id,
                scopes: stored.scopes,
                connected_at: stored.connected_at,
                updated_at: stored.updated_at,
              },
            ],
          };
        }
        if (/SELECT refresh_token_encrypted/.test(sql)) {
          return { rows: stored ? [{ refresh_token_encrypted: stored.refresh_token_encrypted }] : [] };
        }
        if (/SELECT[\s\S]*user_id[\s\S]*spotify_user_id[\s\S]*scopes/.test(sql)) {
          return { rows: stored ? [stored] : [] };
        }
        if (/SELECT 1 FROM spotify_accounts/.test(sql)) {
          return { rows: stored && stored.refresh_token_encrypted ? [{ '?column?': 1 }] : [] };
        }
        return { rows: [] };
      },
    };
    return { pool, getStored: () => stored, queries };
  }

  it('encrypts the refresh token on upsert and never returns it', async () => {
    const { pool, getStored } = mockPool();
    const store = createSpotifyAccountsStore(pool, { sessionSecret: secret });
    const result = await store.upsert({
      userId: 'u1',
      spotifyUserId: 'sp1',
      refreshToken: 'plain-refresh',
      scopes: SPOTIFY_SCOPES,
    });
    // Returned row must not leak the token.
    assert.equal((result as any).refresh_token_encrypted, undefined);
    // Stored value is encrypted, not plaintext.
    assert.notEqual(getStored()!.refresh_token_encrypted, 'plain-refresh');
    assert.match(getStored()!.refresh_token_encrypted, /^[^.]+\.[^.]+\.[^.]+$/);
  });

  it('getDecryptedRefreshToken returns the original plaintext (internal use only)', async () => {
    const { pool } = mockPool();
    const store = createSpotifyAccountsStore(pool, { sessionSecret: secret });
    await store.upsert({ userId: 'u1', refreshToken: 'plain-refresh', scopes: null });
    assert.equal(await store.getDecryptedRefreshToken('u1'), 'plain-refresh');
  });

  it('getStatus never includes any token field', async () => {
    const { pool } = mockPool();
    const store = createSpotifyAccountsStore(pool, { sessionSecret: secret });
    await store.upsert({ userId: 'u1', spotifyUserId: 'sp1', refreshToken: 'r', scopes: 's' });
    const status = await store.getStatus('u1');
    assert.ok(status);
    assert.equal((status as any).refreshToken, undefined);
    assert.equal((status as any).refresh_token_encrypted, undefined);
    assert.equal(status!.spotifyUserId, 'sp1');
  });
});
