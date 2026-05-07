'use strict';
/**
 * Socket.IO server creation, Redis adapter, notification service, event emitter.
 */
const http = require('http');
const { Server } = require('socket.io');

const { createNotificationService } = require('./notifications');
const { createSocketEmitter } = require('./emitter');

/**
 * Create HTTP server, configure Socket.IO with Redis adapter, init push notifications.
 * @param {import('express').Application} app
 * @param {object} ctx - App context from createAppContext
 * @returns {{ server, io, emitter, notificationService }}
 */
function configureSocketIO(app, ctx) {
  const {
    config, log, redis, stores,
    getRawRequestIp, isAllowedOrigin,
    consumeSocketConnectRateLimitAsync,
    buildAvatarUrl, getUserById,
  } = ctx;

  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  const io = new Server(server, {
    transports: ['websocket'],
    pingTimeout: 60_000,
    pingInterval: 25_000,
    maxHttpBufferSize: 1e5,
    cors: {
      origin: [...(config.ALLOWED_ORIGINS || [])],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest: async (req, callback) => {
      const ip = getRawRequestIp(req);
      const withinLimit = await consumeSocketConnectRateLimitAsync(ip);
      if (!withinLimit) {
        callback('Connection rate limit exceeded', false);
        return;
      }
      let url;
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
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { duplicateClient } = require('./redis');
      const pubClient = redis;
      const subClient = duplicateClient(redis);
      io.adapter(createAdapter(pubClient, subClient, { key: 'fp-sio' }));
      log.info('socket.io redis adapter attached');
    } catch (err) {
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
  // room) within 10 seconds or get disconnected. This prevents unauthenticated
  // sockets from lingering and consuming server resources.
  const AUTH_TIMEOUT_MS = 10_000;
  io.on('connection', (socket) => {
    const authTimer = setTimeout(() => {
      if (!socket.authenticated) {
        log.warn('socket:auth-timeout', { socketId: socket.id, reason: 'No join:festival within 10s' });
        socket.disconnect(true);
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    socket.once('disconnect', () => clearTimeout(authTimer));
  });

  return { server, io, emitter, notificationService };
}

module.exports = { configureSocketIO };
