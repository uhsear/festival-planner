/**
 * Request helpers — IP resolution, origin allow-listing, CSRF guard.
 *
 * Extracted from `lib/app-context/index.js` during sprint-6. All the
 * functions in this module are pure-ish: they read the current request
 * and config, and either return a value or call `next()` / `sendError()`.
 * They share NO closures with the rest of the composer, which is why
 * this cut is safe to make.
 *
 * Notes on behaviour preservation:
 *   - `MUTATING_METHODS`, `TRUSTED_MUTATION_HEADER`, `TRUSTED_MUTATION_VALUE`
 *     are declared here (previously at module top of index.js). They
 *     remain re-exported on the context object for byte-identical
 *     downstream consumption.
 *   - `getRequestIp` consults `cf-connecting-ip` and `x-forwarded-for`
 *     only when `config.TRUST_PROXY` is truthy — unchanged.
 */
import net from 'net';

import { parseCookies } from '../helpers';

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const TRUSTED_MUTATION_HEADER = 'x-festie-request';
export const TRUSTED_MUTATION_VALUE = '1';

/**
 * Build request helpers bound to the given config + logger + response helpers.
 */
export function createRequestHelpers({ config, log, sendError, ErrorCodes }: { config: any; log: any; sendError: any; ErrorCodes: any }) {
  function getRequestIp(req: any) {
    const candidates: any[] = [];
    if (config.TRUST_PROXY) {
      candidates.push(req.get('cf-connecting-ip'));
      candidates.push(String(req.get('x-forwarded-for') || '').split(',')[0]!.trim());
    }
    candidates.push(req.ip, req.connection?.remoteAddress, req.socket?.remoteAddress);
    for (const candidate of candidates) {
      if (candidate && net.isIP(candidate)) return candidate;
    }
    return 'unknown';
  }

  function getRawRequestIp(req: any) {
    const candidates = [req.socket?.remoteAddress, req.connection?.remoteAddress];
    for (const candidate of candidates) {
      if (candidate && net.isIP(candidate)) return candidate;
    }
    return 'unknown';
  }

  function isAllowedOrigin(origin: any, host: any) {
    if (!origin) return true;
    try {
      const originUrl = new URL(origin);
      if (host && originUrl.host === host) return true;
      return config.ALLOWED_ORIGINS.includes(origin);
    } catch {
      return false;
    }
  }

  function hasTrustedMutationHeader(req: any) {
    return req.get(TRUSTED_MUTATION_HEADER) === TRUSTED_MUTATION_VALUE;
  }

  function hasBearerToken(req: any) {
    const authHeader = req.headers.authorization;
    return typeof authHeader === 'string' && authHeader.startsWith('Bearer ') && authHeader.length > 7;
  }

  function hasDirectAuthHeader(req: any) {
    return Boolean(req.get('x-user-token') || req.get('x-admin-token') || hasBearerToken(req));
  }

  function hasSessionCookie(req: any) {
    const cookies = parseCookies(req.headers.cookie);
    return Boolean(cookies[config.USER_SESSION_COOKIE] || cookies[config.ADMIN_SESSION_COOKIE]);
  }

  function enforceAllowedOrigin(req: any, res: any, next: any) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    if (hasBearerToken(req)) return next();
    const origin = req.headers.origin;
    if (origin) {
      if (isAllowedOrigin(origin, req.get('host'))) return next();
      log.warn('csrf:origin-blocked', { origin, host: req.get('host'), method: req.method, path: req.path });
      return sendError(res, 403, 'Invalid origin', ErrorCodes.FORBIDDEN);
    }
    if (hasDirectAuthHeader(req) || hasTrustedMutationHeader(req)) return next();
    if (!hasSessionCookie(req)) return next();
    log.warn('csrf:missing-origin', { method: req.method, path: req.path, ip: getRequestIp(req) });
    return sendError(res, 403, 'Missing trusted origin', ErrorCodes.FORBIDDEN);
  }

  return {
    getRequestIp,
    getRawRequestIp,
    isAllowedOrigin,
    hasBearerToken,
    hasDirectAuthHeader,
    hasSessionCookie,
    enforceAllowedOrigin,
  };
}
