/**
 * ICS Smart Sync — subscribable calendar URL.
 *
 * POST /api/v1/calendar-sync/:festivalId — generate/retrieve sync token (auth required)
 * GET  /cal/:token.ics — public ICS feed (no auth, token-based)
 */

import { Router } from 'express';

export default function createCalendarSyncRoutes(deps: any) {
  const router = Router();
  const { stores, userAuth, sendSuccess, sendError, ErrorCodes, log, sanitizeIdentifier, config, rateLimit } = deps;
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const writeLimit = (typeof rateLimit === 'function') ? rateLimit(10, 'calendar-sync') : noopLimit;

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
  const feedLimit = (typeof rateLimit === 'function') ? rateLimit(30, 'calendar-feed') : noopLimit;

  feedRouter.get('/cal/:token.ics', feedLimit, async (req: any, res: any) => {
    try {
      const tokenId = req.params.token;
      if (!tokenId || tokenId.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(tokenId)) {
        return res.status(400).send('Invalid token');
      }

      const token = await stores.calendarTokens.getByToken(tokenId);
      if (!token) return res.status(404).send('Calendar not found');

      const festival = await stores.festivals.getById(token.festival_id);
      if (!festival) return res.status(404).send('Festival not found');

      const profile = await stores.profiles.getById(token.profile_id);
      if (!profile) return res.status(404).send('Profile not found');

      const picks = profile.picks || {};
      const notes = profile.notes || {};
      const sets = (festival.days || []).flatMap((day: any) =>
        (day.sets || []).filter((s: any) => picks[s.id]).map((s: any) => ({ ...s, date: day.date, dayLabel: day.label }))
      );
      const stageMap: Map<string, any> = new Map((festival.stages || []).map((s: any) => [s.id, s]));

      function escIcs(v: any) {
        return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '');
      }
      function validateIcsTime(t: string) {
        if (!/^\d{2}:\d{2}$/.test(t)) return null;
        const [hh, mm] = t.split(':').map(Number) as [number, number];
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
        return t;
      }
      function foldIcsLine(line: string) {
        if (line.length <= 75) return line;
        let folded = line.substring(0, 75);
        let rest = line.substring(75);
        while (rest.length > 0) {
          folded += '\r\n ' + rest.substring(0, 74);
          rest = rest.substring(74);
        }
        return folded;
      }

      const origin = (config.PUBLIC_ORIGIN || 'localhost').replace(/^https?:\/\//, '');

      const icsLines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//FestivalPlanner//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        foldIcsLine(`X-WR-CALNAME:${escIcs(festival.name)} (Festie)`),
        // Refresh hint for calendar clients
        'X-PUBLISHED-TTL:PT15M',
        `REFRESH-INTERVAL;VALUE=DURATION:PT15M`,
      ];

      sets.forEach((set: any) => {
        if (!set.date || !/^\d{4}-\d{2}-\d{2}$/.test(set.date) || !set.startTime || !set.endTime) return;
        const startTime = validateIcsTime(set.startTime);
        const endTime = validateIcsTime(set.endTime);
        if (!startTime || !endTime) return;
        const stage = stageMap.get(set.stageId);
        const dtStart = set.date.replace(/-/g, '') + 'T' + startTime.replace(':', '') + '00';
        const dtEnd = set.date.replace(/-/g, '') + 'T' + endTime.replace(':', '') + '00';
        const priority = picks[set.id] || '';
        const note = notes[set.id] || '';
        const description = [priority && `Priority: ${priority}`, note].filter(Boolean).join('\\n');
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

        icsLines.push('BEGIN:VEVENT');
        icsLines.push(`DTSTAMP:${dtstamp}`);
        icsLines.push(`DTSTART:${dtStart}`);
        icsLines.push(`DTEND:${dtEnd}`);
        icsLines.push(foldIcsLine(`SUMMARY:${escIcs(set.artist)}`));
        if (stage) icsLines.push(foldIcsLine(`LOCATION:${escIcs(stage.name)}${festival.location ? ' - ' + escIcs(festival.location) : ''}`));
        if (description) icsLines.push(foldIcsLine(`DESCRIPTION:${escIcs(description)}`));
        icsLines.push(`UID:${set.id}-${festival.id}@${origin}`);
        icsLines.push('STATUS:CONFIRMED');
        // SEQUENCE increments so calendar apps detect changes
        icsLines.push(`SEQUENCE:${Math.floor(Date.now() / 60000) % 10000}`);
        icsLines.push('END:VEVENT');
      });

      icsLines.push('END:VCALENDAR');

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(icsLines.join('\r\n'));
    } catch (err: any) {
      log.error('calendar feed failed', { error: err.message });
      return res.status(500).send('Calendar error');
    }
  });

  return feedRouter;
}
