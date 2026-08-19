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
 *   - `getRequestIp` IP-resolution contract (TRUST_PROXY hardening, 2026-06-02):
 *       When `config.TRUST_PROXY` is truthy the origin is only reachable behind
 *       the trusted edge (Cloudflare → loopback tunnel), so we trust ONLY a
 *       `net.isIP`-validated `cf-connecting-ip`, then fall back to the raw socket
 *       peer. We do NOT read `req.ip` in this branch (it is itself derived from
 *       `x-forwarded-for` under Express trust-proxy and therefore spoofable) and
 *       we do NOT consult `x-forwarded-for` at all — a client cannot move its
 *       rate-limit / audit key by forging XFF.
 *       When `config.TRUST_PROXY` is falsy (local dev) behaviour is unchanged:
 *       use `req.ip` plus the socket addresses, never proxy headers.
 *     See docs/security/trust-proxy-hardening.md.
 */
import net from 'net';

import { parseCookies } from '../helpers';

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const TRUSTED_MUTATION_HEADER = 'x-festie-request';
export const TRUSTED_MUTATION_VALUE = '1';

/**
 * Build request helpers bound to the given config + logger + response helpers.
 */
export function createRequestHelpers({
  config,
  log,
  sendError,
  ErrorCodes,
}: {
  config: any;
  log: any;
  sendError: any;
  ErrorCodes: any;
}) {
  function getRequestIp(req: any) {
    const candidates: any[] = [];
    if (config.TRUST_PROXY) {
      // Behind the trusted edge: trust ONLY a validated cf-connecting-ip,
      // then the raw socket peer. Never req.ip (XFF-derived) or x-forwarded-for
      // (forgeable) — a client must not be able to move its key via headers.
      candidates.push(req.get('cf-connecting-ip'));
      candidates.push(req.socket?.remoteAddress, req.connection?.remoteAddress);
    } else {
      // Local dev: no proxy in front, trust Express's req.ip + socket addresses.
      candidates.push(req.ip, req.connection?.remoteAddress, req.socket?.remoteAddress);
    }
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

  /**
   * Client IP for a raw Node IncomingMessage — i.e. the Socket.IO `allowRequest`
   * handshake, which is NOT an Express request and so has no `req.get()`.
   *
   * Same trust model as getRequestIp: behind the trusted edge, believe only
   * Cloudflare's `cf-connecting-ip` (Cloudflare overwrites it, and the origin
   * binds to loopback so nothing reaches it except through the tunnel), then the
   * raw socket peer. `x-forwarded-for` is never consulted — it is client-forgeable
   * and would let a caller move its own rate-limit key.
   *
   * This exists because using getRawRequestIp here was a production bug: behind the
   * Cloudflare Tunnel the socket peer is 127.0.0.1 for EVERY user, so the
   * per-IP socket connect limiter collapsed into ONE shared bucket and capped the
   * whole app at SOCKET_CONNECT_RATE_LIMIT new websockets per window. Measured
   * 2026-08-19: connections from two different public IPs shared one 30/60s budget
   * — a second machine was refused immediately after the first exhausted it, and
   * connected fine once the window cleared.
   */
  function getSocketRequestIp(req: any) {
    const candidates: any[] = [];
    if (config.TRUST_PROXY) {
      const cf = req.headers?.['cf-connecting-ip'];
      candidates.push(Array.isArray(cf) ? cf[0] : cf);
    }
    candidates.push(req.socket?.remoteAddress, req.connection?.remoteAddress);
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

  // Paths that are explicitly exempt from CSRF origin enforcement.
  // Must be fire-and-forget, unauthenticated, and already hardened at the
  // route level (rate-limited, no auth, no DB writes, strict input validation).
  const ORIGIN_EXEMPT_PATHS = new Set([
    '/api/v1/metrics/web-vitals', // sendBeacon sends Origin: null in opaque contexts
  ]);

  function enforceAllowedOrigin(req: any, res: any, next: any) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    // Beacon endpoints: sendBeacon can send Origin: null (opaque origin) in some
    // browser contexts. These routes are already locked down at the route level
    // (rate-limited, no auth, no DB writes, 204 always) so CSRF origin enforcement
    // is not needed and would silently drop legitimate metrics.
    if (ORIGIN_EXEMPT_PATHS.has(req.path)) return next();
    // L8/H4 (server defense): only exempt *true* Bearer-only clients (mobile,
    // which never sends a session cookie). A request that carries BOTH a Bearer
    // header and a session cookie is a browser — keep enforcing Origin so a
    // hijacked/leaked Bearer header can't be used to bypass CSRF protection on
    // cookie-authenticated browser requests.
    if (hasBearerToken(req) && !hasSessionCookie(req)) return next();
    const origin = req.headers.origin;
    if (origin) {
      if (isAllowedOrigin(origin, req.get('host'))) return next();
      log.warn('csrf:origin-blocked', { origin, host: req.get('host'), method: req.method, path: req.path });
      return sendError(res, 403, 'Invalid origin', ErrorCodes.FORBIDDEN);
    }
    // No Origin header below this point.
    const hasCookie = hasSessionCookie(req);
    // L8/H4: a direct auth header (incl. Bearer) only grants the Origin-less
    // exemption when the client is NOT also presenting a session cookie. With a
    // cookie present the request is browser-originated, so a forged/leaked
    // header must not be allowed to bypass Origin enforcement; only the SPA's
    // own trusted-mutation header (which a cross-site attacker cannot set on a
    // simple request) is honored in that case.
    if (!hasCookie && hasDirectAuthHeader(req)) return next();
    if (hasTrustedMutationHeader(req)) return next();
    if (!hasCookie) return next();
    log.warn('csrf:missing-origin', { method: req.method, path: req.path, ip: getRequestIp(req) });
    return sendError(res, 403, 'Missing trusted origin', ErrorCodes.FORBIDDEN);
  }

  return {
    getRequestIp,
    getRawRequestIp,
    getSocketRequestIp,
    isAllowedOrigin,
    hasBearerToken,
    hasDirectAuthHeader,
    hasSessionCookie,
    enforceAllowedOrigin,
  };
}
