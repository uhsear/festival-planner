/**
 * Socket.IO server creation, Redis adapter, notification service, event emitter.
 */
import http from 'http';
import { Server } from 'socket.io';
import type { Application } from 'express';

import { createNotificationService } from './notifications/index.js';
import { createSocketEmitter } from './emitter.js';
import { createAdapter } from '@socket.io/redis-adapter';
import { duplicateClient } from './redis.js';

/**
 * Create HTTP server, configure Socket.IO with Redis adapter, init push notifications.
 */
function configureSocketIO(app: Application, ctx: any) {
  const {
    config, log, redis, stores,
    getSocketRequestIp, isAllowedOrigin,
    consumeSocketConnectRateLimitAsync,
    buildAvatarUrl, getUserById,
    hashSessionToken,
    promMetrics,
  } = ctx;

  const server = http.createServer(app);
  server.keepAliveTimeout = config.SOCKET_KEEPALIVE_TIMEOUT;
  server.headersTimeout = config.SOCKET_HEADERS_TIMEOUT;
  const io = new Server(server, {
    transports: ['websocket'],
    pingTimeout: config.SOCKET_PING_TIMEOUT,
    pingInterval: config.SOCKET_PING_INTERVAL,
    maxHttpBufferSize: config.SOCKET_MAX_HTTP_BUFFER,
    cors: {
      origin: [...(config.ALLOWED_ORIGINS || [])],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest: async (req: any, callback: any) => {
      // getSocketRequestIp, NOT getRawRequestIp: behind the Cloudflare Tunnel the
      // raw socket peer is 127.0.0.1 for every user, which collapsed this per-IP
      // limiter into a single shared bucket and capped the WHOLE app at
      // SOCKET_CONNECT_RATE_LIMIT new websockets per window (300/60s by default).
      const ip = getSocketRequestIp(req);
      const withinLimit = await consumeSocketConnectRateLimitAsync(ip);
      if (!withinLimit) {
        callback('Connection rate limit exceeded', false);
        return;
      }
      let url: URL;
      try {
        url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      } catch {
        callback('Invalid request URL', false);
        return;
      }
      const queryToken = url.searchParams.get('token');
      const authHeader = req.headers.authorization;
      const isValidQueryToken = queryToken && /^[a-f0-9]{32,128}$/i.test(queryToken);
      const isValidBearerAuth = typeof authHeader === 'string'
        && /^Bearer [a-f0-9]{32,128}$/i.test(authHeader);
      const hasMobileAuth = isValidQueryToken || isValidBearerAuth;
      if (hasMobileAuth) {
        // Validate token against session store if available
        const rawToken = isValidQueryToken
          ? queryToken
          : (authHeader as string).slice(7); // strip 'Bearer '
        if (stores?.sessions && hashSessionToken) {
          try {
            const tokenHash = hashSessionToken(rawToken);
            const session = await stores.sessions.getByTokenHash(tokenHash);
            if (!session) {
              callback('Invalid session token', false);
              return;
            }
          } catch (err: any) {
            // If session lookup fails, allow connection but log the error.
            // The post-connection auth timeout will disconnect if they can't
            // authenticate within the window.
            log.warn('socket:session-check-failed', { error: err.message });
          }
        }
        callback(null, true);
        return;
      }
      const allowed = isAllowedOrigin(req.headers.origin, req.headers.host);
      if (!allowed) {
        callback('Origin not allowed', false);
        return;
      }
      callback(null, true);
    },
  });

  // Attach Redis adapter for multi-instance Socket.IO broadcasting
  if (redis) {
    try {
      // BOTH sides must be duplicates. Passing the main client as pubClient —
      // which this did until 2026-08-22 — routes every outbound broadcast through
      // a connection with enableOfflineQueue:false, and the adapter drops the
      // publish promise on the floor (redis-adapter index.js:473 and ~10 sibling
      // call sites: `this.pubClient.publish(channel, msg)`, no callback, no
      // .catch). So the first presence:update / pick:set / location:peer-update
      // emitted during ANY Redis blip rejects instantly with "Stream isn't
      // writeable...", goes unhandled, and this app turns an unhandled rejection
      // into a shutdown — the new worker then broadcasts and dies the same way.
      //
      // That needed only a Redis restart under traffic, not a deploy, which made
      // it strictly worse than the boot-time bug that caused the 2026-08-19
      // outage. It stayed invisible because Redis had not restarted under load
      // since the adapter was attached.
      //
      // The publish connection gets a REAL error logger rather than
      // duplicateClient's default swallow: it carries all outbound broadcast
      // traffic, so silent failure there is indistinguishable from silence.
      const pubClient = duplicateClient(redis, (err: any) => {
        log.warn('socket.io redis pub client error', { error: err?.message, code: err?.code });
      });
      const subClient = duplicateClient(redis);
      io.adapter(createAdapter(pubClient, subClient, { key: 'fp-sio' }));
      log.info('socket.io redis adapter attached');
    } catch (err: any) {
      log.warn('socket.io redis adapter failed, using in-memory', { error: err.message });
    }
  }

  // Initialize push notification service (no-op if FIREBASE_CREDENTIALS_PATH is unset)
  const notificationService = createNotificationService({ stores, config, log, io, promMetrics });

  // Centralized event emitter for Socket.IO + push notifications
  const emitter = createSocketEmitter({
    io, log, notificationService, buildAvatarUrl, getUserById,
  });

  // Post-connection auth timeout: sockets must authenticate (join a festival
  // room) within 5 seconds or get disconnected. This prevents unauthenticated
  // sockets from lingering and consuming server resources.
  const AUTH_TIMEOUT_MS = 5_000;
  io.on('connection', (socket: any) => {
    const authTimer = setTimeout(() => {
      if (!socket.authenticated) {
        log.warn('socket:auth-timeout', { socketId: socket.id, reason: 'No join:festival within 5s' });
        socket.disconnect(true);
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    socket.once('disconnect', () => clearTimeout(authTimer));
  });

  return { server, io, emitter, notificationService };
}

export { configureSocketIO };
