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
import crypto from 'crypto';
import { createPasswordResetRateLimit } from '../lib/rate-limiting.js';
import { parsePageParams, paginateArray } from '../lib/pagination.js';
import mountAdminUserRoutes from './admin-users.js';
import mountAdminAuditRoutes from './admin-audit.js';
import mountAdminBulkRoutes from './admin-bulk.js';
import * as spotify from '../lib/spotify.js';
import type { Router } from 'express';

export default function createAdminRoutes(deps: any): Router {
  const {
    express,
    config,
    log,
    getUsers,
    getProfiles,
    getFestivals,
    setNoStore,
    sendSuccess,
    sendError,
    ErrorCodes,
    adminAuth,
    getRequestIp,
    io,
    stores,
    _invalidateFestivalCache,
    rateLimit,
  } = deps;

  const router = express.Router();
  const adminWriteLimit = rateLimit(config.ADMIN_WRITE_RATE_LIMIT_MAX, 'admin-write');
  const passwordResetRateLimit = createPasswordResetRateLimit(config, {
    log,
    sendError,
    ErrorCodes,
    redis: deps.redis,
  });

  // Audit action name normalization map
  const ACTION_FRIENDLY_MAP: Record<string, string> = {
    admin_delete_user: 'Delete User',
    admin_reset_link: 'Reset Password Link',
    admin_reset_password: 'Reset Password',
    role_grant: 'Grant Role',
    role_revoke: 'Revoke Role',
    bulk_deactivate: 'Bulk Deactivate',
    bulk_archive: 'Bulk Archive Festivals',
    'create:token': 'Create Token',
    'create:verify': 'Verify Email',
    register: 'User Registered',
    login: 'User Logged In',
    festival_create: 'Festival Created',
    festival_update: 'Festival Updated',
    festival_delete: 'Festival Deleted',
    'delete:users': 'Delete User',
  };

  const getFriendlyAction = (action: string) => ACTION_FRIENDLY_MAP[action] || action;

  // Collapse consecutive audit entries with same action+actorId within 5-minute window
  const groupAuditActivity = (entries: any[]) => {
    if (!entries || entries.length === 0) return [];
    const grouped: any[] = [];
    let current: any = null;

    for (const entry of entries) {
      if (
        current &&
        current.action === entry.action &&
        current.actorId === entry.actorId &&
        new Date(entry.createdAt).getTime() - new Date(current.createdAt).getTime() < 5 * 60 * 1000
      ) {
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
  router.get('/dashboard', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const mem = process.memoryUsage();
      const pgPool = stores.pool;
      const poolStats = pgPool
        ? {
            totalCount: pgPool.totalCount,
            idleCount: pgPool.idleCount,
            waitingCount: pgPool.waitingCount,
          }
        : null;

      const [users, festivals, profiles, recentActivity] = await Promise.all([
        getUsers(),
        getFestivals(),
        getProfiles(),
        stores.auditLog.query({ limit: 20 }).then(({ rows }: any) => rows),
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
      const enrichedActivity = recentActivity.map((a: any) => ({
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
      const groupedActivity = groupAuditActivity(
        enrichedActivity.map((a: any) => ({
          ...a,
          count: 1,
        })),
      );

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
    } catch (error: any) {
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
  mountAdminUserRoutes({ router, deps, ctx }); // /users, /users/:id/*
  mountAdminAuditRoutes({ router, deps, ctx }); // /audit
  mountAdminBulkRoutes({ router, deps, ctx }); // /bulk/*, /crews*

  // ── POST /festivals/:id/backfill-spotify — auto-populate link_url via Spotify ──
  // Preserves Agent E's SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET config reads.
  router.post('/festivals/:id/backfill-spotify', adminAuth, adminWriteLimit, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const spotifyClientId = config.SPOTIFY_CLIENT_ID;
      const spotifyClientSecret = config.SPOTIFY_CLIENT_SECRET;
      if (!spotifyClientId || !spotifyClientSecret) {
        return sendError(res, 400, 'Spotify API credentials not configured', ErrorCodes.INVALID_INPUT);
      }

      const festivalId = req.params.id;
      const festival = await stores.pool.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL', [
        festivalId,
      ]);
      if (festival.rows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Optional body: verified overrides (artistName -> spotifyUrl) take
      // precedence over search; `force` re-links sets that already have a link.
      const body = req.body || {};
      const force = body.force === true;
      const skipSearch = body.skipSearch === true; // overrides-only, no Spotify calls
      const normName = (s: any) =>
        spotify
          .cleanArtistName(s)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
      const overrideMap = new Map<string, string>();
      if (body.overrides && typeof body.overrides === 'object') {
        for (const [k, v] of Object.entries(body.overrides)) {
          if (typeof v === 'string' && v) overrideMap.set(normName(k), v);
        }
      }
      // "Artist A B2B Artist B" sets carry one combined name; split so each
      // sub-artist can be linked individually.
      const splitB2B = (name: any) =>
        String(name || '')
          .split(/\s+b2b\s+/i)
          .map((s) => s.trim())
          .filter(Boolean);

      const { rows: sets } = await stores.pool.query(
        force
          ? 'SELECT id, artist, artists FROM festival_sets WHERE festival_id = $1'
          : "SELECT id, artist, artists FROM festival_sets WHERE festival_id = $1 AND (link_url IS NULL OR link_url = '')",
        [festivalId],
      );
      if (sets.length === 0) return sendSuccess(res, { updated: 0, skipped: 0, message: 'No sets to backfill' });

      // Collect cleaned sub-artist names that need a search (skip overridden).
      const searchNames = new Set<string>();
      if (!skipSearch) {
        for (const set of sets) {
          const arr = set.artists?.length ? set.artists : [{ name: set.artist }];
          for (const a of arr) {
            for (const part of splitB2B(a?.name)) {
              if (overrideMap.has(normName(part))) continue;
              const cleaned = spotify.cleanArtistName(part) || part;
              if (cleaned) searchNames.add(cleaned);
            }
          }
        }
      }
      const spotifyResults: Map<string, any> = searchNames.size
        ? await spotify.bulkSearchArtists([...searchNames], spotifyClientId, spotifyClientSecret, { log })
        : new Map();

      const resolve = (rawName: any) => {
        const ov = overrideMap.get(normName(rawName));
        if (ov) return { spotifyUrl: ov };
        return spotifyResults.get(spotify.cleanArtistName(rawName) || rawName) || null;
      };

      let updated = 0;
      for (const set of sets) {
        const arr = set.artists?.length ? set.artists : [{ name: set.artist }];
        const newArtists: any[] = [];
        let changed = false;
        for (const a of arr) {
          const parts = splitB2B(a?.name);
          if (parts.length > 1) {
            // B2B → one entry per sub-artist, each with its own link
            for (const part of parts) {
              const m = resolve(part);
              const entry: any = { name: spotify.cleanArtistName(part) || part, links: {} };
              if (m?.spotifyUrl) {
                entry.links.spotify = m.spotifyUrl;
                changed = true;
              }
              if (m?.imageUrl) entry.photo = m.imageUrl;
              if (m?.genres?.length) entry.genres = m.genres;
              newArtists.push(entry);
            }
          } else {
            const m = resolve(a?.name);
            const entry: any = { ...a, links: { ...(a?.links || {}) } };
            if (m?.spotifyUrl && (force || !entry.links.spotify)) {
              entry.links.spotify = m.spotifyUrl;
              changed = true;
            }
            if (m?.imageUrl && !entry.photo) entry.photo = m.imageUrl;
            if (m?.genres?.length && !entry.genres?.length) entry.genres = m.genres;
            newArtists.push(entry);
          }
        }
        if (changed) {
          const firstSpotify = newArtists.find((x) => x.links?.spotify)?.links.spotify || null;
          await stores.pool.query(
            'UPDATE festival_sets SET artists = $1, link_url = COALESCE($2, link_url) WHERE id = $3',
            [JSON.stringify(newArtists), firstSpotify, set.id],
          );
          updated++;
        }
      }

      // Bump the festival timestamp so the list/detail cache (keyed on
      // updated_at) actually invalidates — set updates alone don't change it.
      if (updated > 0) {
        await stores.pool.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);
      }
      if (_invalidateFestivalCache) _invalidateFestivalCache();
      log.info('spotify backfill complete', {
        festivalId,
        updated,
        skipped: sets.length - updated,
        ip: getRequestIp(req),
      });
      return sendSuccess(res, { updated, skipped: sets.length - updated, total: sets.length });
    } catch (error: any) {
      log.error('spotify backfill failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Spotify backfill failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
