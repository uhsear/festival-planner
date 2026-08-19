import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import { DEFAULTS, loadConfig } from '../lib/config.js';

// Helpers to isolate env vars between tests
const envSnapshot: Record<string, string | undefined> = {};
function saveEnv(...keys: string[]) {
  for (const k of keys) {
    envSnapshot[k] = process.env[k];
    delete process.env[k];
  }
}
function restoreEnv() {
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('config: DEFAULTS object', () => {
  it('has expected numeric defaults', () => {
    assert.equal(DEFAULTS.PORT, 4000);
    assert.equal(DEFAULTS.RATE_LIMIT_WINDOW, 60000);
    assert.equal(DEFAULTS.RATE_LIMIT_MAX, 120);
    assert.equal(DEFAULTS.SESSION_TTL, 86400000);
    assert.equal(DEFAULTS.MAX_USERS, 200);
    assert.equal(DEFAULTS.MAX_STAGES, 20);
    assert.equal(DEFAULTS.MAX_DAYS, 10);
    assert.equal(DEFAULTS.MAX_SETS_PER_DAY, 200);
    // Shared festival wifi/CGNAT put many real users behind one IP; must stay
    // generous so a silent regression doesn't throttle legitimate crews.
    assert.equal(DEFAULTS.SOCKET_CONNECT_RATE_LIMIT, 300);
    assert.equal(DEFAULTS.SOCKET_CONNECT_WINDOW, 60000);
  });

  it('has string defaults', () => {
    assert.equal(DEFAULTS.JSON_LIMIT, '256kb');
    assert.equal(DEFAULTS.API_VERSION, '1');
    assert.equal(DEFAULTS.REDIS_PREFIX, 'fp:');
  });

  it('has avatar defaults', () => {
    assert.equal(DEFAULTS.AVATAR_SIZE, 256);
    assert.equal(DEFAULTS.AVATAR_MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
    assert.equal(DEFAULTS.AVATAR_WEBP_QUALITY, 82);
  });
});

describe('config: loadConfig basics', () => {
  afterEach(restoreEnv);

  it('returns default PORT when no override', () => {
    saveEnv('PORT', 'NODE_ENV');
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.PORT, 4000);
  });

  it('applies override PORT as string', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: '9090' });
    assert.equal(config.PORT, 9090);
  });

  it('applies override PORT as number', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: 5555 });
    assert.equal(config.PORT, 5555);
  });

  it('falls back to default for invalid PORT', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: 'not-a-number' });
    assert.equal(config.PORT, DEFAULTS.PORT);
  });

  it('clamps PORT below min to default', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: '0' });
    assert.equal(config.PORT, DEFAULTS.PORT);
  });

  it('clamps PORT above max to default', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: '99999' });
    assert.equal(config.PORT, DEFAULTS.PORT);
  });

  it('sets NODE_ENV from override', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', NODE_ENV: 'production' });
    assert.equal(config.NODE_ENV, 'production');
  });

  it('defaults NODE_ENV to development', () => {
    saveEnv('NODE_ENV');
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.NODE_ENV, 'development');
  });
});

describe('config: PUBLIC_ORIGIN and COOKIE_SECURE', () => {
  it('sets COOKIE_SECURE true for https origin', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: 'https://festie.us' });
    assert.equal(config.COOKIE_SECURE, true);
  });

  it('sets COOKIE_SECURE false for http origin', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: 'http://localhost:4000' });
    assert.equal(config.COOKIE_SECURE, false);
  });

  it('sets COOKIE_SECURE false for empty origin', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.COOKIE_SECURE, false);
  });

  it('includes PUBLIC_ORIGIN in ALLOWED_ORIGINS', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: 'https://example.com' });
    assert.ok(config.ALLOWED_ORIGINS.includes('https://example.com'));
  });

  it('merges ALLOWED_ORIGINS from override', () => {
    const config = loadConfig({
      PUBLIC_ORIGIN: 'https://main.com',
      ALLOWED_ORIGINS: 'https://alt1.com,https://alt2.com',
    });
    assert.ok(config.ALLOWED_ORIGINS.includes('https://main.com'));
    assert.ok(config.ALLOWED_ORIGINS.includes('https://alt1.com'));
    assert.ok(config.ALLOWED_ORIGINS.includes('https://alt2.com'));
  });
});

describe('config: COOKIE_SAME_SITE normalization', () => {
  it('defaults to lax', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.COOKIE_SAME_SITE, 'lax');
  });

  it('normalizes Strict to strict', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', COOKIE_SAME_SITE: 'Strict' });
    assert.equal(config.COOKIE_SAME_SITE, 'strict');
  });

  it('normalizes None to none', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', COOKIE_SAME_SITE: 'None' });
    assert.equal(config.COOKIE_SAME_SITE, 'none');
  });

  it('normalizes unknown values to lax', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', COOKIE_SAME_SITE: 'invalid' });
    assert.equal(config.COOKIE_SAME_SITE, 'lax');
  });
});

describe('config: readInt behavior via loadConfig', () => {
  it('parses string integers for rate limits', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', RATE_LIMIT_MAX: '500' });
    assert.equal(config.RATE_LIMIT_MAX, 500);
  });

  it('falls back to default for NaN rate limit', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', RATE_LIMIT_MAX: 'abc' });
    assert.equal(config.RATE_LIMIT_MAX, DEFAULTS.RATE_LIMIT_MAX);
  });

  it('clamps PG_POOL_MAX within bounds (2-50)', () => {
    const low = loadConfig({ PUBLIC_ORIGIN: '', PG_POOL_MAX: '1' });
    assert.equal(low.PG_POOL_MAX, DEFAULTS.PG_POOL_MAX); // 1 < min 2

    const high = loadConfig({ PUBLIC_ORIGIN: '', PG_POOL_MAX: '100' });
    assert.equal(high.PG_POOL_MAX, DEFAULTS.PG_POOL_MAX); // 100 > max 50

    const valid = loadConfig({ PUBLIC_ORIGIN: '', PG_POOL_MAX: '30' });
    assert.equal(valid.PG_POOL_MAX, 30);
  });
});

describe('config: readBool behavior via loadConfig', () => {
  it('reads REDIS_ENABLED true by default', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.REDIS_ENABLED, true);
  });

  it('parses false string for REDIS_ENABLED', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', REDIS_ENABLED: 'false' });
    assert.equal(config.REDIS_ENABLED, false);
  });

  it('parses 0 string for REDIS_ENABLED', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', REDIS_ENABLED: '0' });
    assert.equal(config.REDIS_ENABLED, false);
  });

  it('parses yes string for REDIS_ENABLED', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', REDIS_ENABLED: 'yes' });
    assert.equal(config.REDIS_ENABLED, true);
  });
});

describe('config: readList behavior via loadConfig', () => {
  it('parses comma-separated MOBILE_ORIGINS', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', MOBILE_ORIGINS: 'app://festie,app://test' });
    assert.deepEqual(config.MOBILE_ORIGINS, ['app://festie', 'app://test']);
  });

  it('returns empty array for empty MOBILE_ORIGINS', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', MOBILE_ORIGINS: '' });
    assert.deepEqual(config.MOBILE_ORIGINS, []);
  });

  it('trims whitespace from list items', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', MOBILE_ORIGINS: ' a , b , c ' });
    assert.deepEqual(config.MOBILE_ORIGINS, ['a', 'b', 'c']);
  });

  it('filters out empty items', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', MOBILE_ORIGINS: 'a,,b,,,c' });
    assert.deepEqual(config.MOBILE_ORIGINS, ['a', 'b', 'c']);
  });
});

describe('config: readTrustProxy behavior via loadConfig', () => {
  it('defaults to false', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.TRUST_PROXY, false);
  });

  it('parses true string', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: 'true' });
    assert.equal(config.TRUST_PROXY, true);
  });

  it('parses numeric string (hop count)', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: '2' });
    assert.equal(config.TRUST_PROXY, 2);
  });

  it('parses false string', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: 'false' });
    assert.equal(config.TRUST_PROXY, false);
  });

  it('passes through the loopback preset string', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: 'loopback' });
    assert.equal(config.TRUST_PROXY, 'loopback');
  });

  it('passes through linklocal/uniquelocal presets case-insensitively', () => {
    assert.equal(loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: 'linklocal' }).TRUST_PROXY, 'linklocal');
    assert.equal(loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: 'Uniquelocal' }).TRUST_PROXY, 'uniquelocal');
  });
});

describe('config: string fields', () => {
  it('sets default cookie names', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.USER_SESSION_COOKIE, 'festie_session');
    assert.equal(config.ADMIN_SESSION_COOKIE, 'festival_admin_session');
  });

  it('allows override of cookie names', () => {
    const config = loadConfig({
      PUBLIC_ORIGIN: '',
      USER_SESSION_COOKIE: 'my_sess',
      ADMIN_SESSION_COOKIE: 'my_admin',
    });
    assert.equal(config.USER_SESSION_COOKIE, 'my_sess');
    assert.equal(config.ADMIN_SESSION_COOKIE, 'my_admin');
  });

  it('has an APP_VERSION field', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(typeof config.APP_VERSION, 'string');
  });
});
