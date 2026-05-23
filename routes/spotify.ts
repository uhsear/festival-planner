import { Router } from 'express';
import { getToken } from '../lib/spotify.js';

export default function createSpotifyRoutes(deps: any) {
  const { config, log, rateLimit, sendSuccess, sendError, ErrorCodes } = deps;
  const router = Router();

  const previewCache = new Map();
  const CACHE_TTL = config.SPOTIFY_CACHE_TTL_MS;
  const MAX_CACHE_SIZE = config.SPOTIFY_CACHE_MAX;

  function getCachedPreview(setId: string) {
    const entry = previewCache.get(setId);
    if (entry && Date.now() < entry.expiresAt) return entry.data;
    if (entry) previewCache.delete(setId);
    return null;
  }

  function setCachedPreview(setId: string, data: any) {
    if (previewCache.size >= MAX_CACHE_SIZE) {
      previewCache.delete(previewCache.keys().next().value);
    }
    previewCache.set(setId, { data, expiresAt: Date.now() + CACHE_TTL });
  }

  function artistEmbed(artistId: string, artistName: string) {
    return {
      embedType: 'artist',
      artistId,
      artistName,
      embedUrl: 'https://open.spotify.com/embed/artist/' + artistId + '?utm_source=generator&theme=0',
    };
  }

  function trackEmbed(track: any, artistId: string, artistName: string) {
    return {
      embedType: 'track',
      trackId: track.id,
      trackName: track.name,
      albumArt: track.album?.images?.[0]?.url || null,
      artistId,
      artistName: track.artists?.[0]?.name || artistName,
      url: track.preview_url || null,
      embedUrl: 'https://open.spotify.com/embed/track/' + track.id + '?utm_source=generator&theme=0',
    };
  }

  // PUBLIC — no userAuth; rate-limited 60/min per IP.
  router.get('/spotify/preview/:setId', rateLimit(60, 'spotify-preview'), async (req: any, res: any) => {
    try {
      const { setId } = req.params;
      const { pool } = deps.stores;

      const cached = getCachedPreview(setId);
      if (cached) return sendSuccess(res, cached);

      const result = await pool.query(
        `
  SELECT
    fs.id,
    fs.artists
  FROM
    festival_sets fs
    JOIN festivals f ON fs.festival_id = f.id
    AND f.deleted_at IS NULL
  WHERE
    fs.id = $1
`, [setId]);
      if (!result.rows.length) return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);

      const artists = result.rows[0].artists || [];
      if (!artists.length) {
        const r = { embedType: null };
        setCachedPreview(setId, r);
        return sendSuccess(res, r);
      }

      // Find first artist with a Spotify link
      let artistId: string | null = null;
      let artistName: string | null = null;
      for (const a of artists) {
        const url = a.links?.spotify;
        if (!url) continue;
        const m = url.match(/\/artist\/([a-zA-Z0-9]+)/);
        if (m) { artistId = m[1]; artistName = a.name || 'Unknown'; break; }
      }
      if (!artistId) {
        const r = { embedType: null };
        setCachedPreview(setId, r);
        return sendSuccess(res, r);
      }

      const token = await getToken(config.SPOTIFY_CLIENT_ID, config.SPOTIFY_CLIENT_SECRET);

      // Search for tracks by artist — search API works with client credentials.
      // Prefer a track that has a preview_url (30-sec clip); fall back to first result.
      const searchRes = await fetch(
        'https://api.spotify.com/v1/search?q=artist%3A' + encodeURIComponent(artistName!) +
        '&type=track&market=US&limit=10',
        { headers: { 'Authorization': 'Bearer ' + token } }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const tracks = searchData.tracks?.items || [];
        // Filter to tracks actually by this artist (search can return loose matches)
        const byArtist = tracks.filter((t: any) =>
          t.artists?.some((a: any) => a.id === artistId || a.name?.toLowerCase() === artistName?.toLowerCase())
        );
        const pool2 = byArtist.length ? byArtist : tracks;
        const track = pool2.find((t: any) => t.preview_url) || pool2[0];
        if (track) {
          const r = trackEmbed(track, artistId, artistName!);
          setCachedPreview(setId, r);
          return sendSuccess(res, r);
        }
      }

      // Fallback: artist embed
      const r = artistEmbed(artistId, artistName!);
      setCachedPreview(setId, r);
      return sendSuccess(res, r);
    } catch (err: any) {
      log.error('spotify preview error', { error: err.message, setId: req.validatedParams?.setId });
      return sendError(res, 500, 'Failed to fetch preview', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
