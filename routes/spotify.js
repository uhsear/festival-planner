'use strict';

module.exports = function createSpotifyRoutes(deps) {
  const { express, config, log, rateLimit, sendSuccess, sendError, ErrorCodes } = deps;
  const router = express.Router();
  const { getToken } = require('../lib/spotify');

  // In-memory cache with TTL
  const previewCache = new Map();
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  const MAX_CACHE_SIZE = 500;

  function getCachedPreview(setId) {
    const entry = previewCache.get(setId);
    if (entry && Date.now() < entry.expiresAt) {
      return entry.data;
    }
    if (entry) previewCache.delete(setId);
    return null;
  }

  function setCachedPreview(setId, data) {
    if (previewCache.size >= MAX_CACHE_SIZE) {
      const firstKey = previewCache.keys().next().value;
      previewCache.delete(firstKey);
    }
    previewCache.set(setId, {
      data,
      expiresAt: Date.now() + CACHE_TTL,
    });
  }

  /**
   * GET /spotify/preview/:setId
   * Get Spotify embed data (artistId, trackId) for a set
   */
  // PUBLIC endpoint (no userAuth) so guests see the Spotify play button in set detail
  // 2026-04-14: userAuth was removed; traffic capped via per-IP rate limit (60/min). Response
  // is purely derived from public festival_sets.artists data — no user-scoped info leaks.
  router.get('/spotify/preview/:setId', rateLimit(60, 'spotify-preview'), async (req, res) => {
    try {
      const { setId } = req.params;
      const { pool } = deps.stores;

      // Check cache first
      const cached = getCachedPreview(setId);
      if (cached) return sendSuccess(res, cached);

      // Query set from database
      const result = await pool.query(
        'SELECT id, artists FROM festival_sets WHERE id = $1',
        [setId]
      );

      if (!result.rows.length) {
        return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
      }

      const set = result.rows[0];
      const artists = set.artists || [];

      if (!artists.length) {
        const response = { embedType: null };
        setCachedPreview(setId, response);
        return sendSuccess(res, response);
      }

      // Find first artist with a Spotify link (handles b2b and multi-artist sets)
      let artistId = null;
      let artistName = null;
      for (const a of artists) {
        const url = a.links?.spotify;
        if (!url) continue;
        const m = url.match(/\/artist\/([a-zA-Z0-9]+)/);
        if (m) { artistId = m[1]; artistName = a.name || 'Unknown'; break; }
      }
      if (!artistId) {
        const response = { embedType: null };
        setCachedPreview(setId, response);
        return sendSuccess(res, response);
      }
      const token = await getToken(config.SPOTIFY_CLIENT_ID, config.SPOTIFY_CLIENT_SECRET);

      // Get top tracks for artist
      const tracksRes = await fetch(
        'https://api.spotify.com/v1/artists/' + artistId + '/top-tracks?market=US',
        {
          headers: { 'Authorization': 'Bearer ' + token },
        }
      );

      if (!tracksRes.ok) {
        // Fallback to artist embed if top-tracks fails
        const response = {
          embedType: 'artist',
          artistId,
          artistName: artistName || artists[0]?.name || 'Unknown',
        };
        setCachedPreview(setId, response);
        return sendSuccess(res, response);
      }

      const tracksData = await tracksRes.json();
      const tracks = tracksData.tracks || [];

      // Use the first track for embed (most popular)
      if (tracks.length > 0) {
        const track = tracks[0];
        const response = {
          embedType: 'track',
          trackId: track.id,
          trackName: track.name,
          albumArt: track.album?.images?.[0]?.url || null,
          artistId,
          artistName: track.artists?.[0]?.name || artists[0].name || 'Unknown',
        };
        setCachedPreview(setId, response);
        return sendSuccess(res, response);
      }

      // No tracks — fall back to artist embed
      const response = {
        embedType: 'artist',
        artistId,
        artistName: artistName || artists[0]?.name || 'Unknown',
      };
      setCachedPreview(setId, response);
      sendSuccess(res, response);
    } catch (err) {
      log.error('spotify preview error', { error: err.message, setId: req.params.setId });
      sendError(res, 500, 'Failed to fetch preview', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};
