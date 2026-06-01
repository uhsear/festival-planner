/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Spotify Web API client — Client Credentials flow
 * Used during admin lineup import to auto-populate artist link URLs.
 * No user OAuth required.
 */

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Get a Client Credentials access token (cached, auto-refreshes)
 */
async function getToken(clientId: any, clientSecret: any) {
  if (cachedToken && Date.now() < tokenExpiry - 30_000) return cachedToken;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Spotify token request failed (${resp.status}): ${body}`);
  }

  const data: any = await resp.json();
  // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
  cachedToken = data.access_token;
  // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Strip booking-noise from an artist name so it matches a Spotify profile:
 * "(DJ Set)", "(Live)", "(VIP)", trailing "- Live"/"VIP" style suffixes.
 * Exported so the lineup import / backfill normalize names consistently.
 */
function cleanArtistName(name: any) {
  if (!name) return '';
  return String(name)
    .replace(/\((?:dj\s*set|live|vip|acoustic|sunset set)\)/gi, '')
    .replace(/\s*[-–]\s*(?:live|dj set|vip|acoustic)\b.*$/gi, '')
    .replace(/\bVIP\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick the best artist from a Spotify search response: prefer an exact
 * (case-insensitive) name match, then the highest follower count. This avoids
 * the classic "first result is a more-popular unrelated same-name act" bug.
 */
function pickArtist(data: any, cleanedName: any) {
  const items = data?.artists?.items || [];
  if (!items.length) return null;
  const target = String(cleanedName || '').toLowerCase();
  const score = (a: any) => a?.followers?.total ?? a?.popularity ?? 0;
  const exact = items.filter((a: any) => (a?.name || '').toLowerCase() === target);
  const pool = exact.length ? exact : items;
  const artist = [...pool].sort((a: any, b: any) => score(b) - score(a))[0];
  if (!artist) return null;
  return {
    spotifyUrl: artist.external_urls?.spotify || null,
    spotifyId: artist.id,
    imageUrl: artist.images?.[0]?.url || null,
    genres: (artist.genres || []).slice(0, 5), // top 5 genres
  };
}

/**
 * Search Spotify for an artist by name. Cleans booking-noise from the name,
 * fetches several candidates, and returns the best match (exact name + most
 * followers) rather than blindly taking the first result.
 * Returns { spotifyUrl, spotifyId, imageUrl, genres } or null if no match.
 */
async function searchArtist(name: any, clientId: any, clientSecret: any) {
  if (!name || !clientId || !clientSecret) return null;

  const cleaned = cleanArtistName(name) || String(name).trim();
  if (!cleaned) return null;
  const query = encodeURIComponent(cleaned);
  const url = `${SPOTIFY_API_BASE}/search?q=${query}&type=artist&limit=8`;

  const token = await getToken(clientId, clientSecret);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (resp.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    const freshToken = await getToken(clientId, clientSecret);
    const retry = await fetch(url, { headers: { Authorization: `Bearer ${freshToken}` } });
    if (!retry.ok) return null;
    return pickArtist(await retry.json(), cleaned);
  }

  if (!resp.ok) return null;
  return pickArtist(await resp.json(), cleaned);
}

/**
 * Bulk search multiple artist names with a bounded concurrency pool (keeps a
 * large lineup well under request timeouts while staying gentle on the API).
 * Returns Map<artistName, { spotifyUrl, spotifyId, imageUrl, genres }>
 */
async function bulkSearchArtists(names: any, clientId: any, clientSecret: any, { concurrency = 6, log }: any = {}) {
  const results = new Map();
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (!uniqueNames.length) return results;

  // Prime the token once so the concurrent workers don't all race to fetch it.
  // Swallow failures here — each worker surfaces its own error below.
  try {
    await getToken(clientId, clientSecret);
  } catch {
    /* workers will report per-name */
  }

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueNames.length) {
      const name = uniqueNames[cursor++];
      try {
        const result = await searchArtist(name, clientId, clientSecret);
        if (result) results.set(name, result);
      } catch (err: any) {
        if (log) log.warn('spotify search failed for artist', { artist: name, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueNames.length) }, worker));
  return results;
}

export { searchArtist, bulkSearchArtists, getToken, cleanArtistName };
