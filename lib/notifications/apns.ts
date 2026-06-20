// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Minimal, dependency-light APNs (Apple Push Notification service) provider.
 *
 * Why this exists: the mobile app registers its push token via expo's
 * `getDevicePushTokenAsync()`, which returns an FCM token on Android but a RAW
 * APNs device token on iOS. firebase-admin cannot send to a raw APNs token — it
 * rejects with `invalid-argument`, which the FCM path treats as a stale token
 * and unregisters. So iOS push was both failing AND deleting valid tokens.
 *
 * This module sends directly to Apple over HTTP/2 using provider-token (JWT)
 * auth signed with an ES256 .p8 key. It uses only node built-ins (`crypto`,
 * `http2`) — no new npm dependency.
 *
 * Everything here is fully guarded by `isApnsConfigured`: with no key configured
 * the module is inert and callers must fall back to (or skip) other transports.
 */

import crypto from 'crypto';
import fs from 'fs';
import http2 from 'http2';

const PRODUCTION_HOST = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';

// Apple requires the provider token be refreshed at least every 60 min and
// rejects refreshes more frequent than every 20 min. We refresh at ~50 min.
const TOKEN_REFRESH_MS = 50 * 60 * 1000;

// Keep the HTTP/2 session alive for connection reuse (mirrors the _fcmAgent pattern).
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApnsConfig {
  APNS_KEY_PATH?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_PRODUCTION?: boolean;
}

export interface ApnsResult {
  sent: boolean;
  stale: boolean;
  error?: string;
}

export interface ApnsSendOpts {
  /** APNs push type: 'alert' (default) or 'background' for silent sync. */
  pushType?: 'alert' | 'background';
  /** APNs priority: '10' for alerts, '5' for background. */
  priority?: '10' | '5';
  /** Optional collapse id (maps to apns-collapse-id; we use threadId). */
  collapseId?: string | null;
}

/**
 * True when all required APNs credentials are present. When false the provider
 * is disabled and callers must not attempt APNs sends.
 */
export function isApnsConfigured(config: ApnsConfig | null | undefined): boolean {
  return Boolean(config && config.APNS_KEY_PATH && config.APNS_KEY_ID && config.APNS_TEAM_ID && config.APNS_BUNDLE_ID);
}

/** base64url-encode a Buffer or string (no padding). */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign an APNs provider JWT (ES256) with the given .p8 key.
 *   header  = { alg: 'ES256', kid: APNS_KEY_ID }
 *   payload = { iss: APNS_TEAM_ID, iat: <unix seconds> }
 * The ES256 signature must be a raw 64-byte (r||s) value, NOT DER — so we ask
 * node for the IEEE-P1363 ("jose") encoding.
 */
export function signApnsToken(
  privateKeyPem: string | Buffer,
  keyId: string,
  teamId: string,
  iat: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat }));
  const signingInput = `${header}.${payload}`;

  const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Map an APNs HTTP response (status + body reason) to a normalized result.
 * 410 Unregistered and 400 BadDeviceToken / DeviceTokenNotForTopic mean the
 * token is stale and should be cleaned up.
 */
export function classifyApnsResponse(status: number, reason: string): ApnsResult {
  if (status === 200) return { sent: true, stale: false };

  const stale =
    status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'));

  return { sent: false, stale, error: reason || `apns_status_${status}` };
}

/**
 * Internal provider instance — holds the cached token + live HTTP/2 session.
 * Created lazily so importing this module is side-effect free.
 */
interface ApnsProvider {
  send(deviceToken: string, payload: any, opts?: ApnsSendOpts): Promise<ApnsResult>;
  close(): void;
  /** test seam — clears the cached token so the next send re-signs */
  _resetTokenCache(): void;
}

function readPrivateKey(config: ApnsConfig): string {
  // .p8 path comes from env only — never embed a key in code.
  return fs.readFileSync(config.APNS_KEY_PATH as string, 'utf8');
}

/**
 * Create an APNs provider. `http2Impl` is injectable for tests so we never make
 * a real network call. `keyLoader` is injectable so tests can supply a key
 * without touching the filesystem.
 */
export function createApnsProvider(
  config: ApnsConfig,
  log: any = console,
  deps: { http2?: typeof http2; keyLoader?: (c: ApnsConfig) => string } = {},
): ApnsProvider {
  const http2Impl = deps.http2 || http2;
  const keyLoader = deps.keyLoader || readPrivateKey;
  const host = config.APNS_PRODUCTION === false ? SANDBOX_HOST : PRODUCTION_HOST;

  let privateKey: string | null = null;
  let cachedToken: string | null = null;
  let cachedTokenAt = 0;
  let session: any = null;

  function getPrivateKey(): string {
    if (privateKey == null) privateKey = keyLoader(config);
    return privateKey;
  }

  function getToken(): string {
    const now = Date.now();
    if (cachedToken && now - cachedTokenAt < TOKEN_REFRESH_MS) return cachedToken;
    cachedToken = signApnsToken(
      getPrivateKey(),
      config.APNS_KEY_ID as string,
      config.APNS_TEAM_ID as string,
      Math.floor(now / 1000),
    );
    cachedTokenAt = now;
    return cachedToken;
  }

  function getSession(): any {
    if (session && !session.closed && !session.destroyed) return session;
    session = http2Impl.connect(host);
    session.setTimeout?.(SESSION_TIMEOUT_MS, () => {
      try {
        session.close();
      } catch {
        /* noop */
      }
    });
    session.on('error', (err: any) => {
      log.debug?.('apns session error', { error: err && err.message });
      session = null;
    });
    return session;
  }

  /**
   * Send a push to one device.
   * @param deviceToken raw APNs hex device token
   * @param payload full APNs payload object: { aps: {...}, ...customData }
   *   (the `aps` dictionary plus any sibling custom keys, per Apple's spec)
   */
  function send(deviceToken: string, payload: any, opts: ApnsSendOpts = {}): Promise<ApnsResult> {
    return new Promise((resolve) => {
      let s: any;
      try {
        s = getSession();
      } catch (err: any) {
        resolve({ sent: false, stale: false, error: err && err.message });
        return;
      }

      const headers: Record<string, string> = {
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${getToken()}`,
        'apns-topic': config.APNS_BUNDLE_ID as string,
        'apns-push-type': opts.pushType || 'alert',
        'apns-priority': opts.priority || '10',
      };
      if (opts.collapseId) headers['apns-collapse-id'] = String(opts.collapseId).slice(0, 64);

      let req: any;
      try {
        req = s.request(headers);
      } catch (err: any) {
        resolve({ sent: false, stale: false, error: err && err.message });
        return;
      }

      let status = 0;
      let body = '';
      let settled = false;
      const done = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      req.setTimeout?.(REQUEST_TIMEOUT_MS, () => {
        try {
          req.close();
        } catch {
          /* noop */
        }
        done({ sent: false, stale: false, error: 'apns_timeout' });
      });

      req.on('response', (resHeaders: any) => {
        status = Number(resHeaders[':status']) || 0;
      });
      req.on('data', (chunk: any) => {
        body += chunk;
      });
      req.on('end', () => {
        let reason = '';
        if (body) {
          try {
            reason = JSON.parse(body).reason || '';
          } catch {
            /* non-JSON body */
          }
        }
        done(classifyApnsResponse(status, reason));
      });
      req.on('error', (err: any) => {
        done({ sent: false, stale: false, error: err && err.message });
      });

      try {
        req.end(JSON.stringify(payload));
      } catch (err: any) {
        done({ sent: false, stale: false, error: err && err.message });
      }
    });
  }

  function close(): void {
    if (session) {
      try {
        session.close();
      } catch {
        /* noop */
      }
      session = null;
    }
  }

  function _resetTokenCache(): void {
    cachedToken = null;
    cachedTokenAt = 0;
  }

  return { send, close, _resetTokenCache };
}

/**
 * Lazy singleton accessor. Returns a provider only when APNs is configured,
 * otherwise null. The provider is built once per config identity.
 */
let _provider: ApnsProvider | null = null;
let _providerKey: string | null = null;

export function getApnsProvider(config: ApnsConfig, log: any = console): ApnsProvider | null {
  if (!isApnsConfigured(config)) return null;
  const key = `${config.APNS_KEY_PATH}|${config.APNS_KEY_ID}|${config.APNS_TEAM_ID}|${config.APNS_BUNDLE_ID}|${config.APNS_PRODUCTION === false ? 'sandbox' : 'prod'}`;
  if (_provider && _providerKey === key) return _provider;
  _provider = createApnsProvider(config, log);
  _providerKey = key;
  return _provider;
}

/** Reset the lazy singleton (test seam). */
export function _resetApnsProvider(): void {
  if (_provider) _provider.close();
  _provider = null;
  _providerKey = null;
}
