/**
 * Cookie + token-resolution helpers.
 *
 * Extracted from `lib/app-context/index.js` during sprint-6. These are
 * all thin config-bound wrappers around `res.cookie()` / cookie parsing.
 * They share NO closures with auth middleware or the session store —
 * `adminAuth`/`userAuth` in the composer call `resolveRequestToken`,
 * but they do so as a function call, not a closed-over variable, so
 * moving the definitions out costs nothing.
 *
 * `setNoStore` is included here because it is the cache-header sibling
 * of `setSessionCookie` — every auth/mutation handler that sets a
 * session cookie also calls `setNoStore`, so callers tend to want both
 * from the same module.
 */

import { parseCookies } from '../helpers';

/**
 * Build cookie helpers bound to the supplied config.
 */
export function createCookieHelpers({ config }: { config: any }) {
  function setNoStore(res: any) {
    res.setHeader('Cache-Control', 'no-store');
  }

  function setSessionCookie(res: any, cookieName: string, token: string) {
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: config.COOKIE_SAME_SITE,
      secure: config.COOKIE_SECURE,
      maxAge: config.SESSION_TTL,
      path: '/',
    });
  }

  function clearSessionCookie(res: any, cookieName: string) {
    res.clearCookie(cookieName, {
      httpOnly: true,
      sameSite: config.COOKIE_SAME_SITE,
      secure: config.COOKIE_SECURE,
      path: '/',
    });
  }

  /** Legacy cookie name kept for backward-compatible dual-read. */
  const LEGACY_COOKIE_NAME = 'festival_user_session';

  function resolveRequestToken(req: any, headerName: string, cookieName: string) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7).trim();
      if (bearerToken) return { token: bearerToken, source: 'bearer' };
    }
    const headerValue = req.headers[headerName];
    if (typeof headerValue === 'string' && headerValue.trim()) {
      return { token: headerValue.trim(), source: 'header' };
    }
    if (Array.isArray(headerValue) && headerValue[0]) {
      return { token: String(headerValue[0]).trim(), source: 'header' };
    }
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[cookieName];
    if (cookieToken) return { token: cookieToken, source: 'cookie' };
    // Backward compat: honour the legacy cookie name until it expires naturally
    if (cookieName !== LEGACY_COOKIE_NAME) {
      const legacyToken = cookies[LEGACY_COOKIE_NAME];
      if (legacyToken) return { token: legacyToken, source: 'cookie' };
    }
    return { token: null, source: null };
  }

  function resolveSocketToken(socket: any, explicitToken: any, cookieName: string) {
    if (typeof explicitToken === 'string' && explicitToken.trim()) return explicitToken.trim();
    const authToken = socket.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const queryToken = socket.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
    const authHeader = socket.handshake?.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7).trim();
      if (bearerToken) return bearerToken;
    }
    const cookies = parseCookies(socket.handshake?.headers?.cookie);
    // Backward compat: fall back to the legacy cookie name
    return cookies[cookieName]
      || (cookieName !== LEGACY_COOKIE_NAME ? cookies[LEGACY_COOKIE_NAME] : null)
      || null;
  }

  function setUserSessionCookie(res: any, token: string) {
    setSessionCookie(res, config.USER_SESSION_COOKIE, token);
  }

  function clearUserSessionCookie(res: any) {
    clearSessionCookie(res, config.USER_SESSION_COOKIE);
  }

  return {
    setNoStore,
    setSessionCookie,
    clearSessionCookie,
    resolveRequestToken,
    resolveSocketToken,
    setUserSessionCookie,
    clearUserSessionCookie,
  };
}
