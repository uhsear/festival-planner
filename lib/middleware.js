'use strict';
/**
 * Express middleware configuration — security headers, CORS, body parsing,
 * static files, request tracking, rate limiting, idempotency, audit.
 */
const crypto = require('crypto');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

const { createTracingMiddleware } = require('./tracing');

/**
 * Configure all Express middleware on the app instance.
 * @param {import('express').Application} app
 * @param {object} ctx - App context from createAppContext
 * @returns {{ inFlightRequests: { count: number } }} References needed by shutdown
 */
function configureMiddleware(app, ctx) {
  const {
    express, config, log, state,
    contentSecurityPolicy, enforceAllowedOrigin,
    avatarDirPath, isAllowedOrigin, setNoStore, getRequestIp,
    rateLimit, authRateLimit,
    sendError, ErrorCodes,
    generateOpenAPISpec, stores,
  } = ctx;

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  // ── Compression ───────────────────────────────────────────────────────
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter(req, res) {
      const contentType = res.getHeader('content-type') || '';
      if (/image\/(webp|png|jpeg|gif)/.test(contentType)) return false;
      return compression.filter(req, res);
    },
  }));

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
      // Explicit Permissions-Policy — excludes deprecated features
      // (ambient-light-sensor, battery, document-domain) that cause browser warnings
      permissionsPolicy: {
        features: {
          accelerometer: [],
          camera: [],
          geolocation: [],
          gyroscope: [],
          magnetometer: [],
          microphone: [],
          payment: [],
          usb: [],
        },
      },
    }),
  );

  // ── Request ID ────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // ── Distributed tracing ───────────────────────────────────────────────
  app.use(createTracingMiddleware());

  // ── CSP + security headers ────────────────────────────────────────────
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    res.setHeader('Permissions-Policy', 'accelerometer=(), autoplay=(self), browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), interest-cohort=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), sync-xhr=(), usb=(), xr-spatial-tracking=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
  });

  // ── CORS ──────────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    const isAllowed = isAllowedOrigin(origin, req.get('host'))
      || config.MOBILE_ORIGINS.some((mo) => origin === mo);
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Festival-Planner-Request, X-User-Token, X-Admin-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
  app.use((req, res, next) => {
    express.json({ limit: config.JSON_LIMIT, strict: true })(req, res, (err) => {
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
  app.use('/uploads/avatars', express.static(avatarDirPath(), {
    immutable: true,
    maxAge: '365d',
    fallthrough: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'");
    },
  }));

  // ── Liveness probe ────────────────────────────────────────────────────
  app.get('/health/live', (req, res) => {
    res.status(200).json({ status: 'alive', uptime: process.uptime() });
  });

  // ── OpenAPI spec + Swagger UI (dev/staging only) ─────────────────────
  if (config.NODE_ENV !== 'production') {
    app.get('/api/docs/openapi.json', (req, res) => {
      res.json(generateOpenAPISpec(config));
    });
    const { mountSwaggerUI } = require('./swagger-ui-setup');
    mountSwaggerUI(app, config);
  }

  // ── Service worker (no-cache) ─────────────────────────────────────────
  app.get('/sw.js', (req, res, next) => {
    setNoStore(res);
    res.sendFile(path.join(config.PUBLIC_DIR, 'sw.js'), (err) => {
      if (err && !res.headersSent) next(err);
    });
  });
  app.get('/manifest.json', (req, res, next) => {
    res.sendFile(path.join(config.PUBLIC_DIR, 'manifest.webmanifest'), (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  // ── React rewrite (packages/web/dist) — higher priority than legacy ──
  // When the Vite build output exists, serve it first. Hashed filenames
  // (e.g. index-DG3A0cK-.js) get immutable caching. Falls through to
  // legacy public/ for avatars, static HTML pages, and anything not in
  // the React build. Removing packages/web/dist/ reverts to legacy.
  const reactDistDir = path.join(config.PUBLIC_DIR, '..', 'packages', 'web', 'dist');
  const _fs = require('fs');
  if (_fs.existsSync(reactDistDir)) {
    app.use(express.static(reactDistDir, {
      maxAge: '7d',
      dotfiles: 'deny',
      index: false, // SPA catch-all in routes/pages.js handles /
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) setNoStore(res);
        // Vite hashed assets are safe to cache immutably
        if (/\.[0-9a-f]{8,}\.(js|css)$/i.test(filePath) || /assets\//.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    // Legacy app accessible at /legacy/ for rollback verification
    app.use('/legacy', express.static(config.PUBLIC_DIR, { maxAge: '1d', dotfiles: 'deny' }));
    log.info('react frontend active', { reactDistDir });
  }

  // ── Legacy static files (public/) ─────────────────────────────────────
  // Still mounted — serves avatars, privacy.html, terms.html, icons,
  // uploads, and anything not in React dist/. When React dist/ exists
  // above, its files take precedence for any shared names (index.html,
  // sw.js, manifest.webmanifest).
  app.use(express.static(config.PUBLIC_DIR, {
    maxAge: '7d',
    dotfiles: 'deny',
    index: false, // SPA catch-all serves React index.html for /
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) setNoStore(res);
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
      if (filePath.endsWith('.png') || filePath.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }));

  // ── Request timeout ───────────────────────────────────────────────────
  app.use('/api', (req, res, next) => {
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
  app.use('/api', (req, res, next) => {
    res.setHeader('X-API-Version', config.API_VERSION);
    next();
  });

  // ── API request metrics ───────────────────────────────────────────────
  app.use('/api', (req, res, next) => {
    const start = Date.now();
    let recorded = false;
    function recordMetrics() {
      if (recorded) return;
      recorded = true;
      const duration = Date.now() - start;
      const meta = {
        method: req.method, path: (req.originalUrl || req.path || '').split('?')[0], status: res.statusCode,
        ms: duration, ip: getRequestIp(req), reqId: req.id, traceId: req.traceId,
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
      const ep = state.metrics.endpointLatency[endpointKey] || (state.metrics.endpointLatency[endpointKey] = { count: 0, totalMs: 0, maxMs: 0 });
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
  app.use('/api/v1/profiles', rateLimit(config.PROFILE_RATE_LIMIT_MAX, 'profiles'));
  app.use('/api/v1/crews', rateLimit(config.OVERLAP_RATE_LIMIT_MAX, 'crews'));

  // ── Idempotency key middleware ────────────────────────────────────────
  const _idempotencyCache = new Map();
  const IDEMPOTENCY_TTL = 5 * 60 * 1000;
  const IDEMPOTENCY_MAX_ENTRIES = 5000;
  const _idempotencyCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _idempotencyCache) {
      if (now - entry.ts > IDEMPOTENCY_TTL) _idempotencyCache.delete(key);
    }
  }, 60_000);
  _idempotencyCleanup.unref();
  state.timers.push(_idempotencyCleanup);

  app.use('/api/v1', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.length > 128) return next();
    const userId = req.user?.userId || req.ip;
    const cacheKey = `${userId}:${key}`;
    const cached = _idempotencyCache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Idempotency-Replayed', 'true');
      return res.status(cached.status).json(cached.body);
    }
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (_idempotencyCache.size >= IDEMPOTENCY_MAX_ENTRIES) {
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [k, v] of _idempotencyCache) {
          if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
        }
        if (oldestKey) _idempotencyCache.delete(oldestKey);
      }
      _idempotencyCache.set(cacheKey, { status: res.statusCode, body, ts: Date.now() });
      return originalJson(body);
    };
    next();
  });

  // ── In-flight request tracking ────────────────────────────────────────
  const inFlightRequests = { count: 0 };
  app.use((req, res, next) => {
    inFlightRequests.count += 1;
    const decrement = () => { if (--inFlightRequests.count < 0) inFlightRequests.count = 0; };
    res.on('finish', decrement);
    res.on('close', decrement);
    next();
  });

  // ── Audit middleware ──────────────────────────────────────────────────
  const createAuditMiddleware = require('./audit-middleware');
  app.use('/api', createAuditMiddleware({ stores, log, getRequestIp }));

  return { inFlightRequests };
}

module.exports = { configureMiddleware };
