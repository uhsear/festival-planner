/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Spotify Web API — Authorization Code + PKCE (user OAuth) helpers. (M4)
 *
 * Sibling to lib/spotify.ts (which is client-credentials only). This module is
 * for USER-scoped access: top artists, following, and playlist creation.
 *
 * Flow:
 *   1. buildAuthorizeUrl()  → server redirects the user to Spotify with a PKCE
 *      challenge + opaque `state`; the verifier is stored server-side.
 *   2. exchangeCodeForTokens() → trade the returned code + verifier for an
 *      access token + refresh token.
 *   3. refreshAccessToken() → mint a fresh access token from the stored refresh
 *      token (refresh tokens may be rotated by Spotify — caller persists the new
 *      one when present).
 *
 * The web confidential client also sends SPOTIFY_CLIENT_SECRET (Basic auth) on
 * the token endpoint; mobile uses pure PKCE with no secret. Both paths still
 * send the PKCE verifier, so the secret is defense-in-depth on web, not the
 * sole credential. The secret NEVER leaves the server.
 */

import crypto from 'crypto';

export const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';
const SPOTIFY_AUTHORIZE_URL = `${SPOTIFY_ACCOUNTS_BASE}/authorize`;
const SPOTIFY_TOKEN_URL = `${SPOTIFY_ACCOUNTS_BASE}/api/token`;

/**
 * All scopes requested together at connect time (single consent screen):
 *  - user-top-read         → /me/top/artists (suggestions)
 *  - user-follow-read      → /me/following?type=artist (suggestions)
 *  - playlist-modify-public / playlist-modify-private → create playlist from picks
 */
export const SPOTIFY_SCOPES = 'user-top-read user-follow-read playlist-modify-public playlist-modify-private';

/** base64url (no padding) — required encoding for the PKCE challenge. */
function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a PKCE code_verifier — a high-entropy URL-safe string (43–128 chars
 * per RFC 7636). 32 random bytes → 43 base64url chars.
 */
export function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

/**
 * Derive the PKCE code_challenge from a verifier using S256:
 * base64url(SHA256(verifier)).
 */
export function deriveCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

/** A cryptographically random opaque `state` value for CSRF protection. */
export function generateState(): string {
  return base64UrlEncode(crypto.randomBytes(24));
}

/**
 * Build the Spotify authorize URL the user is redirected to. The caller must
 * persist `{ verifier, state }` server-side (keyed to the session/state) so the
 * callback can complete the exchange.
 */
export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  codeChallenge,
  state,
  scopes = SPOTIFY_SCOPES,
  showDialog = false,
}: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string;
  showDialog?: boolean;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    scope: scopes,
  });
  if (showDialog) params.set('show_dialog', 'true');
  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

export interface SpotifyTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
  tokenType: string;
}

function buildTokenHeaders(clientId: string, clientSecret?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  // Web confidential client: HTTP Basic with the secret. Mobile (pure PKCE):
  // no secret — client_id is sent in the body instead.
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }
  return headers;
}

function normalizeTokenResponse(data: any): SpotifyTokenResponse {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
    scope: data.scope ?? null,
    tokenType: data.token_type ?? 'Bearer',
  };
}

/**
 * Exchange an authorization code (+ PKCE verifier) for tokens.
 * Throws on a non-OK response (message is safe to log — never contains tokens).
 */
export async function exchangeCodeForTokens({
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
  fetchImpl = fetch,
}: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const resp = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: buildTokenHeaders(clientId, clientSecret),
    body: body.toString(),
  });

  if (!resp.ok) {
    // Spotify returns { error, error_description } — these describe the FAILURE,
    // never the user's tokens, so they are safe to surface for diagnosis.
    let detail = '';
    try {
      const err: any = await resp.json();
      detail = err?.error_description || err?.error || '';
    } catch {
      /* non-JSON body */
    }
    throw new Error(`Spotify code exchange failed (${resp.status})${detail ? `: ${detail}` : ''}`);
  }

  return normalizeTokenResponse(await resp.json());
}

// ════════════════════════════════════════════════════════════════════════════
// Suggestion join logic (pure — no DB, no network; unit-testable)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract a bare Spotify artist ID from a stored link. The lineup stores either
 * a full URL (`https://open.spotify.com/artist/<id>`) or, occasionally, a bare
 * ID. Returns the 22-char base62-ish ID or null.
 */
export function extractArtistId(link: string | null | undefined): string | null {
  if (!link || typeof link !== 'string') return null;
  const urlMatch = link.match(/\/artist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1] ?? null;
  // Bare ID fallback (Spotify IDs are base62, 22 chars in practice).
  if (/^[a-zA-Z0-9]{16,40}$/.test(link)) return link;
  return null;
}

/** A festival set as needed for the suggestion join. */
export interface SuggestionSet {
  id: string;
  artists: Array<{ name?: string | null; links?: { spotify?: string | null } | null }>;
}

/** A user's listening signal: an artist ID with a relevance rank. */
export interface ListeningArtist {
  id: string;
  /** Affinity source — top short/medium/long term, or followed. */
  source: 'top_short' | 'top_medium' | 'top_long' | 'followed';
  /** 0-based rank within /me/top (lower = stronger); followed has no rank. */
  rank?: number;
}

export interface SuggestionMatch {
  setId: string;
  artistName: string | null;
  spotifyArtistId: string;
  /** Why this set was suggested (sources that contributed). */
  reasons: string[];
  /** Default suggested pick priority: must | want | maybe. */
  suggestedPriority: 'must' | 'want' | 'maybe';
}

/**
 * Map a listening signal to a default suggested priority. Strong/top-ranked
 * affinity ⇒ "must"; mid ⇒ "want"; weak / followed-only ⇒ "maybe".
 */
function priorityForArtist(signals: ListeningArtist[]): 'must' | 'want' | 'maybe' {
  let best = Infinity;
  let followedOnly = true;
  for (const s of signals) {
    if (s.source !== 'followed') {
      followedOnly = false;
      if (typeof s.rank === 'number' && s.rank < best) best = s.rank;
    }
  }
  if (followedOnly) return 'maybe';
  if (best <= 9) return 'must'; // top 10 of any term
  if (best <= 29) return 'want'; // top 30
  return 'maybe';
}

/**
 * Join the festival lineup against the user's listening signals by Spotify
 * artist ID. Pure function — the route fetches sets + the /me data, this does
 * the matching. Returns one match per festival set that contains a matched
 * artist, with a default suggested priority.
 */
export function matchSuggestions(sets: SuggestionSet[], listening: ListeningArtist[]): SuggestionMatch[] {
  // Index listening artists by ID → all their signals.
  const byArtist = new Map<string, ListeningArtist[]>();
  for (const l of listening) {
    if (!l?.id) continue;
    const arr = byArtist.get(l.id);
    if (arr) arr.push(l);
    else byArtist.set(l.id, [l]);
  }

  const matches: SuggestionMatch[] = [];
  for (const set of sets || []) {
    if (!set?.id || !Array.isArray(set.artists)) continue;
    let matchedId: string | null = null;
    let matchedName: string | null = null;
    let signals: ListeningArtist[] | undefined;

    for (const a of set.artists) {
      const id = extractArtistId(a?.links?.spotify);
      if (id && byArtist.has(id)) {
        matchedId = id;
        matchedName = a?.name ?? null;
        signals = byArtist.get(id);
        break; // first matched artist on the set wins
      }
    }

    if (!matchedId || !signals) continue;
    const reasons = [...new Set(signals.map((s) => s.source))];
    matches.push({
      setId: set.id,
      artistName: matchedName,
      spotifyArtistId: matchedId,
      reasons,
      suggestedPriority: priorityForArtist(signals),
    });
  }
  return matches;
}

/**
 * Mint a fresh access token from a refresh token. Spotify MAY return a rotated
 * refresh token; when it does, the caller should persist the new one.
 */
export async function refreshAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch,
}: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const resp = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: buildTokenHeaders(clientId, clientSecret),
    body: body.toString(),
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const err: any = await resp.json();
      detail = err?.error_description || err?.error || '';
    } catch {
      /* non-JSON body */
    }
    throw new Error(`Spotify token refresh failed (${resp.status})${detail ? `: ${detail}` : ''}`);
  }

  return normalizeTokenResponse(await resp.json());
}
