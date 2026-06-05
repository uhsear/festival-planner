/**
 * ICS Smart Sync — subscribable calendar URL.
 *
 * POST /api/v1/calendar-sync/:festivalId — generate/retrieve sync token (auth required)
 * GET  /cal/:token.ics — public ICS feed (no auth, token-based)
 */

import { Router } from 'express';
import { buildVCalendar, buildIcsEventsFromPicks } from '../lib/helpers/ics-builder.js';

export default function createCalendarSyncRoutes(deps: any) {
  const router = Router();
  const { stores, userAuth, sendSuccess, sendError, ErrorCodes, log, sanitizeIdentifier, config, rateLimit } = deps;
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const writeLimit = typeof rateLimit === 'function' ? rateLimit(10, 'calendar-sync') : noopLimit;

  // Generate or retrieve calendar sync token
  router.post('/calendar-sync/:festivalId', userAuth, writeLimit, async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.festivalId);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);

      const profiles = await stores.profiles.readByUserAndFestival(req.user.userId, festivalId);
      const profile = profiles?.[0] || (Array.isArray(profiles) ? null : profiles);
      if (!profile) return sendError(res, 404, 'No profile for this festival', ErrorCodes.NOT_FOUND);

      const token = await stores.calendarTokens.getOrCreate({
        userId: req.user.userId,
        festivalId,
        profileId: profile.id,
      });

      const origin = config.PUBLIC_ORIGIN || 'http://localhost:4000';
      const url = `${origin}/cal/${token.id}.ics`;
      return sendSuccess(res, { url, tokenId: token.id });
    } catch (err: any) {
      log.error('calendar sync token failed', { error: err.message });
      return sendError(res, 500, 'Failed to create sync URL', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}

/**
 * Subscribable ICS endpoint — mounted directly on app, not under /api/v1.
 * No auth required; uses token for lookup.
 */
export function createCalendarFeedRoute(deps: any) {
  const { stores, log, config, rateLimit } = deps;
  const feedRouter = Router();
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const feedLimit = typeof rateLimit === 'function' ? rateLimit(30, 'calendar-feed') : noopLimit;

  // NOTE: This feed route intentionally does NOT use the sendError/sendSuccess
  // JSON-envelope helpers that the /api/v1 POST route above uses. It serves a
  // public ICS (text/calendar) feed consumed by calendar clients — Google
  // Calendar, Apple Calendar, etc. — not a JSON API. Both the success body and
  // the error bodies are therefore plain text: a JSON error envelope would only
  // confuse a subscribing client and break graceful failure. Error paths are
  // kept as short plain-text messages with an explicit text/plain content type
  // so the response shape is consistent and unambiguous across this route.
  feedRouter.get('/cal/:token.ics', feedLimit, async (req: any, res: any) => {
    try {
      const tokenId = req.params.token;
      if (!tokenId || tokenId.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(tokenId)) {
        return res.status(400).type('text/plain').send('Invalid token');
      }

      const token = await stores.calendarTokens.getByToken(tokenId);
      if (!token) return res.status(404).type('text/plain').send('Calendar not found');

      const festival = await stores.festivals.getById(token.festival_id);
      if (!festival) return res.status(404).type('text/plain').send('Festival not found');

      const profile = await stores.profiles.getById(token.profile_id);
      if (!profile) return res.status(404).type('text/plain').send('Profile not found');

      const origin = (config.PUBLIC_ORIGIN || 'localhost').replace(/^https?:\/\//, '');

      // Build event descriptors using the shared helper
      const events = buildIcsEventsFromPicks(festival, profile, origin);

      // Add SEQUENCE so calendar apps detect changes on each refresh
      const sequence = Math.floor(Date.now() / 60000) % 10000;
      for (const event of events) {
        (event as any).sequence = sequence;
      }

      const ics = buildVCalendar(events, {
        calendarName: `${festival.name} (Festie)`,
        extraHeaders: [
          // Refresh hint for calendar clients
          'X-PUBLISHED-TTL:PT15M',
          'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
        ],
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(ics);
    } catch (err: any) {
      log.error('calendar feed failed', { error: err.message });
      return res.status(500).type('text/plain').send('Calendar error');
    }
  });

  return feedRouter;
}
