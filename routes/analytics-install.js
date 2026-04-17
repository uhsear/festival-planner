/**
 * Install funnel analytics — lightweight event capture for PWA install events.
 * POST /api/v1/analytics/install  { platform, event, reason?, engagement_ms? }
 *
 * Events: shown | accepted | dismissed | native_fired | inapp_blocked
 * Platform: ios | android | desktop
 *
 * Rate-limited per IP via the shared rateLimit middleware. No auth required
 * (captures anon first-visit events).
 */
"use strict";

const ALLOWED_EVENTS = new Set(["shown", "accepted", "dismissed", "native_fired", "inapp_blocked"]);
const ALLOWED_PLATFORMS = new Set(["ios", "android", "desktop"]);

module.exports = function createAnalyticsInstallRoutes(deps) {
  const { express, log, stores, rateLimit } = deps;
  const router = express.Router();

  const noop = (_req, _res, next) => next();
  const limiter = typeof rateLimit === "function" ? rateLimit(60, "install-analytics") : noop;

  router.post("/install", limiter, async (req, res) => {
    try {
      const { platform, event, reason, engagement_ms } = req.body || {};
      if (!ALLOWED_PLATFORMS.has(platform)) return res.status(400).json({ error: "invalid platform" });
      if (!ALLOWED_EVENTS.has(event)) return res.status(400).json({ error: "invalid event" });

      const ua = (req.get("user-agent") || "").slice(0, 500);
      const reasonClean = typeof reason === "string" ? reason.trim().slice(0, 64) : null;
      const engagementMs = Number.isFinite(engagement_ms)
        ? Math.min(Math.max(0, engagement_ms | 0), 86_400_000)
        : null;

      // Prefer store if available, else raw pool query via deps
      const pool = deps.pool || (stores && stores.pool) || null;
      if (!pool) {
        // No persistence available — silently accept to avoid breaking client
        return res.status(204).end();
      }

      await pool.query(
        `INSERT INTO install_events (platform, event, reason, engagement_ms, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [platform, event, reasonClean, engagementMs, ua]
      );

      res.status(204).end();
    } catch (err) {
      // Never fail the request path on analytics errors
      if (log && log.warn) log.warn("install analytics error", { message: err && err.message, code: err && err.code });
      res.status(204).end();
    }
  });

  return router;
};
