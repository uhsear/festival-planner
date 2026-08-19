/**
 * Express middleware configuration — security headers, CORS, body parsing,
 * static files, request tracking, rate limiting, idempotency, audit.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import compression from 'compression';
import helmet from 'helmet';
import type { Application } from 'express';

import { createTracingMiddleware } from './tracing.js';
import { mountSwaggerUI } from './swagger-ui-setup.js';
import { default as createAuditMiddleware } from './audit-middleware.js';
import { sentry } from './sentry.js';

/**
 * Idempotency-Key middleware: caches the JSON response per `${userId||ip}:${key}`
 * and replays it for a repeat of the same key within `ttl`.
 *
 * The cache slot is RESERVED synchronously, before next(). That reservation is
 * the whole point: the response body is only known at res.json time — i.e. after
 * the handler's mutation has already run — so without it, a retry arriving while
 * the first request is still in flight sees an empty cache and re-executes the
 * mutation (double-write). A concurrent duplicate now finds the pending
 * reservation, awaits the first request's outcome, and replays its response.
 */
function createIdempotencyMiddleware({ ttl, maxEntries }: { ttl: number; maxEntries: number }) {
  const cache = new Map<string, any>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.ts > ttl) cache.delete(key);
    }
  }, 60_000);
  timer.unref();

  function middleware(req: any, res: any, next: any) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.length > 128) return next();
    const userId = req.user?.userId || req.ip;
    const cacheKey = `${userId}:${key}`;

    const run = () => {
      // Reserve the slot synchronously, before next(): a concurrent duplicate
      // that arrives while this request's handler is still running finds a
      // pending reservation and waits on `settled` instead of re-executing.
      let resolveSettled: (v: any) => void;
      const settled = new Promise<any>((r) => { resolveSettled = r; });
      const reservation = { pending: true, ts: Date.now(), settled };
      cache.set(cacheKey, reservation);

      let done = false;
      const release = (value: any) => {
        if (done) return;
        done = true;
        resolveSettled(value);
      };

      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (cache.size >= maxEntries) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey) cache.delete(oldestKey);
        }
        const record = { status: res.statusCode, body, ts: Date.now() };
        cache.set(cacheKey, record);
        release(record);
        return originalJson(body);
      };

      // The handler ended without producing a JSON body (client disconnect or
      // error mid-flight): drop the reservation so it neither blocks a later
      // retry nor leaves a waiter hanging past the request-timeout backstop.
      const onEnd = () => {
        if (done) return;
        if (cache.get(cacheKey) === reservation) cache.delete(cacheKey);
        release(null);
      };
      res.on('finish', onEnd);
      res.on('close', onEnd);

      next();
    };

    const cached = cache.get(cacheKey);
    if (!cached) return run();

    // Completed response already cached -> replay synchronously.
    if (!cached.pending) {
      res.setHeader('X-Idempotency-Replayed', 'true');
      return res.status(cached.status).json(cached.body);
    }

    // A same-key request is still in flight -> wait for its outcome, then
    // replay it. If it ended without a response, this request executes now.
    cached.settled.then((value: any) => {
      if (value) {
        res.setHeader('X-Idempotency-Replayed', 'true');
        return res.status(value.status).json(value.body);
      }
      return run();
    });
  }

  return { middleware, cache, timer };
}

/**
 * Configure all Express middleware on the app instance.
 * @returns {{ inFlightRequests: { count: number } }} References needed by shutdown
 */
function configureMiddleware(app: Application, ctx: any) {
  const {
    express,
    config,
    log,
    state,
    contentSecurityPolicy,
    enforceAllowedOrigin,
    avatarDirPath,
    isAllowedOrigin,
    setNoStore,
    getRequestIp,
    rateLimit,
    authRateLimit,
    sendError,
    ErrorCodes,
    generateOpenAPISpec,
    stores,
  } = ctx;

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  // ── Sentry per-request isolation scope ──────────────────────────────────
  // Mounted FIRST so its wrapped next() covers every middleware, route, and
  // the error handler that follow (see lib/sentry.ts requestScope() for why
  // this is needed instead of Sentry's normal auto-instrumentation).
  app.use(sentry.requestScope());

  // ── Compression ───────────────────────────────────────────────────────
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter(req: any, res: any) {
        const contentType = res.getHeader('content-type') || '';
        if (/image\/(webp|png|jpeg|gif)/.test(contentType as string)) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // ── Helmet ────────────────────────────────────────────────────────────
  // Helmet's built-in CSP is disabled because we use a custom CSP built by
  // buildContentSecurityPolicy() in lib/app-context.js — it needs runtime
  // values (nonce hashes, PUBLIC_ORIGIN) that Helmet's static config can't
  // provide. The custom CSP is applied in the middleware block below.
  app.use(
    helmet({
      // CSP is set manually via buildContentSecurityPolicy() below; Helmet's default is disabled so it doesn't double-write
      contentSecurityPolicy: false,
      // COEP disabled to allow cross-origin image/CDN embeds (Spotify, FCM, avatars). Revisit with 'credentialless' mode if isolation needed.
      crossOriginEmbedderPolicy: false,
      // Cross-origin isolation (safe defaults; avatars/Spotify/FCM are either same-origin or loaded as images/iframes, not fetched credentialed)
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      originAgentCluster: true,
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      dnsPrefetchControl: { allow: false },
      hsts: config.PUBLIC_ORIGIN.startsWith('https://')
        ? { maxAge: 63072000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  // ── Request ID ────────────────────────────────────────────────────────
  app.use((req: any, res: any, next: any) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // ── Distributed tracing ───────────────────────────────────────────────
  app.use(createTracingMiddleware() as any);

  // ── CSP + security headers ────────────────────────────────────────────
  app.use((req: any, res: any, next: any) => {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    // Report-To header defines the reporting group referenced by CSP report-to directive.
    // Forward-compat: browsers that support Reporting API v1 use this; older ones fall back to report-uri.
    res.setHeader(
      'Report-To',
      JSON.stringify({ group: 'csp-endpoint', max_age: 86400, endpoints: [{ url: '/api/csp-report' }] }),
    );
    res.setHeader(
      'Permissions-Policy',
      'accelerometer=(), autoplay=(self), browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), sync-xhr=(), usb=(), xr-spatial-tracking=()',
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
  });

  // ── CORS ──────────────────────────────────────────────────────────────
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    const isAllowed =
      isAllowedOrigin(origin, req.get('host')) || config.MOBILE_ORIGINS.some((mo: any) => origin === mo);
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Festival-Planner-Request, X-User-Token, X-Admin-Token, Idempotency-Key',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!isAllowed) {
        return res.status(403).end();
      }
      return res.status(204).end();
    }
    return next();
  });

  // ── CSRF origin enforcement ───────────────────────────────────────────
  app.use(enforceAllowedOrigin);

  // ── JSON body parser ──────────────────────────────────────────────────
  app.use((req: any, res: any, next: any) => {
    express.json({ limit: config.JSON_LIMIT, strict: true })(req, res, (err: any) => {
      if (err) {
        if (err.type === 'entity.parse.failed') {
          return sendError(res, 400, 'Invalid JSON in request body', ErrorCodes.INVALID_INPUT);
        }
        if (err.type === 'entity.too.large') {
          return sendError(res, 413, 'Request body too large', ErrorCodes.INVALID_INPUT);
        }
        return next(err);
      }
      next();
    });
  });

  // ── Avatar static files ───────────────────────────────────────────────
  app.use(
    '/uploads/avatars',
    express.static(avatarDirPath(), {
      immutable: true,
      maxAge: '365d',
      fallthrough: true,
      setHeaders(res: any, filePath: any) {
        if (filePath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
        );
      },
    }),
  );

  // ── Offline basemap static files (Phase 3B) ───────────────────────────
  // Per-festival PMTiles vector basemaps for the offline map. Mirrors the avatar
  // static handler: immutable long-cache (a festival's archive is content-stable;
  // a re-extract gets a new filename), nosniff, and a locked-down CSP. The
  // PMTiles JS client byte-range fetches the archive, so Range support matters —
  // express.static sets `Accept-Ranges: bytes` and honours `Range` requests for
  // these files automatically. ADDITIVE: festivals with no offline basemap never
  // touch this path and render the unchanged online OSM raster.
  const basemapsDir = path.join(config.PUBLIC_DIR, 'uploads', 'basemaps');
  app.use(
    '/uploads/basemaps',
    express.static(basemapsDir, {
      immutable: true,
      maxAge: '365d',
      fallthrough: true,
      // Only ever serve .pmtiles archives from here; anything else 404s into the
      // SPA catch-all (which already rejects /uploads/* with a 404).
      setHeaders(res: any, filePath: any) {
        if (!filePath.endsWith('.pmtiles')) return;
        // PMTiles is an application/octet-stream container; the client reads it by
        // byte range, not by content type, but set an explicit type + nosniff.
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // The archive is map geometry only — no script/style/frame surface.
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
        );
        // Permit cross-origin range reads from the app's own WebView/SPA map.
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      },
    }),
  );

  // ── Liveness probe ────────────────────────────────────────────────────
  app.get('/health/live', (req: any, res: any) => {
    res.status(200).json({ status: 'alive', uptime: process.uptime() });
  });

  // ── OpenAPI spec + Swagger UI (dev/staging only) ─────────────────────
  if (config.NODE_ENV !== 'production') {
    app.get('/api/docs/openapi.json', (req: any, res: any) => {
      res.json(generateOpenAPISpec(config));
    });
    mountSwaggerUI(app, config);
  }

  // ── Service worker (no-cache) ─────────────────────────────────────────
  // Serve the Workbox-generated SW from the React dist/ build.
  // ponytail: config.WEB_DIST is the prod source (set by loadConfig); the || keeps
  // partial/test configs from throwing on path.join(undefined).
  const webDist = config.WEB_DIST || path.join(config.PUBLIC_DIR, '..', 'packages', 'web', 'dist');
  const _reactSwPath = path.join(webDist, 'sw.js');
  app.get('/sw.js', (req: any, res: any) => {
    setNoStore(res);
    res.sendFile(_reactSwPath, (err: any) => {
      if (err && !res.headersSent) {
        res.status(404).json({
          ok: false,
          code: 'NOT_FOUND',
          message: 'Service worker not found — run pnpm build in packages/web/',
        });
      }
    });
  });
  const _reactManifestPath = path.join(webDist, 'manifest.webmanifest');
  app.get('/manifest.json', (req: any, res: any, next: any) => {
    res.sendFile(_reactManifestPath, (err: any) => {
      if (err && !res.headersSent) next(err);
    });
  });

  // ── React SPA (packages/web/dist) ─────────────────────────────────────
  // Serve the Vite build output. Hashed filenames (e.g. index-DG3A0cK-.js)
  // get immutable caching. Falls through to public/ for static assets
  // (icons, legal pages, screenshots, etc.).
  const reactDistDir = webDist;
  if (fs.existsSync(reactDistDir)) {
    app.use(
      express.static(reactDistDir, {
        maxAge: '7d',
        dotfiles: 'deny',
        index: false, // SPA catch-all in routes/pages.js handles /
        setHeaders(res: any, filePath: any) {
          if (filePath.endsWith('.html')) setNoStore(res);
          // Vite hashed assets are safe to cache immutably
          if (/\.[0-9a-f]{8,}\.(js|css)$/i.test(filePath) || /assets\//.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    log.info('react frontend active', { reactDistDir });
  }

  // ── /.well-known ───────────────────────────────────────────────────────
  // Must be mounted explicitly and BEFORE the public/ static below: that
  // handler uses `dotfiles: 'deny'`, which would otherwise 404 the entire
  // `.well-known` dot-directory into the SPA catch-all — breaking both
  // security.txt (RFC 9116) and assetlinks.json (Android App Links
  // verification). Scoped to this dir only, so no other dotfiles are exposed.
  app.use(
    '/.well-known',
    express.static(path.join(config.PUBLIC_DIR, '.well-known'), {
      maxAge: '1d',
      dotfiles: 'allow',
    }),
  );

  // ── Static assets (public/) ────────────────────────────────────────────
  // Serves static assets that live outside the React build: icons,
  // screenshots, legal pages (privacy, terms, security-whitepaper),
  // firebase-messaging-sw.js, robots.txt, sitemap.xml, etc.
  app.use(
    express.static(config.PUBLIC_DIR, {
      maxAge: '7d',
      dotfiles: 'deny',
      index: false, // SPA catch-all serves React index.html for /
      setHeaders(res: any, filePath: any) {
        if (filePath.endsWith('.html')) setNoStore(res);
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
        if (filePath.endsWith('.png') || filePath.endsWith('.svg')) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
        }
      },
    }),
  );

  // ── Request timeout ───────────────────────────────────────────────────
  app.use('/api', (req: any, res: any, next: any) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        log.warn('request timeout', { method: req.method, path: req.path, reqId: req.id });
        sendError(res, 408, 'Request timeout', ErrorCodes.INTERNAL_ERROR);
      }
    }, config.REQUEST_TIMEOUT_MS);
    timeout.unref();
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));
    next();
  });

  // ── API version header ────────────────────────────────────────────────
  app.use('/api', (req: any, res: any, next: any) => {
    res.setHeader('X-API-Version', config.API_VERSION);
    next();
  });

  // ── API request metrics ───────────────────────────────────────────────
  app.use('/api', (req: any, res: any, next: any) => {
    const start = Date.now();
    let recorded = false;
    function recordMetrics() {
      if (recorded) return;
      recorded = true;
      const duration = Date.now() - start;
      const meta: any = {
        method: req.method,
        path: (req.originalUrl || req.path || '').split('?')[0],
        status: res.statusCode,
        ms: duration,
        ip: getRequestIp(req),
        reqId: req.id,
        traceId: req.traceId,
      };
      if (req.user?.userId) meta.userId = req.user.userId;
      if (res.statusCode >= 500) log.error('request', meta);
      else if (res.statusCode >= 400) log.warn('request', meta);
      else log.info('request', meta);

      state.metrics.totalRequests += 1;
      state.metrics.totalDuration += duration;
      state.metrics.requestCount += 1;
      if (res.statusCode >= 400) state.metrics.totalErrors += 1;
      const bucket = `${Math.floor(res.statusCode / 100)}xx`;
      state.metrics.statusCodes[bucket] = (state.metrics.statusCodes[bucket] || 0) + 1;

      const routePath = req.route?.path || req.path?.replace(/\/[a-zA-Z0-9_-]{10,}(?=\/|$)/g, '/:id') || 'unknown';
      const endpointKey = `${req.method} ${routePath}`;
      if (!state.metrics.endpointLatency) state.metrics.endpointLatency = {};
      const ep =
        state.metrics.endpointLatency[endpointKey] ||
        (state.metrics.endpointLatency[endpointKey] = { count: 0, totalMs: 0, maxMs: 0 });
      ep.count += 1;
      ep.totalMs += duration;
      if (duration > ep.maxMs) ep.maxMs = duration;
    }
    res.on('finish', recordMetrics);
    res.on('close', () => {
      if (!recorded) {
        state.metrics.totalRequests += 1;
        state.metrics.totalErrors += 1;
      }
    });
    next();
  });

  // ── Rate limiting ─────────────────────────────────────────────────────
  app.use('/api', rateLimit());
  app.use('/api/v1/auth/login', authRateLimit);
  app.use('/api/v1/auth/register', authRateLimit);
  // L7: extend the strict Redis-backed (cluster-accurate) auth limiter across
  // the full credential surface, not just login/register.
  app.use('/api/v1/auth/refresh-token', authRateLimit);
  app.use('/api/v1/auth/forgot-password', authRateLimit);
  app.use('/api/v1/auth/reset-password', authRateLimit);
  app.use('/api/v1/profiles', rateLimit(config.PROFILE_RATE_LIMIT_MAX, 'profiles'));
  app.use('/api/v1/crews', rateLimit(config.OVERLAP_RATE_LIMIT_MAX, 'crews'));

  // ── Idempotency key middleware ────────────────────────────────────────
  // ponytail: values stay the literals they were — lib/config.ts already defines
  // env-overridable IDEMPOTENCY_TTL/IDEMPOTENCY_MAX_ENTRIES that this block has
  // never read. The {ttl,maxEntries} params are the seam to wire them, but that
  // drift is a separate audit finding with its own review; keep behavior
  // byte-identical here.
  const { middleware: idempotencyMiddleware, timer: _idempotencyCleanup } =
    createIdempotencyMiddleware({ ttl: 5 * 60 * 1000, maxEntries: 5000 });
  state.timers.push(_idempotencyCleanup);
  app.use('/api/v1', idempotencyMiddleware);

  // ── In-flight request tracking ────────────────────────────────────────
  const inFlightRequests = { count: 0 };
  app.use((req: any, res: any, next: any) => {
    inFlightRequests.count += 1;
    // Guard against double-decrement: both 'finish' and 'close' can fire for
    // the same response, so only the first one counts (mirrors the `recorded`
    // guard in the metrics block above).
    let done = false;
    const decrement = () => {
      if (done) return;
      done = true;
      if (--inFlightRequests.count < 0) inFlightRequests.count = 0;
    };
    res.on('finish', decrement);
    res.on('close', decrement);
    next();
  });

  // ── Audit middleware ──────────────────────────────────────────────────
  app.use('/api', createAuditMiddleware({ stores, log, getRequestIp }));

  return { inFlightRequests };
}

export { configureMiddleware, createIdempotencyMiddleware };
