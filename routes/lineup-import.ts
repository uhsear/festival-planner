/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Lineup Import Route — Parse CSV/TSV/text lineup into festival sets
 *
 * POST /api/v1/admin/festivals/:id/import-lineup
 * Body: { text: "...", format: "csv"|"tsv"|"auto" }
 *
 * Expected formats:
 *   CSV: artist,stage,day,startTime,endTime[,linkUrl]
 *   TSV: artist\tstage\tday\tstartTime\tendTime[\tlinkUrl]
 *   Auto: Detects delimiter from first line
 *
 * Header row is optional — detected by checking if first row contains
 * "artist" (case-insensitive). Columns can be in any order if header present.
 * Without header: assumed order is artist, stage, day, startTime, endTime.
 *
 * If SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are configured, auto-populates
 * link_url with Spotify artist page URLs for sets that don't already have one.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { sanitizeLinkRecord } from '../lib/schemas.js';

const importLineupSchema = z.object({
  text: z.string().min(1).max(100_000),
  format: z.enum(['csv', 'tsv', 'auto']).default('auto'),
  skipSpotify: z.boolean().default(false),
});

export default function createLineupImportRoute(deps: any) {
  const {
    express,
    log,
    config,
    adminAuth,
    setNoStore,
    rateLimit,
    getFestivalById,
    sanitizeIdentifier,
    sanitizeString,
    sendSuccess,
    sendError,
    ErrorCodes,
    stores,
    invalidateFestivalCache,
    getRequestIp,
    reengagement,
  } = deps;

  const router = express.Router();

  // Spotify integration — optional, only if credentials configured
  let spotify: any = null;
  const spotifyClientId = config.SPOTIFY_CLIENT_ID;
  const spotifyClientSecret = config.SPOTIFY_CLIENT_SECRET;
  if (spotifyClientId && spotifyClientSecret) {
    import('../lib/spotify.js')
      .then((mod) => {
        spotify = (mod as any).default || mod;
        log.info('spotify integration enabled for lineup import');
      })
      .catch(() => {
        log.warn('spotify module not available');
      });
  }

  function detectDelimiter(firstLine: any) {
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    return tabCount > commaCount ? '\t' : ',';
  }

  function parseLine(line: any, delimiter: any) {
    if (delimiter === ',') {
      const fields: any[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      fields.push(current.trim());
      return fields;
    }
    return line.split(delimiter).map((f: any) => f.trim());
  }

  function normalizeTime(raw: any) {
    if (!raw) return '';
    const stripped = raw.trim().replace(/\s+/g, ' ');
    if (/^\d{1,2}:\d{2}$/.test(stripped)) return stripped.padStart(5, '0');
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(stripped)) return stripped.slice(0, 5).padStart(5, '0');
    const match12 = stripped.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = parseInt(match12[2] || '0', 10);
      const period = match12[3].toLowerCase();
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return stripped;
  }

  router.post('/:id/import-lineup', adminAuth, rateLimit(5, 'lineup-import'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const validation = importLineupSchema.safeParse(req.body);
      if (!validation.success) {
        return sendError(res, 400, 'Invalid import payload', ErrorCodes.INVALID_INPUT);
      }

      const { text, format, skipSpotify } = validation.data;
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Build stage lookup from existing festival
      const stageMap = new Map();
      for (const stage of festival.stages || []) {
        stageMap.set(stage.name.toLowerCase(), stage.id);
        stageMap.set(stage.id, stage.id);
      }

      // Build day lookup from existing festival
      const dayMap = new Map();
      for (let i = 0; i < (festival.days || []).length; i++) {
        const day = festival.days[i];
        dayMap.set(day.label.toLowerCase(), i);
        dayMap.set(day.date, i);
        dayMap.set(String(i), i);
        dayMap.set(String(i + 1), i);
      }

      const lines = text.split(/\r?\n/).filter((l: any) => l.trim());
      if (lines.length === 0) return sendError(res, 400, 'No data to import', ErrorCodes.INVALID_INPUT);

      const delimiter = format === 'csv' ? ',' : format === 'tsv' ? '\t' : detectDelimiter(lines[0]);

      // Detect header row
      const firstFields = parseLine(lines[0], delimiter);
      const headerLower = firstFields.map((f: any) => f.toLowerCase().replace(/[^a-z]/g, ''));
      const hasHeader = headerLower.includes('artist') || headerLower.includes('name');

      let columnMap: any;
      if (hasHeader) {
        const HEADER_TO_FIELD: any = {
          artist: 'artist',
          name: 'artist',
          act: 'artist',
          stage: 'stage',
          day: 'day',
          date: 'day',
          start: 'startTime',
          starttime: 'startTime',
          end: 'endTime',
          endtime: 'endTime',
          link: 'linkUrl',
          linkurl: 'linkUrl',
          url: 'linkUrl',
          spotify: 'linkUrl',
        };
        columnMap = {};
        for (let i = 0; i < headerLower.length; i++) {
          const field = HEADER_TO_FIELD[headerLower[i]];
          if (field && columnMap[field] === undefined) columnMap[field] = i;
        }
      } else {
        columnMap = { artist: 0, stage: 1, day: 2, startTime: 3, endTime: 4 };
      }

      if (columnMap.artist === undefined) {
        return sendError(res, 400, 'Could not find artist/name column in import data', ErrorCodes.INVALID_INPUT);
      }

      const dataLines = hasHeader ? lines.slice(1) : lines;
      const imported: any[] = [];
      const warnings: any[] = [];

      for (let i = 0; i < dataLines.length; i++) {
        const lineNum = hasHeader ? i + 2 : i + 1;
        const fields = parseLine(dataLines[i], delimiter);
        if (imported.length >= config.MAX_IMPORT_SETS) {
          warnings.push(
            `Line ${lineNum}: max import limit (${config.MAX_IMPORT_SETS}) reached, remaining lines skipped`,
          );
          break;
        }

        const rawArtist = sanitizeString(fields[columnMap.artist] || '', 300);
        if (!rawArtist) {
          warnings.push(`Line ${lineNum}: empty artist, skipped`);
          continue;
        }
        const artist = rawArtist;

        const rawStage = sanitizeString(fields[columnMap.stage] || '', 100);
        const rawDay = sanitizeString(fields[columnMap.day] || '', 100);
        const rawStart = (fields[columnMap.startTime] || '').trim().slice(0, 20);
        const rawEnd = (fields[columnMap.endTime] || '').trim().slice(0, 20);
        const rawLink = columnMap.linkUrl !== undefined ? (fields[columnMap.linkUrl] || '').trim() : '';

        const stageId = stageMap.get((rawStage || '').toLowerCase()) || festival.stages?.[0]?.id || null;
        if (rawStage && !stageMap.has(rawStage.toLowerCase())) {
          warnings.push(`Line ${lineNum}: unknown stage, defaulting to first stage`);
        }

        let dayIndex = dayMap.get((rawDay || '').toLowerCase());
        if (dayIndex === undefined) dayIndex = dayMap.get(rawDay);
        if (dayIndex === undefined) {
          dayIndex = 0;
          if (rawDay) warnings.push(`Line ${lineNum}: unknown day, defaulting to first day`);
        }

        const startTime = normalizeTime(rawStart);
        const endTime = normalizeTime(rawEnd);

        // Allowlist link schemes (drop javascript:/data: etc.) before persisting.
        const safeLinks = rawLink ? sanitizeLinkRecord({ spotify: rawLink }) : {};
        const safeLink = safeLinks.spotify || null;
        if (rawLink && !safeLink) {
          warnings.push(`Line ${lineNum}: link dropped (unsupported URL scheme)`);
        }

        imported.push({
          id: `set-import-${crypto.randomBytes(6).toString('hex')}`,
          artist,
          artists: [{ name: artist, links: safeLinks }],
          stageId,
          dayIndex,
          startTime,
          endTime,
          linkUrl: safeLink,
        });
      }

      if (imported.length === 0) {
        return sendError(res, 400, 'No valid sets found in import data', ErrorCodes.INVALID_INPUT);
      }

      // Spotify auto-linking — fill gaps where linkUrl is null
      let spotifyMatched = 0;
      if (spotify && !skipSpotify) {
        const needsLink = imported.filter((s) => !s.linkUrl);
        if (needsLink.length > 0) {
          try {
            const artistNames = needsLink.map((s) => s.artist);
            const spotifyResults = await spotify.bulkSearchArtists(artistNames, spotifyClientId, spotifyClientSecret, {
              log,
            });
            for (const set of needsLink) {
              const match = spotifyResults.get(set.artist);
              if (match?.spotifyUrl) {
                set.linkUrl = match.spotifyUrl;
                if (set.artists?.[0]) {
                  set.artists[0].links.spotify = match.spotifyUrl;
                  if (match.imageUrl) set.artists[0].photo = match.imageUrl;
                  if (match.genres?.length) set.artists[0].genres = match.genres;
                }
                spotifyMatched++;
              }
            }
            log.info('spotify auto-linking complete', { total: needsLink.length, matched: spotifyMatched });
          } catch (err: any) {
            log.warn('spotify auto-linking failed, continuing without', { error: err.message });
            warnings.push('Spotify auto-linking failed — sets imported without Spotify links');
          }
        }
      }

      // Insert imported sets via centralized store method
      const setsWithSortOrder = imported.map((set) => {
        const existingDay = festival.days?.[set.dayIndex];
        const sortOrder =
          (existingDay?.sets?.length || 0) +
          imported.filter((s) => s.dayIndex === set.dayIndex && imported.indexOf(s) < imported.indexOf(set)).length;
        return { ...set, sortOrder };
      });
      await stores.festivals.insertSets(festivalId, setsWithSortOrder);

      // Update festival timestamp
      await stores.pool.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);
      invalidateFestivalCache();

      log.info('lineup imported', {
        festivalId,
        count: imported.length,
        spotifyMatched,
        warnings: warnings.length,
        ip: getRequestIp(req),
      });

      // M3 re-engagement: a recurring festival just published its lineup → notify
      // prior-year attendees of the same-named festival (handled in the trigger:
      // event-gated, per-type opt-out + DND + deduped, full fan-out). When Redis is
      // up this enqueues onto the durable re-engagement queue (issue #20) so delivery
      // survives restarts + retries; otherwise it runs inline. Fire-and-forget here.
      if (reengagement?.sendLineupDrop) {
        reengagement
          .sendLineupDrop(festivalId)
          .catch((err: any) => log.warn('lineup_drop notify failed', { festivalId, error: err?.message }));
      }
      return sendSuccess(res, {
        imported: imported.length,
        spotifyMatched,
        warnings,
        sets: imported.map((s) => ({
          id: s.id,
          artist: s.artist,
          stageId: s.stageId,
          dayIndex: s.dayIndex,
          startTime: s.startTime,
          endTime: s.endTime,
          linkUrl: s.linkUrl,
        })),
      });
    } catch (error: any) {
      log.error('lineup import failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to import lineup', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
