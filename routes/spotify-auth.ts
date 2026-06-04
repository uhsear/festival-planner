/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Spotify user-OAuth routes (M4) — Authorization Code + PKCE.
 *
 * DORMANT when SPOTIFY_REDIRECT_URI (or client id) is unset: every endpoint
 * returns a clear "not configured" 503 instead of crashing.
 *
 * Endpoints (mounted under /api/v1):
 *   GET  /spotify/auth/start            → authorize URL + server-stored PKCE verifier (web)
 *   GET  /spotify/auth/callback         → web redirect target: exchange + store + redirect to SPA
 *   POST /spotify/auth/exchange         → mobile PKCE: { code, codeVerifier } → exchange + store
 *   GET  /spotify/suggestions/:festivalId → join top/followed artists vs lineup IDs
 *   POST /spotify/playlist/:festivalId  → build a playlist from the user's picks
 *   GET  /spotify/status                → is-connected (never returns tokens)
 *   POST /spotify/disconnect            → forget the connection
 *
 * Refresh tokens are encrypted at rest (spotify-accounts store) and NEVER
 * returned to the client or logged. Access tokens are minted on demand.
 */

import { Router } from 'express';
import {
  buildAuthorizeUrl,
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
  exchangeCodeForTokens,
  refreshAccessToken,
  matchSuggestions,
  extractArtistId,
  SPOTIFY_SCOPES,
  type ListeningArtist,
  type SuggestionSet,
} from '../lib/spotify-oauth.js';
import { cleanArtistName } from '../lib/spotify.js';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export default function createSpotifyAuthRoutes(deps: any) {
  const {
    config,
    log,
    stores,
    userAuth,
    rateLimit,
    sendSuccess,
    sendError,
    ErrorCodes,
    validate,
    validateParams,
    schemas,
  } = deps;
  const router = Router();

  // ── Feature gate ──────────────────────────────────────────────────────
  const isConfigured = () => Boolean(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_REDIRECT_URI);
  function notConfigured(res: any) {
    return sendError(res, 503, 'Spotify integration is not configured', ErrorCodes.SERVICE_UNAVAILABLE);
  }

  // ── Server-side PKCE state store (short-lived, in-memory TTL) ──────────
  // Maps opaque `state` → { verifier, userId, mode, expiresAt }. Single-fork
  // PM2 (CLUSTER_SIZE=1) keeps this worker-local map safe for the ~seconds
  // between /start and /callback. Mirrors the weather/spotify-preview cache.
  const STATE_TTL_MS = 10 * 60 * 1000; // 10 min to complete the consent screen
  const MAX_PENDING = 5000;
  const pkceStates = new Map<string, { verifier: string; userId: string; expiresAt: number }>();

  function putState(state: string, verifier: string, userId: string) {
    if (pkceStates.size >= MAX_PENDING) {
      // Evict the oldest entry (insertion-ordered Map).
      const oldest = pkceStates.keys().next().value;
      if (oldest) pkceStates.delete(oldest);
    }
    pkceStates.set(state, { verifier, userId, expiresAt: Date.now() + STATE_TTL_MS });
  }
  function takeState(state: string) {
    const entry = pkceStates.get(state);
    if (!entry) return null;
    pkceStates.delete(state); // single-use
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }
  // Lazy sweep of expired states on each start.
  function sweepStates() {
    const now = Date.now();
    for (const [k, v] of pkceStates) {
      if (now > v.expiresAt) pkceStates.delete(k);
    }
  }

  // ── Suggestions TTL cache (per-user join result) ──────────────────────
  const SUGGEST_TTL_MS = 5 * 60 * 1000;
  const SUGGEST_MAX = 2000;
  const suggestCache = new Map<string, { data: any; expiresAt: number }>();
  function getCachedSuggest(key: string) {
    const e = suggestCache.get(key);
    if (e && Date.now() < e.expiresAt) return e.data;
    if (e) suggestCache.delete(key);
    return null;
  }
  function setCachedSuggest(key: string, data: any) {
    if (suggestCache.size >= SUGGEST_MAX) {
      const oldest = suggestCache.keys().next().value;
      if (oldest) suggestCache.delete(oldest);
    }
    suggestCache.set(key, { data, expiresAt: Date.now() + SUGGEST_TTL_MS });
  }

  // ── Helper: mint a fresh user access token, rotating the stored refresh
  // token when Spotify returns a new one. Returns null if not connected.
  async function getUserAccessToken(userId: string): Promise<string | null> {
    const refreshToken = await stores.spotifyAccounts.getDecryptedRefreshToken(userId);
    if (!refreshToken) return null;
    const result = await refreshAccessToken({
      clientId: config.SPOTIFY_CLIENT_ID,
      clientSecret: config.SPOTIFY_CLIENT_SECRET || undefined,
      refreshToken,
    });
    // Spotify may rotate the refresh token; persist the new one if present.
    if (result.refreshToken && result.refreshToken !== refreshToken) {
      await stores.spotifyAccounts.updateRefreshToken(userId, result.refreshToken);
    }
    return result.accessToken;
  }

  async function spotifyGet(token: string, path: string): Promise<any | null> {
    const resp = await fetch(`${SPOTIFY_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET /spotify/auth/start — web: returns authorize URL + stores verifier.
  // ════════════════════════════════════════════════════════════════════════
  router.get('/spotify/auth/start', userAuth, rateLimit(20, 'spotify-auth-start'), async (req: any, res: any) => {
    if (!isConfigured()) return notConfigured(res);
    try {
      sweepStates();
      const verifier = generateCodeVerifier();
      const challenge = deriveCodeChallenge(verifier);
      const state = generateState();
      putState(state, verifier, req.user.userId);

      const url = buildAuthorizeUrl({
        clientId: config.SPOTIFY_CLIENT_ID,
        redirectUri: config.SPOTIFY_REDIRECT_URI,
        codeChallenge: challenge,
        state,
        scopes: SPOTIFY_SCOPES,
      });
      return sendSuccess(res, { authorizeUrl: url, state });
    } catch (err: any) {
      log.error('spotify auth start failed', { error: err.message });
      return sendError(res, 500, 'Failed to start Spotify connect', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // GET /spotify/auth/callback — web redirect target. Exchanges the code,
  // stores the encrypted refresh token, redirects back into the SPA.
  // NOTE: no userAuth — identity comes from the single-use server-side state.
  // ════════════════════════════════════════════════════════════════════════
  router.get('/spotify/auth/callback', rateLimit(30, 'spotify-auth-callback'), async (req: any, res: any) => {
    const spaBase = config.PUBLIC_ORIGIN || '';
    const redirectTo = (status: string) => `${spaBase}/spotify/connected?status=${encodeURIComponent(status)}`;

    if (!isConfigured()) return res.redirect(redirectTo('not_configured'));
    try {
      const { code, state, error } = req.query || {};
      if (error) return res.redirect(redirectTo('denied'));
      if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
        return res.redirect(redirectTo('invalid'));
      }
      const entry = takeState(state);
      if (!entry) return res.redirect(redirectTo('expired'));

      const tokens = await exchangeCodeForTokens({
        clientId: config.SPOTIFY_CLIENT_ID,
        clientSecret: config.SPOTIFY_CLIENT_SECRET || undefined,
        code,
        redirectUri: config.SPOTIFY_REDIRECT_URI,
        codeVerifier: entry.verifier,
      });
      if (!tokens.refreshToken) return res.redirect(redirectTo('no_refresh'));

      // Identify the Spotify account (best-effort; non-fatal).
      let spotifyUserId: string | null = null;
      try {
        const me = await spotifyGet(tokens.accessToken, '/me');
        spotifyUserId = me?.id ?? null;
      } catch {
        /* non-fatal */
      }

      await stores.spotifyAccounts.upsert({
        userId: entry.userId,
        spotifyUserId,
        refreshToken: tokens.refreshToken,
        scopes: tokens.scope || SPOTIFY_SCOPES,
      });
      return res.redirect(redirectTo('connected'));
    } catch (err: any) {
      // err.message describes the OAuth failure, never a token.
      log.error('spotify auth callback failed', { error: err.message });
      return res.redirect(redirectTo('error'));
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // POST /spotify/auth/exchange — mobile pure-PKCE. The app posts the code +
  // the verifier it generated; the server exchanges and stores. No client
  // secret is required for the mobile redirect URI.
  // ════════════════════════════════════════════════════════════════════════
  router.post(
    '/spotify/auth/exchange',
    userAuth,
    rateLimit(20, 'spotify-auth-exchange'),
    validate(schemas.spotifyExchange),
    async (req: any, res: any) => {
      if (!isConfigured()) return notConfigured(res);
      try {
        const { code, codeVerifier, redirectUri } = req.validatedBody;
        const tokens = await exchangeCodeForTokens({
          clientId: config.SPOTIFY_CLIENT_ID,
          // Mobile uses pure PKCE (no secret) — only send the secret if the
          // mobile redirect matches the confidential web redirect (it won't).
          clientSecret: undefined,
          code,
          redirectUri: redirectUri || config.SPOTIFY_REDIRECT_URI,
          codeVerifier,
        });
        if (!tokens.refreshToken) {
          return sendError(res, 502, 'Spotify did not return a refresh token', ErrorCodes.SERVICE_UNAVAILABLE);
        }

        let spotifyUserId: string | null = null;
        try {
          const me = await spotifyGet(tokens.accessToken, '/me');
          spotifyUserId = me?.id ?? null;
        } catch {
          /* non-fatal */
        }

        await stores.spotifyAccounts.upsert({
          userId: req.user.userId,
          spotifyUserId,
          refreshToken: tokens.refreshToken,
          scopes: tokens.scope || SPOTIFY_SCOPES,
        });
        return sendSuccess(res, { connected: true, spotifyUserId });
      } catch (err: any) {
        log.error('spotify auth exchange failed', { error: err.message });
        return sendError(res, 502, 'Spotify connect failed', ErrorCodes.SERVICE_UNAVAILABLE);
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // GET /spotify/status — connection status. NEVER returns a token.
  // ════════════════════════════════════════════════════════════════════════
  router.get('/spotify/status', userAuth, rateLimit(60, 'spotify-status'), async (req: any, res: any) => {
    try {
      const status = await stores.spotifyAccounts.getStatus(req.user.userId);
      return sendSuccess(res, {
        configured: isConfigured(),
        connected: Boolean(status),
        spotifyUserId: status?.spotifyUserId ?? null,
        connectedAt: status?.connectedAt ?? null,
      });
    } catch (err: any) {
      log.error('spotify status failed', { error: err.message });
      return sendError(res, 500, 'Failed to read Spotify status', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // POST /spotify/disconnect — forget the connection (deletes encrypted token).
  // ════════════════════════════════════════════════════════════════════════
  router.post('/spotify/disconnect', userAuth, rateLimit(20, 'spotify-disconnect'), async (req: any, res: any) => {
    try {
      await stores.spotifyAccounts.disconnect(req.user.userId);
      return sendSuccess(res, { connected: false });
    } catch (err: any) {
      log.error('spotify disconnect failed', { error: err.message });
      return sendError(res, 500, 'Failed to disconnect Spotify', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // GET /spotify/suggestions/:festivalId — join the user's top + followed
  // artists against this festival's lineup Spotify IDs. Read-only: the client
  // confirms accepted suggestions into picks via its existing (offline-native)
  // pick-save path. TTL-cached per user+festival to respect Spotify rate limits.
  // ════════════════════════════════════════════════════════════════════════
  router.get(
    '/spotify/suggestions/:festivalId',
    userAuth,
    rateLimit(30, 'spotify-suggestions'),
    validateParams(schemas.festivalIdParams),
    async (req: any, res: any) => {
      if (!isConfigured()) return notConfigured(res);
      try {
        const { festivalId } = req.validatedParams;
        const userId = req.user.userId;

        const cacheKey = `${userId}:${festivalId}`;
        const cached = getCachedSuggest(cacheKey);
        if (cached) return sendSuccess(res, cached);

        const token = await getUserAccessToken(userId);
        if (!token) return sendError(res, 409, 'Spotify is not connected', ErrorCodes.FORBIDDEN);

        // Load the lineup sets for this festival (must exist + not deleted).
        const setsResult = await stores.pool.query(
          `
  SELECT
    fs.id,
    fs.artists
  FROM
    festival_sets fs
    JOIN festivals f ON fs.festival_id = f.id
    AND f.deleted_at IS NULL
  WHERE
    fs.festival_id = $1
`,
          [festivalId],
        );
        if (!setsResult.rows.length) {
          const empty = { suggestions: [], unmatchedFallback: false, total: 0 };
          setCachedSuggest(cacheKey, empty);
          return sendSuccess(res, empty);
        }
        const sets: SuggestionSet[] = setsResult.rows.map((r: any) => ({
          id: r.id,
          artists: Array.isArray(r.artists) ? r.artists : [],
        }));

        // Gather the user's listening signals (deduped across terms).
        const listening: ListeningArtist[] = [];
        const terms: Array<['top_short' | 'top_medium' | 'top_long', string]> = [
          ['top_short', 'short_term'],
          ['top_medium', 'medium_term'],
          ['top_long', 'long_term'],
        ];
        for (const [source, range] of terms) {
          const data = await spotifyGet(token, `/me/top/artists?limit=50&time_range=${range}`);
          const items = data?.items || [];
          items.forEach((a: any, idx: number) => {
            if (a?.id) listening.push({ id: a.id, source, rank: idx });
          });
        }
        // Followed artists (paginated cursor).
        let after: string | null = null;
        let guard = 0;
        do {
          const path = `/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`;
          const data = await spotifyGet(token, path);
          const items = data?.artists?.items || [];
          for (const a of items) if (a?.id) listening.push({ id: a.id, source: 'followed' });
          after = data?.artists?.cursors?.after || null;
          guard += 1;
        } while (after && guard < 20);

        const matches = matchSuggestions(sets, listening);

        // Fallback flag: are there any lineup artists WITHOUT a stored Spotify
        // ID that we could only match by name? We surface the flag so the client
        // can decide whether to offer a name-based confirm. (We do not do extra
        // per-name search calls here to stay within rate limits.)
        let unmatchedFallback = false;
        for (const s of sets) {
          for (const a of s.artists) {
            if (!extractArtistId(a?.links?.spotify) && cleanArtistName(a?.name)) {
              unmatchedFallback = true;
              break;
            }
          }
          if (unmatchedFallback) break;
        }

        const payload = { suggestions: matches, unmatchedFallback, total: matches.length };
        setCachedSuggest(cacheKey, payload);
        return sendSuccess(res, payload);
      } catch (err: any) {
        log.error('spotify suggestions failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
        return sendError(res, 502, 'Failed to fetch Spotify suggestions', ErrorCodes.SERVICE_UNAVAILABLE);
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // POST /spotify/playlist/:festivalId — build a playlist from the user's picks.
  // Resolves each picked artist's Spotify ID → top tracks (bounded concurrency,
  // dedupe) → create playlist → add tracks (≤100/req). Returns the playlist URL.
  // ════════════════════════════════════════════════════════════════════════
  router.post(
    '/spotify/playlist/:festivalId',
    userAuth,
    rateLimit(6, 'spotify-playlist'),
    validateParams(schemas.festivalIdParams),
    async (req: any, res: any) => {
      if (!isConfigured()) return notConfigured(res);
      try {
        const { festivalId } = req.validatedParams;
        const userId = req.user.userId;

        const token = await getUserAccessToken(userId);
        if (!token) return sendError(res, 409, 'Spotify is not connected', ErrorCodes.FORBIDDEN);

        // The user's picked set IDs for this festival.
        const picksResult = await stores.pool.query(
          `
  SELECT
    p.set_id AS "setId",
    p.priority
  FROM
    festival_profile_picks p
    JOIN festival_profiles fp ON fp.id = p.profile_id
  WHERE
    fp.festival_id = $1
    AND fp.user_id = $2
    AND fp.deleted_at IS NULL
`,
          [festivalId, userId],
        );
        const pickedSetIds = new Set(picksResult.rows.map((r: any) => r.setId));
        if (!pickedSetIds.size) {
          return sendError(res, 400, 'You have no picks for this festival yet', ErrorCodes.INVALID_INPUT);
        }

        // Resolve picked sets → distinct Spotify artist IDs.
        const setsResult = await stores.pool.query(
          `
  SELECT
    fs.id,
    fs.artists
  FROM
    festival_sets fs
    JOIN festivals f ON fs.festival_id = f.id
    AND f.deleted_at IS NULL
  WHERE
    fs.festival_id = $1
`,
          [festivalId],
        );
        const fest = await stores.pool.query('SELECT name FROM festivals WHERE id = $1 AND deleted_at IS NULL', [
          festivalId,
        ]);
        const festivalName = fest.rows[0]?.name || 'Festival';

        const artistIds = new Set<string>();
        for (const row of setsResult.rows) {
          if (!pickedSetIds.has(row.id)) continue;
          const artists = Array.isArray(row.artists) ? row.artists : [];
          for (const a of artists) {
            const id = extractArtistId(a?.links?.spotify);
            if (id) artistIds.add(id);
          }
        }
        if (!artistIds.size) {
          return sendError(res, 400, 'None of your picks have a Spotify artist linked yet', ErrorCodes.INVALID_INPUT);
        }

        // Bounded-concurrency top-tracks fetch (mirrors bulkSearchArtists).
        const ids = [...artistIds];
        const trackUris = new Set<string>();
        let cursor = 0;
        const CONCURRENCY = 6;
        async function worker() {
          while (cursor < ids.length) {
            const id = ids[cursor++];
            try {
              const data = await spotifyGet(token!, `/artists/${id}/top-tracks?market=US`);
              const tracks = data?.tracks || [];
              for (const t of tracks) if (t?.uri) trackUris.add(t.uri);
            } catch (e: any) {
              log.warn('spotify top-tracks failed', { artistId: id, error: e.message });
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

        if (!trackUris.size) {
          return sendError(res, 502, 'Could not fetch any tracks from Spotify', ErrorCodes.SERVICE_UNAVAILABLE);
        }

        // Resolve the Spotify user (needed for playlist creation endpoint).
        const me = await spotifyGet(token, '/me');
        const spotifyUserId = me?.id;
        if (!spotifyUserId) {
          return sendError(res, 502, 'Could not resolve Spotify account', ErrorCodes.SERVICE_UNAVAILABLE);
        }

        const playlistName = `${festivalName} — my picks (Festie)`;
        const createResp = await fetch(`${SPOTIFY_API_BASE}/users/${encodeURIComponent(spotifyUserId)}/playlists`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: playlistName,
            public: false,
            description: `Top tracks from your ${festivalName} picks, built by Festie.`,
          }),
        });
        if (!createResp.ok) {
          return sendError(res, 502, 'Failed to create the Spotify playlist', ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const playlist: any = await createResp.json();
        const playlistId = playlist?.id;
        const playlistUrl = playlist?.external_urls?.spotify || null;

        // Add tracks in batches of ≤100.
        const uris = [...trackUris];
        for (let i = 0; i < uris.length; i += 100) {
          const batch = uris.slice(i, i + 100);
          const addResp = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: batch }),
          });
          if (!addResp.ok) {
            log.warn('spotify add-tracks batch failed', { playlistId, batchStart: i, status: addResp.status });
          }
        }

        return sendSuccess(res, {
          playlistId,
          playlistUrl,
          trackCount: uris.length,
          artistCount: artistIds.size,
        });
      } catch (err: any) {
        log.error('spotify playlist build failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
        return sendError(res, 502, 'Failed to build the Spotify playlist', ErrorCodes.SERVICE_UNAVAILABLE);
      }
    },
  );

  return router;
}
