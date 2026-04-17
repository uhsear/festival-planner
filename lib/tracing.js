'use strict';

const crypto = require('crypto');

/**
 * Generate a unique trace ID.
 * Format: timestamp-random hex (e.g., "1710518400000-a1b2c3d4e5f6")
 * @returns {string} Unique trace ID
 */
function generateTraceId() {
  const timestamp = Date.now();
  const randomPart = crypto.randomBytes(6).toString('hex');
  return `${timestamp}-${randomPart}`;
}

/**
 * Parse X-Trace-ID header or generate new one.
 * @param {string} headerValue - X-Trace-ID header value
 * @returns {string} Trace ID
 */
function resolveTraceId(headerValue) {
  if (typeof headerValue === 'string' && headerValue.length > 0 && headerValue.length <= 64) {
    // Basic validation: alphanumeric, dash, underscore only
    if (/^[a-zA-Z0-9_-]+$/.test(headerValue)) {
      return headerValue;
    }
  }
  return generateTraceId();
}

/**
 * Create Express middleware for distributed request tracing.
 * Reads X-Trace-ID from request or generates one, stores in req.traceId,
 * and adds it to response header.
 * @returns {Function} Express middleware
 */
function createTracingMiddleware() {
  return (req, res, next) => {
    // Resolve trace ID from header or generate
    const headerValue = req.get('X-Trace-ID');
    req.traceId = resolveTraceId(headerValue);

    // Add to response header
    res.set('X-Trace-ID', req.traceId);

    next();
  };
}

/**
 * Propagate trace ID to socket.data.
 * Safely attaches traceId to socket.data for inclusion in events.
 * @param {object} socket - Socket.IO socket object
 * @param {string} traceId - Trace ID to propagate
 */
function propagateTraceId(socket, traceId) {
  if (!socket || !socket.data) return;
  if (typeof traceId === 'string' && traceId.length > 0) {
    socket.data.traceId = traceId;
  }
}

/**
 * Include trace ID in object (for logging/metadata).
 * @param {object} obj - Object to augment
 * @param {string} traceId - Trace ID
 * @returns {object} Same object with traceId added
 */
function augmentWithTraceId(obj, traceId) {
  if (!obj || typeof obj !== 'object') return obj;
  if (typeof traceId === 'string' && traceId.length > 0) {
    obj.traceId = traceId;
  }
  return obj;
}

module.exports = {
  generateTraceId,
  resolveTraceId,
  createTracingMiddleware,
  propagateTraceId,
  augmentWithTraceId,
};
