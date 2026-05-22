import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Generate a unique trace ID.
 * Format: timestamp-random hex (e.g., "1710518400000-a1b2c3d4e5f6")
 */
export function generateTraceId(): string {
  const timestamp = Date.now();
  const randomPart = randomBytes(6).toString('hex');
  return `${timestamp}-${randomPart}`;
}

/**
 * Parse X-Trace-ID header or generate new one.
 */
export function resolveTraceId(headerValue: any): string {
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
 */
export function createTracingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Resolve trace ID from header or generate
    const headerValue = req.get('X-Trace-ID');
    (req as any).traceId = resolveTraceId(headerValue);

    // Add to response header
    res.set('X-Trace-ID', (req as any).traceId);

    next();
  };
}

/**
 * Propagate trace ID to socket.data.
 * Safely attaches traceId to socket.data for inclusion in events.
 */
export function propagateTraceId(socket: any, traceId: string): void {
  if (!socket || !socket.data) return;
  if (typeof traceId === 'string' && traceId.length > 0) {
    socket.data.traceId = traceId;
  }
}

/**
 * Include trace ID in object (for logging/metadata).
 */
export function augmentWithTraceId(obj: any, traceId: string): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (typeof traceId === 'string' && traceId.length > 0) {
    obj.traceId = traceId;
  }
  return obj;
}
