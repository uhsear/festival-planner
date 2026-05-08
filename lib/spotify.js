/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Spotify Web API client — Client Credentials flow
 * Used during admin lineup import to auto-populate artist link URLs.
 * No user OAuth required.
 */
'use strict';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get a Client Credentials access token (cached, auto-refreshes)
 */
async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry - 30_000) return cachedToken;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Spotify token request failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
  cachedToken = data.access_token;
  // eslint-disable-next-line require-atomic-updates -- module-level cache, not shared across requests
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Search Spotify for an artist by name.
 * Returns { spotifyUrl, spotifyId, imageUrl } or null if no match.
 */
async function searchArtist(name, clientId, clientSecret) {
  if (!name || !clientId || !clientSecret) return null;

  const token = await getToken(clientId, clientSecret);
  const query = encodeURIComponent(name.trim());
  const resp = await fetch(`${SPOTIFY_API_BASE}/search?q=${query}&type=artist&limit=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (resp.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    const freshToken = await getToken(clientId, clientSecret);
    const retry = await fetch(`${SPOTIFY_API_BASE}/search?q=${query}&type=artist&limit=1`, {
      headers: { 'Authorization': `Bearer ${freshToken}` },
    });
    if (!retry.ok) return null;
    const retryData = await retry.json();
    return extractArtist(retryData);
  }

  if (!resp.ok) return null;

  const data = await resp.json();
  return extractArtist(data);
}

/**
 * Extract best artist result from Spotify search response
 */
function extractArtist(data) {
  const artist = data?.artists?.items?.[0];
  if (!artist) return null;

  return {
    spotifyUrl: artist.external_urls?.spotify || null,
    spotifyId: artist.id,
    imageUrl: artist.images?.[0]?.url || null,
    genres: (artist.genres || []).slice(0, 5), // top 5 genres
  };
}

/**
 * Bulk search multiple artist names with rate-limit-safe staggering.
 * Returns Map<artistName, { spotifyUrl, spotifyId, imageUrl }>
 */
async function bulkSearchArtists(names, clientId, clientSecret, { delayMs = 50, log } = {}) {
  const results = new Map();
  const uniqueNames = [...new Set(names.filter(Boolean))];

  for (const name of uniqueNames) {
    try {
      const result = await searchArtist(name, clientId, clientSecret);
      if (result) results.set(name, result);
    } catch (err) {
      if (log) log.warn('spotify search failed for artist', { artist: name, error: err.message });
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return results;
}

module.exports = { searchArtist, bulkSearchArtists, getToken };
