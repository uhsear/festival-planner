/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Export routes: HTML/ICS/image generation and presence.
 *
 * Heavy lifting is delegated to helpers:
 *   lib/helpers/ics-builder.ts   — ICS calendar generation (shared with calendar-sync)
 *   lib/helpers/export-image.ts  — SVG picks-card builder
 *   lib/export-worker.ts         — HTML rendering (worker thread)
 */

import path from 'path';
import fs from 'fs';
import { Worker } from 'worker_threads';
import sharp from 'sharp';
import { buildVCalendar, buildIcsEventsFromPicks } from '../lib/helpers/ics-builder.js';
import { buildPicksCardSvg } from '../lib/helpers/export-image.js';
import { buildExportHtml } from '../lib/helpers/export-utils.js';

export default function createExportRoutes(deps: any) {
  const {
    express, log,
    userAuth, setNoStore,
    getFestivalById, getProfiles, getUserFestivalProfile, getUserById,
    serializeOwnProfile, serializeExportCrewProfile,
    sendSuccess, sendError, ErrorCodes,
    sanitizeIdentifier,
    rateLimit,
    schemas, validateParams,
  } = deps;

  const router = express.Router();
  const config = deps.config;

  const { exportContentSecurityPolicy } = deps;

  // ═══════════════════════════════════════════════════════════════════
  // Worker pool for HTML export
  // ═══════════════════════════════════════════════════════════════════

  const templatePath = path.join(config.PUBLIC_DIR, 'export-template.html');
  const exportTemplate = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Festie Export</title></head><body>__SECTIONS__</body></html>';

  const EXPORT_WORKER_PATH = new URL('../lib/export-worker.ts', import.meta.url);
  const EXPORT_TIMEOUT_MS = config.EXPORT_TIMEOUT_MS || 10_000;
  const MAX_CONCURRENT_EXPORTS = config.MAX_CONCURRENT_EXPORTS || 4;
  const MAX_CREW_IN_EXPORT = config.MAX_CREW_IN_EXPORT || 20;
  const EXPORT_COOLDOWN_MS = config.EXPORT_COOLDOWN_MS || 5_000;
  const MAX_COOLDOWN_ENTRIES = config.MAX_EXPORT_COOLDOWN_ENTRIES;
  const exportCooldowns = new Map();
  const cooldownCleanup = setInterval(() => {
    const now = Date.now();
    const keysToDelete: any[] = [];
    for (const [uid, ts] of exportCooldowns) {
      if (now - ts > EXPORT_COOLDOWN_MS * 2) keysToDelete.push(uid);
    }
    for (const uid of keysToDelete) exportCooldowns.delete(uid);

    // Batch-delete oldest entries if map exceeds limit
    while (exportCooldowns.size > MAX_COOLDOWN_ENTRIES) {
      const oldest = exportCooldowns.keys().next().value;
      exportCooldowns.delete(oldest);
    }
  }, 60_000);
  cooldownCleanup.unref();
  // Track cleanup interval for graceful shutdown
  if (deps.state && deps.state.timers) {
    deps.state.timers.push(cooldownCleanup);
  }

  // P3.11: Reusable worker pool — avoids spawning a new Worker per request
  // Falls back to inline processing when Worker threads can't load .ts files
  const POOL_SIZE = Math.min(MAX_CONCURRENT_EXPORTS, 2);
  const workerPool: any[] = [];
  const pendingJobs: any[] = [];
  let useInlineExport = false;

  function _createPoolWorker() {
    try {
      const worker = new Worker(EXPORT_WORKER_PATH, {
        execArgv: ['--experimental-strip-types'],
      });
      const entry = { worker, busy: false };
      worker.on('error', (err: any) => {
        if (err?.code === 'ERR_MODULE_NOT_FOUND') {
          useInlineExport = true;
          log.warn('Worker threads unavailable for .ts files — using inline export');
        }
      });
      worker.on('exit', () => {
        const idx = workerPool.indexOf(entry);
        if (idx !== -1) workerPool.splice(idx, 1);
        if (!useInlineExport && workerPool.length < POOL_SIZE) workerPool.push(_createPoolWorker());
      });
      return entry;
    } catch {
      useInlineExport = true;
      return null;
    }
  }

  for (let i = 0; i < POOL_SIZE; i++) {
    const entry = _createPoolWorker();
    if (entry) workerPool.push(entry);
  }
  if (deps.state && deps.state.shutdownCallbacks) {
    deps.state.shutdownCallbacks.push(() => workerPool.forEach(e => e.worker.terminate()));
  }

  function _dispatchNext() {
    if (pendingJobs.length === 0) return;
    const available = workerPool.find(e => !e.busy);
    if (!available) return;
    const job = pendingJobs.shift();
    available.busy = true;

    let settled = false;
    const settle = (fn: any, value: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      available.worker.removeAllListeners('message');
      available.worker.removeAllListeners('error');
      available.busy = false;
      fn(value);
      _dispatchNext();
    };
    const timer = setTimeout(() => {
      settle(job.reject, new Error('Export worker timed out'));
    }, EXPORT_TIMEOUT_MS);

    available.worker.on('message', (msg: any) => {
      if (msg && msg.error) settle(job.reject, new Error('Export processing failed'));
      else if (msg && typeof msg.html === 'string') settle(job.resolve, msg.html);
      else settle(job.reject, new Error('Unexpected worker response'));
    });
    available.worker.on('error', (err: any) => {
      settle(job.reject, err);
    });
    available.worker.postMessage(job.data);
  }

  function runExportWorker(data: any) {
    if (useInlineExport || workerPool.length === 0) {
      try {
        const html = buildExportHtml(data.template, data.festival, data.profile, data.allProfiles, data.exportedAt);
        return Promise.resolve(html);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    if (pendingJobs.length >= MAX_CONCURRENT_EXPORTS) {
      return Promise.reject(new Error('Too many concurrent exports'));
    }
    return new Promise((resolve, reject) => {
      pendingJobs.push({ data, resolve, reject });
      _dispatchNext();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Shared: build ICS events from festival picks
  // ═══════════════════════════════════════════════════════════════════

  // buildIcsEventsFromPicks is imported from lib/helpers/ics-builder.ts

  // ═══════════════════════════════════════════════════════════════════
  // Routes
  // ═══════════════════════════════════════════════════════════════════

  // ── HTML export helpers ──────────────────────────────────────────

  async function loadExportProfile(req: any, festivalId: any, profileId: any) {
    const festival = await getFestivalById(festivalId);
    if (!festival) return { error: { status: 404, message: 'Not found', code: ErrorCodes.NOT_FOUND } };

    const profile = await deps.stores.profiles.getById(profileId);
    if (!profile || profile.festivalId !== festivalId) {
      return { error: { status: 404, message: 'Not found', code: ErrorCodes.NOT_FOUND } };
    }
    if (profile.userId !== req.user.userId) {
      return { error: { status: 403, message: 'Not allowed to export this profile', code: ErrorCodes.FORBIDDEN } };
    }
    return { festival, profile };
  }

  function checkExportCooldown(userId: any, cooldownKey?: any) {
    const lastExport = exportCooldowns.get(cooldownKey || userId) || 0;
    if (Date.now() - lastExport < EXPORT_COOLDOWN_MS) return true;
    exportCooldowns.set(cooldownKey || userId, Date.now());
    return false;
  }

  function buildExportFilename(festivalName: any, profileName: any) {
    const safeFilename = (`${festivalName}_${profileName}`)
      .slice(0, 200)
      .replace(/[^a-z0-9_-]/gi, '_')
      .replace(/_+/g, '_')
      .slice(0, 80) || 'festival_schedule';
    return `${safeFilename}_schedule.html`;
  }

  // HTML export: Justified. Provides printable/offline snapshot users can reference on paper/offline device.
  // More accessible than ICS for casual viewing. Worker-based generation keeps server responsive.
  /**
   * HTML export intentionally uses res.send() instead of sendSuccess().
   * Export endpoints return rendered HTML/ICS content, not JSON envelope.
   * This is by design — see Finding #54.
   */
  router.get('/export/:festivalId/:profileId', userAuth, rateLimit(30, 'export-html'), validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    const startTime = Date.now();
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.validatedParams.festivalId);
      const profileId = sanitizeIdentifier(req.params.profileId);
      if (!festivalId || !profileId) return sendError(res, 400, 'Invalid festival or profile ID', ErrorCodes.INVALID_INPUT);

      const loaded = await loadExportProfile(req, festivalId, profileId);
      if (loaded.error) return sendError(res, loaded.error.status, loaded.error.message, loaded.error.code);
      const { festival, profile } = loaded;

      if (checkExportCooldown(req.user.userId)) {
        return sendError(res, 429, 'Please wait a few seconds before exporting again', ErrorCodes.RATE_LIMITED);
      }

      const festivalProfiles = deps.stores.profiles.getByFestival
        ? await deps.stores.profiles.getByFestival(festivalId)
        : (await getProfiles()).filter((p: any) => p.festivalId === festivalId);
      const crewProfiles = festivalProfiles
        .map((crewProfile: any) => serializeExportCrewProfile(crewProfile))
        .slice(0, MAX_CREW_IN_EXPORT);
      const user = await getUserById(profile.userId);
      const totalSets = (festival.days || []).flatMap((day: any) =>
        (day.sets || []).filter((s: any) => profile.picks && profile.picks[s.id]),
      ).length;

      const html = await runExportWorker({
        template: exportTemplate,
        festival,
        profile: serializeOwnProfile(profile, user),
        allProfiles: crewProfiles,
        exportedAt: new Date().toISOString(),
      });
      const downloadFilename = buildExportFilename(festival.name, profile.name);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', exportContentSecurityPolicy);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const encodeFilename = deps.encodeContentDispositionFilename;
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"; filename*=UTF-8''${encodeFilename(downloadFilename)}`);

      const durationMs = Date.now() - startTime;
      log.info('export completed', { festivalId, format: 'html', durationMs, sets: totalSets });
      return res.send(html);
    } catch (error: any) {
      const elapsedMs = Date.now() - startTime;
      if (error.message === 'Too many concurrent exports' || error.message === 'Export queue full') {
        return sendError(res, 503, 'Server busy, try again shortly', ErrorCodes.RATE_LIMITED);
      }
      log.error('export failed', { error: error.message, festivalId: req.validatedParams?.festivalId, profileId: req.params.profileId, elapsedMs });
      return sendError(res, 500, 'Failed to export', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ICS Calendar Export: Justified. Integrates picks into native phone calendar for reliable reminders.
  // Native calendar is more reliable than browser notifications for offline scenarios.
  /**
   * ICS export intentionally uses res.send() instead of sendSuccess().
   * Export endpoints return rendered HTML/ICS content, not JSON envelope.
   * This is by design — see Finding #54.
   */
  router.get('/export/:festivalId/:profileId/calendar', userAuth, rateLimit(30, 'export-cal'), validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.validatedParams.festivalId);
      const profileId = sanitizeIdentifier(req.params.profileId);
      if (!festivalId || !profileId) return sendError(res, 400, 'Invalid festival or profile ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Not found', ErrorCodes.NOT_FOUND);

      // Use store method to get single profile directly instead of loading all profiles
      const profile = await deps.stores.profiles.getById(profileId);
      if (!profile || profile.festivalId !== festivalId) return sendError(res, 404, 'Not found', ErrorCodes.NOT_FOUND);
      if (profile.userId !== req.user.userId) return sendError(res, 403, 'Not allowed', ErrorCodes.FORBIDDEN);

      const userId = req.user.userId;
      const lastIcsExport = exportCooldowns.get(`ics:${userId}`) || 0;
      if (Date.now() - lastIcsExport < EXPORT_COOLDOWN_MS) {
        return sendError(res, 429, 'Please wait a few seconds before exporting again', ErrorCodes.RATE_LIMITED);
      }
      exportCooldowns.set(`ics:${userId}`, Date.now());

      const origin = (config.PUBLIC_ORIGIN || 'localhost').replace(/^https?:\/\//, '');
      const events = buildIcsEventsFromPicks(festival, profile, origin);
      const ics = buildVCalendar(events, { calendarName: festival.name });

      const safeName = (festival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      const icsFilename = `${safeName}_schedule.ics`;
      res.setHeader('Content-Disposition', `attachment; filename="${icsFilename}"; filename*=UTF-8''${encodeURIComponent(icsFilename)}`);
      return res.send(ics);
    } catch (error: any) {
      log.error('ics export failed', { error: error.message });
      return sendError(res, 500, 'Failed to export calendar', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // JSON and NDJSON exports removed as part of Finding #37: feature bloat reduction.
  // Maintaining only HTML (printable/offline) and ICS (native calendar integration).

  router.get('/presence/:festivalId', userAuth, rateLimit(60, 'presence'), validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.validatedParams.festivalId);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      if (!await getUserFestivalProfile(req.user.userId, festivalId)) {
        return sendError(res, 403, 'Join this festival to view presence', ErrorCodes.FORBIDDEN);
      }
      const getPresenceList = deps.getPresenceList;
      const online = await getPresenceList(festivalId);
      return sendSuccess(res, { online });
    } catch (error: any) {
      log.error('presence load failed', { error: error.message, festivalId: req.validatedParams?.festivalId });
      return sendError(res, 500, 'Failed to load presence', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Calendar export JSON API for native calendar integration
  router.get('/festivals/:festivalId/calendar', userAuth, rateLimit(30, 'festival-cal'), validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    try {
      const festivalId = req.validatedParams.festivalId;
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const profile = (await getProfiles()).find(
        (p: any) => p.festivalId === festivalId && p.userId === req.user.userId && !p.deletedAt,
      );
      if (!profile) return sendError(res, 404, 'Not joined', ErrorCodes.NOT_FOUND);

      const picks = profile.picks || {};
      const stageMap = new Map((festival.stages || []).map((s: any) => [s.id, s.name]));
      const events = (festival.days || []).flatMap((day: any) =>
        (day.sets || [])
          .filter((set: any) => picks[set.id])
          .map((set: any) => ({
            id: set.id,
            title: set.name || set.artist || 'Unknown',
            stage: stageMap.get(set.stageId) || 'Unknown',
            day: day.date || day.name,
            startTime: set.startTime || null,
            endTime: set.endTime || null,
            priority: picks[set.id],
            linkUrl: set.linkUrl || null,
          })),
      );

      return sendSuccess(res, {
        festival: { id: festival.id, name: festival.name },
        events,
      });
    } catch (error: any) {
      log.error('calendar API failed', { error: error.message });
      return sendError(res, 500, 'Calendar export failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Phase 1C: Shareable Picks Card — SVG -> PNG via Sharp
  // ═══════════════════════════════════════════════════════════════════

  router.get('/export-card/:festivalId', userAuth, rateLimit(30, 'export-card'), validateParams(schemas.festivalIdParams), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.validatedParams.festivalId);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);

      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const profile = await getUserFestivalProfile(req.user.userId, festivalId);
      if (!profile) return sendError(res, 404, 'Not joined', ErrorCodes.NOT_FOUND);

      const userId = req.user.userId;
      const lastCardExport = exportCooldowns.get('card:' + userId) || 0;
      if (Date.now() - lastCardExport < EXPORT_COOLDOWN_MS) {
        return sendError(res, 429, 'Please wait before generating another card', ErrorCodes.RATE_LIMITED);
      }
      exportCooldowns.set('card:' + userId, Date.now());

      const brandDomain = (config.PUBLIC_ORIGIN || 'festie.us').replace(/^https?:\/\//, '');
      const svg = buildPicksCardSvg(festival, profile, { brandDomain });
      const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();

      const safeName = (festival.name || 'picks').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline; filename="' + safeName + '_picks.png"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(png);
    } catch (err: any) {
      log.error('picks card generation failed', { error: err.message });
      return sendError(res, 500, 'Failed to generate picks card', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
