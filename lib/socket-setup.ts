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
    getRawRequestIp, isAllowedOrigin,
    consumeSocketConnectRateLimitAsync,
    buildAvatarUrl, getUserById,
    hashSessionToken,
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
      const ip = getRawRequestIp(req);
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
      const pubClient = redis;
      const subClient = duplicateClient(redis);
      io.adapter(createAdapter(pubClient, subClient, { key: 'fp-sio' }));
      log.info('socket.io redis adapter attached');
    } catch (err: any) {
      log.warn('socket.io redis adapter failed, using in-memory', { error: err.message });
    }
  }

  // Initialize push notification service (no-op if FIREBASE_CREDENTIALS_PATH is unset)
  const notificationService = createNotificationService({ stores, config, log, io });

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
