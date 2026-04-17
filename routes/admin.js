// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
//
// AUDIT FIX (2026-04-14, DEFERRED FIX AGENT 1):
//   Added per-email password-reset limiter (`passwordResetRateLimit`) to
//   `/users/:id/reset-link` alongside the existing `adminWriteLimit`. Preserves
//   Agent E's earlier edits:
//     - PUBLIC_ORIGIN throw on /users/:id/reset-link (lines guarded below)
//     - SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET config reads on
//       /festivals/:id/backfill-spotify
//
// AUDIT FIX (2026-04-14, DEFERRED FIX AGENT 6):
//   Split 716-line file into four modules. This file now owns the dashboard +
//   Spotify-backfill routes and delegates user/role, audit, and bulk/crew
//   moderation routes to sibling modules. Factory signature, deps contract,
//   and resulting router shape are byte-identical to the pre-split version.
//
//   Sub-routers mounted here (in original declaration order):
//     ./admin-users.js   → /users, /users/:id/roles, /users/:id/reset-link,
//                          /users/:id/reset-password, /users/:id
//     ./admin-audit.js   → /audit
//     ./admin-bulk.js    → /bulk/*, /crews, /crews/:id(/members(/:userId)?)?
//
//   Agent 1's passwordResetRateLimit is constructed here and passed via `ctx`
//   so admin-users.js can attach it to the reset routes.
const { createPasswordResetRateLimit } = require('../lib/rate-limiting');
const mountAdminUserRoutes = require('./admin-users');
const mountAdminAuditRoutes = require('./admin-audit');
const mountAdminBulkRoutes = require('./admin-bulk');

module.exports = function createAdminRoutes(deps) {
  const {
    express, config, log,
    // eslint-disable-next-line no-unused-vars
    resolveRequestToken, validatePasswordStrength, hashPassword,
    getUsers, getProfiles, getUserById, getFestivals,
    invalidateUserSessions, disconnectUserSockets,
    removeAvatarFile, removeProfileSockets,
    setNoStore,
    sendSuccess, sendError, ErrorCodes,
    adminAuth, getRequestIp, buildAvatarUrl,
    // eslint-disable-next-line no-unused-vars
    io, stores, hashSessionToken,
    schemas, validate,
    createAuditLog, invalidateUserCache, _invalidateFestivalCache,
    rateLimit,
  } = deps;

  const router = express.Router();
  const adminWriteLimit = rateLimit(config.ADMIN_WRITE_RATE_LIMIT_MAX, 'admin-write');
  const passwordResetRateLimit = createPasswordResetRateLimit(config, {
    log,
    sendError,
    ErrorCodes,
  });
  const crypto = require('crypto');
  const { parsePageParams, paginateArray } = require('../lib/pagination');

  // Audit action name normalization map
  const ACTION_FRIENDLY_MAP = {
    'admin_delete_user': 'Delete User',
    'admin_reset_link': 'Reset Password Link',
    'admin_reset_password': 'Reset Password',
    'role_grant': 'Grant Role',
    'role_revoke': 'Revoke Role',
    'bulk_deactivate': 'Bulk Deactivate',
    'bulk_archive': 'Bulk Archive Festivals',
    'create:token': 'Create Token',
    'create:verify': 'Verify Email',
    'register': 'User Registered',
    'login': 'User Logged In',
    'festival_create': 'Festival Created',
    'festival_update': 'Festival Updated',
    'festival_delete': 'Festival Deleted',
    'delete:users': 'Delete User',
  };

  const getFriendlyAction = (action) => ACTION_FRIENDLY_MAP[action] || action;

  // Collapse consecutive audit entries with same action+actorId within 5-minute window
  const groupAuditActivity = (entries) => {
    if (!entries || entries.length === 0) return [];
    const grouped = [];
    let current = null;

    for (const entry of entries) {
      if (current &&
          current.action === entry.action &&
          current.actorId === entry.actorId &&
          (new Date(entry.createdAt).getTime() - new Date(current.createdAt).getTime()) < 5 * 60 * 1000) {
        current.count = (current.count || 1) + 1;
        current.createdAt = entry.createdAt; // Update to most recent
      } else {
        if (current) grouped.push(current);
        current = { ...entry, count: 1 };
      }
    }
    if (current) grouped.push(current);
    return grouped;
  };

  // POST /login, /verify, /logout removed — admin auth is role-based via user session (v2.1)

  // ── GET /dashboard — aggregated stats for admin dashboard ────────────
  router.get('/dashboard', adminAuth, async (req, res) => {
    try {
      setNoStore(res);
      const mem = process.memoryUsage();
      const pgPool = stores.pool;
      const poolStats = pgPool ? {
        totalCount: pgPool.totalCount,
        idleCount: pgPool.idleCount,
        waitingCount: pgPool.waitingCount,
      } : null;

      const [users, festivals, profiles, recentActivity] = await Promise.all([
        getUsers(),
        getFestivals(),
        getProfiles(),
        stores.auditLog.query({ limit: 20 }),
      ]);

      // Build username map from users for activity resolution
      const userMap = new Map();
      for (const user of users) {
        userMap.set(user.id, user.username);
      }

      // Count total picks across all profiles
      let totalPicks = 0;
      for (const profile of profiles) {
        totalPicks += Object.keys(profile.picks || {}).length;
      }

      // Resolve actorId to username and add friendlyAction for each activity entry
      const enrichedActivity = recentActivity.map(a => ({
        id: a.id,
        action: a.action,
        friendlyAction: getFriendlyAction(a.action),
        actorType: a.actorType,
        actorId: a.actorId,
        actorUsername: userMap.get(a.actorId) || a.actorId,
        targetType: a.targetType,
        targetId: a.targetId,
        details: a.details,
        createdAt: a.createdAt,
      }));

      // Group activity for frontend aggregation support
      const groupedActivity = groupAuditActivity(enrichedActivity.map(a => ({
        ...a,
        count: 1,
      })));

      return sendSuccess(res, {
        stats: {
          users: users.length,
          festivals: festivals.length,
          profiles: profiles.length,
          picks: totalPicks,
        },
        health: {
          uptime: Math.round(process.uptime()),
          memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          },
          database: poolStats,
          connections: io.engine?.clientsCount || 0,
          onlineRooms: deps.state.onlineUsers.size,
        },
        recentActivity: enrichedActivity,
        groupedActivity,
      });
    } catch (error) {
      log.error('admin dashboard load failed', { error: error.message });
      return sendError(res, 500, 'Failed to load dashboard', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Mount sibling route modules in original declaration order.
  // Declaration order matters only because Express matches in the order
  // registered — all paths here are unique so order-reshuffling within a
  // single router is safe, but we preserve the original order to make diffs
  // trivial to audit.
  const ctx = { adminWriteLimit, passwordResetRateLimit, crypto, parsePageParams, paginateArray };
  mountAdminUserRoutes({ router, deps, ctx });  // /users, /users/:id/*
  mountAdminAuditRoutes({ router, deps, ctx }); // /audit
  mountAdminBulkRoutes({ router, deps, ctx });  // /bulk/*, /crews*

  // ── POST /festivals/:id/backfill-spotify — auto-populate link_url via Spotify ──
  // Preserves Agent E's SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET config reads.
  router.post('/festivals/:id/backfill-spotify', adminAuth, adminWriteLimit, async (req, res) => {
    try {
      setNoStore(res);
      const spotifyClientId = config.SPOTIFY_CLIENT_ID;
      const spotifyClientSecret = config.SPOTIFY_CLIENT_SECRET;
      if (!spotifyClientId || !spotifyClientSecret) {
        return sendError(res, 400, 'Spotify API credentials not configured', ErrorCodes.INVALID_INPUT);
      }

      const festivalId = req.params.id;
      const festival = await stores.pool.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
      if (festival.rows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Find sets without link_url
      const { rows: sets } = await stores.pool.query(
        'SELECT id, artist, artists FROM festival_sets WHERE festival_id = $1 AND (link_url IS NULL OR link_url = \'\')',
        [festivalId]
      );

      if (sets.length === 0) return sendSuccess(res, { updated: 0, skipped: 0, message: 'All sets already have links' });

      const spotify = require('../lib/spotify');
      // Collect all unique artist names from the artists array for bulk lookup
      const allArtistNames = [];
      for (const set of sets) {
        const artists = set.artists || [];
        if (artists.length > 0) {
          artists.forEach((a) => { if (a.name) allArtistNames.push(a.name); });
        } else if (set.artist) {
          allArtistNames.push(set.artist);
        }
      }
      const uniqueNames = [...new Set(allArtistNames)];
      const spotifyResults = await spotify.bulkSearchArtists(uniqueNames, spotifyClientId, spotifyClientSecret, { log });

      let updated = 0;
      for (const set of sets) {
        const artists = set.artists || [];
        let setUpdated = false;
        if (artists.length > 0) {
          const updatedArtists = artists.map((a) => {
            const match = spotifyResults.get(a.name);
            if (match?.spotifyUrl && (!a.links || !a.links.spotify)) {
              setUpdated = true;
              const updatedArtist = { ...a, links: { ...a.links, spotify: match.spotifyUrl } };
              if (match.imageUrl && !a.photo) updatedArtist.photo = match.imageUrl;
              if (match.genres?.length && !a.genres?.length) updatedArtist.genres = match.genres;
              return updatedArtist;
            }
            return a;
          });
          if (setUpdated) {
            const firstSpotify = updatedArtists[0]?.links?.spotify || null;
            await stores.pool.query('UPDATE festival_sets SET artists = $1, link_url = COALESCE($2, link_url) WHERE id = $3', [JSON.stringify(updatedArtists), firstSpotify, set.id]);
            updated++;
          }
        } else {
          const match = spotifyResults.get(set.artist);
          if (match?.spotifyUrl) {
            const newArtist = { name: set.artist, links: { spotify: match.spotifyUrl } };
            if (match.imageUrl) newArtist.photo = match.imageUrl;
            if (match.genres?.length) newArtist.genres = match.genres;
            await stores.pool.query('UPDATE festival_sets SET link_url = $1, artists = $2 WHERE id = $3', [match.spotifyUrl, JSON.stringify([newArtist]), set.id]);
            updated++;
          }
        }
      }

      if (_invalidateFestivalCache) _invalidateFestivalCache();
      log.info('spotify backfill complete', { festivalId, updated, skipped: sets.length - updated, ip: getRequestIp(req) });
      return sendSuccess(res, { updated, skipped: sets.length - updated, total: sets.length });
    } catch (error) {
      log.error('spotify backfill failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Spotify backfill failed', ErrorCodes.INTERNAL_ERROR);
    }
  });


  return router;
};
