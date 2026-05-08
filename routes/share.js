// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Shareable Pick Links — Public read-only profile view
 *
 * GET /s/:profileId — Renders an HTML page showing a user's picks for a festival.
 * No auth required. Profile must exist and have a non-null userId.
 *
 * The share URL is the profile ID itself (opaque, unguessable).
 * Profile IDs are generated via createOpaqueId('prof') — crypto random hex.
 */

module.exports = function createShareRoutes(deps) {
  const {
    express, log, config,
    stores, getFestivalById, getUserById,
    buildAvatarUrl, rateLimit,
    sendSuccess, sendError, ErrorCodes,
  } = deps;

  const router = express.Router();

  function sendShareError(res, status, title, message) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}.error-box{text-align:center;padding:40px 24px;max-width:400px}.error-icon{font-size:48px;margin-bottom:16px;opacity:.5}.error-title{font-size:20px;font-weight:700;margin-bottom:8px}.error-msg{font-size:14px;color:#888;margin-bottom:24px}.error-btn{display:inline-block;background:#ff3366;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px}.error-btn:hover{background:#e62e5c}</style></head><body><div class="error-box"><div class="error-icon">🎵</div><div class="error-title">${escapeHtml(title)}</div><div class="error-msg">${escapeHtml(message)}</div><a class="error-btn" href="${escapeHtml(config.PUBLIC_ORIGIN || '/')}">Go to Festie</a></div></body></html>`);
  }

  // GET /u/:username — vanity share URL (redirects to opaque profile ID)
  router.get('/u/:username', rateLimit(30, 'share'), async (req, res) => {
    try {
      const username = String(req.params.username || '').trim();
      // Sanitize username: lowercase, alphanumeric + underscore + hyphen, max 30 chars
      if (!username || username.length > 30 || !/^[a-z0-9_-]+$/.test(username.toLowerCase())) {
        return sendShareError(res, 400, 'Invalid Link', 'This share link is not valid.');
      }

      // Look up user by username (case-insensitive, targeted query)
      const user = await stores.users.getByUsername(username.toLowerCase());
      if (!user) {
        return sendShareError(res, 404, 'User Not Found', 'No account with this username exists.');
      }

      // Find their most recent profile (targeted query, not readAll)
      const { rows: profileRows } = await stores.pool.query(
        `SELECT id FROM festival_profiles
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      );
      if (profileRows.length === 0) {
        return sendShareError(res, 404, 'No Schedule Yet', 'This user hasn\'t joined a festival yet.');
      }
      const profile = profileRows[0];

      // Redirect to the opaque share link
      return res.redirect(302, `/s/${profile.id}`);
    } catch (error) {
      log.error('vanity share lookup failed', { error: error.message, username: req.params.username });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /s/:profileId — public share page (rate limited to prevent scraping)
  router.get('/:profileId', rateLimit(30, 'share'), async (req, res) => {
    try {
      const profileId = String(req.params.profileId || '').trim();
      if (!profileId || profileId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(profileId)) {
        return sendShareError(res, 400, 'Invalid Link', 'This share link is not valid.');
      }

      const profile = await stores.profiles.getById(profileId);
      if (!profile || !profile.userId) {
        return sendShareError(res, 404, 'Schedule Not Found', 'This schedule may have been removed or the link is incorrect.');
      }

      const festival = await getFestivalById(profile.festivalId);
      if (!festival) {
        return sendShareError(res, 404, 'Festival Not Found', 'The festival for this schedule no longer exists.');
      }

      const user = await getUserById(profile.userId);
      const username = escapeHtml(user?.username || profile.name || 'Anonymous');
      const avatarUrl = escapeHtml(buildAvatarUrl(user) || '');

      // Build pick data grouped by day
      const picks = profile.picks || {};
      const pickedSetIds = new Set(Object.keys(picks));
      const days = (festival.days || []).map((day, dayIndex) => {
        const daySets = (day.sets || [])
          .filter((set) => pickedSetIds.has(set.id))
          .map((set) => ({
            artist: escapeHtml(set.artist),
            stage: escapeHtml(getStageNameById(festival.stages, set.stageId)),
            stageColor: sanitizeColor(getStageColorById(festival.stages, set.stageId)),
            startTime: escapeHtml(set.startTime || ''),
            endTime: escapeHtml(set.endTime || ''),
            priority: picks[set.id] || 'want-to-see',
          }))
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return { label: escapeHtml(day.label || `Day ${dayIndex + 1}`), date: day.date || '', sets: daySets };
      }).filter((day) => day.sets.length > 0);

      const totalPicks = Object.keys(picks).length;
      const mustCount = Object.values(picks).filter((v) => v === 'must').length;
      const wantCount = Object.values(picks).filter((v) => v === 'want-to-see').length;
      const maybeCount = Object.values(picks).filter((v) => v === 'maybe').length;

      const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
      // Override Helmet CSP to allow inline styles for this self-contained HTML page
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; frame-ancestors 'none'");
      return res.send(renderSharePage({
        username,
        avatarUrl,
        festivalName: escapeHtml(festival.name),
        festivalLocation: escapeHtml(festival.location || ''),
        days,
        totalPicks,
        mustCount,
        wantCount,
        maybeCount,
        origin: escapeHtml(origin),
        profileId: escapeHtml(profileId),
      }));
    } catch (error) {
      log.error('share page error', { error: error.message, profileId: req.params.profileId });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // JSON API for share data (rate limited to prevent scraping)
  router.get('/:profileId/json', rateLimit(30, 'share-json'), async (req, res) => {
    try {
      const profileId = String(req.params.profileId || '').trim();
      if (!profileId || profileId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(profileId)) {
        return sendError(res, 400, 'Invalid share link', ErrorCodes.INVALID_INPUT);
      }

      const profile = await stores.profiles.getById(profileId);
      if (!profile || !profile.userId) {
        return sendError(res, 404, 'Schedule not found', ErrorCodes.NOT_FOUND);
      }

      const festival = await getFestivalById(profile.festivalId);
      if (!festival) {
        return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      }

      const user = await getUserById(profile.userId);
      const username = user?.username || profile.name || 'Anonymous';

      res.setHeader('Cache-Control', 'public, max-age=300');
      return sendSuccess(res, {
        username,
        festivalName: festival.name,
        festivalId: festival.id,
        picks: profile.picks || {},
        festival: {
          stages: festival.stages,
          days: festival.days,
        },
      });
    } catch (error) {
      log.error('share json error', { error: error.message, profileId: req.params.profileId });
      return sendError(res, 500, 'Failed to load schedule', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};

// ── Helpers ──────────────────────────────────────────────────────────

const { escapeHtml } = require('../lib/helpers/sanitize');

function getStageNameById(stages, stageId) {
  const stage = (stages || []).find((s) => s.id === stageId);
  return stage?.name || 'TBD';
}

function getStageColorById(stages, stageId) {
  const stage = (stages || []).find((s) => s.id === stageId);
  return stage?.color || '#666';
}

// Sanitize CSS color values to prevent style injection
function sanitizeColor(color) {
  if (!color) return '#666';
  // Only allow hex colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return '#666';
}

function priorityLabel(priority) {
  return { must: 'Must See', 'want-to-see': 'Want to See', maybe: 'Maybe' }[priority] || priority;
}

function priorityColor(priority) {
  return { must: '#ff3366', 'want-to-see': '#ffaa00', maybe: '#888' }[priority] || '#888';
}

function renderSharePage({ username, avatarUrl, festivalName, festivalLocation, days, totalPicks, mustCount, wantCount, maybeCount, origin, profileId }) {
  const dayHtml = days.map((day) => `
    <div class="share-day">
      <h3>${day.label}${day.date ? ` <span class="share-date">${day.date}</span>` : ''}</h3>
      <div class="share-sets">
        ${day.sets.map((set) => `
          <div class="share-set" style="border-left: 3px solid ${set.stageColor}">
            <div class="share-set-time">${set.startTime}${set.endTime ? ' - ' + set.endTime : ''}</div>
            <div class="share-set-artist">${set.artist}</div>
            <div class="share-set-meta">
              <span class="share-stage">${set.stage}</span>
              <span class="share-priority" style="color: ${priorityColor(set.priority)}">${priorityLabel(set.priority)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${username}'s ${festivalName} Schedule</title>
  <meta name="description" content="${username}'s picks for ${festivalName} - ${totalPicks} sets selected">
  <meta property="og:title" content="${username}'s ${festivalName} Schedule">
  <meta property="og:description" content="${mustCount} must-see, ${wantCount} want-to-see, ${maybeCount} maybe - ${totalPicks} total picks">
  <meta property="og:url" content="${origin}/s/${profileId}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${origin}/api/v1/export-card/${profileId}?public=1">
  <meta property="og:image:width" content="800">
  <meta property="og:image:height" content="600">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${origin}/api/v1/export-card/${profileId}?public=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
    }
    .share-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px 16px;
    }
    .share-header {
      text-align: center;
      padding: 24px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      margin-bottom: 20px;
    }
    .share-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      margin: 0 auto 12px;
      overflow: hidden;
      background: #333;
    }
    .share-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .share-username {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .share-festival {
      font-size: 14px;
      color: #ff3366;
      font-weight: 600;
    }
    .share-location {
      font-size: 13px;
      color: #888;
    }
    .share-stats {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 16px;
      font-size: 13px;
    }
    .share-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .share-stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .share-day {
      margin-bottom: 24px;
    }
    .share-day h3 {
      font-size: 16px;
      font-weight: 700;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 8px;
    }
    .share-date {
      font-weight: 400;
      color: #888;
      font-size: 13px;
    }
    .share-sets {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .share-set {
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .share-set-time {
      font-size: 12px;
      color: #888;
      font-weight: 500;
    }
    .share-set-artist {
      font-size: 15px;
      font-weight: 600;
      margin: 2px 0;
    }
    .share-set-meta {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .share-stage {
      color: #aaa;
    }
    .share-priority {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .share-cta {
      text-align: center;
      padding: 24px 0;
      margin-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .share-cta a {
      display: inline-block;
      background: #ff3366;
      color: #fff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
    }
    .share-cta a:hover {
      background: #e62e5c;
    }
    .share-cta p {
      font-size: 13px;
      color: #888;
      margin-top: 8px;
    }
    .share-empty {
      text-align: center;
      padding: 40px 0;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="share-container">
    <div class="share-header">
      ${avatarUrl ? `<div class="share-avatar"><img src="${avatarUrl}" alt="" loading="lazy"></div>` : ''}
      <div class="share-username">${username}</div>
      <div class="share-festival">${festivalName}</div>
      ${festivalLocation ? `<div class="share-location">${festivalLocation}</div>` : ''}
      <div class="share-stats">
        <span class="share-stat"><span class="share-stat-dot" style="background:#ff3366"></span> ${mustCount} must</span>
        <span class="share-stat"><span class="share-stat-dot" style="background:#ffaa00"></span> ${wantCount} want</span>
        <span class="share-stat"><span class="share-stat-dot" style="background:#888"></span> ${maybeCount} maybe</span>
      </div>
    </div>

    ${totalPicks === 0
      ? '<div class="share-empty"><p>No picks saved yet.</p></div>'
      : dayHtml
    }

    <div class="share-cta">
      <a href="${origin}">Plan your own schedule</a>
      <p>Compare picks with your crew on Festie</p>
    </div>
  </div>
</body>
</html>`;
}
