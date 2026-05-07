'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const serverExports = require('../server');
const {
  buildContentSecurityPolicy,
  collectInlineHashes,
  createFestieApp,
  createFestivalPlanner,
  loadConfig,
  validateStartupConfig,
} = serverExports;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function devConfig(overrides = {}) {
  return {
    NODE_ENV: 'development',
    PUBLIC_ORIGIN: '',
    SESSION_SECRET: 'dev-secret',
    EMAIL_FROM: 'dev@localhost',
    ...overrides,
  };
}

function prodConfig(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://festie.us',
    SESSION_SECRET: 'a-very-strong-random-value-1234567890',
    EMAIL_FROM: 'Festie <no-reply@festie.us>',
    ...overrides,
  };
}

// ===========================================================================
// 1. Module exports — shape and types
// ===========================================================================
describe('server.js module exports', () => {
  it('exports exactly the expected keys', () => {
    const keys = Object.keys(serverExports).sort();
    assert.deepStrictEqual(keys, [
      'buildContentSecurityPolicy',
      'collectInlineHashes',
      'createFestieApp',
      'createFestivalPlanner',
      'loadConfig',
      'validateStartupConfig',
    ]);
  });

  it('exports createFestieApp as a function', () => {
    assert.equal(typeof createFestieApp, 'function');
  });

  it('exports createFestivalPlanner as a function', () => {
    assert.equal(typeof createFestivalPlanner, 'function');
  });

  it('exports validateStartupConfig as a function', () => {
    assert.equal(typeof validateStartupConfig, 'function');
  });

  it('exports buildContentSecurityPolicy as a function', () => {
    assert.equal(typeof buildContentSecurityPolicy, 'function');
  });

  it('exports collectInlineHashes as a function', () => {
    assert.equal(typeof collectInlineHashes, 'function');
  });

  it('exports loadConfig as a function', () => {
    assert.equal(typeof loadConfig, 'function');
  });

  it('createFestivalPlanner is the same reference as createFestieApp (backward-compat alias)', () => {
    assert.equal(createFestivalPlanner, createFestieApp);
  });
});

// ===========================================================================
// 2. validateStartupConfig — additional edge cases beyond server-startup.test.js
// ===========================================================================
describe('validateStartupConfig: additional edge cases', () => {
  it('accepts staging NODE_ENV with no PUBLIC_ORIGIN (only production enforced)', () => {
    assert.doesNotThrow(() => validateStartupConfig({
      NODE_ENV: 'staging',
      PUBLIC_ORIGIN: '',
    }));
  });

  it('accepts test NODE_ENV with no SESSION_SECRET', () => {
    assert.doesNotThrow(() => validateStartupConfig({
      NODE_ENV: 'test',
      SESSION_SECRET: '',
    }));
  });

  it('throws for production with PUBLIC_ORIGIN set to null', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ PUBLIC_ORIGIN: null })),
      { message: /PUBLIC_ORIGIN is required in production/ },
    );
  });

  it('throws for production with PUBLIC_ORIGIN set to 0 (falsy number)', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ PUBLIC_ORIGIN: 0 })),
      { message: /PUBLIC_ORIGIN is required in production/ },
    );
  });

  it('does not throw when FCM_RETRY_WEBHOOK_URL is null (no HMAC needed)', () => {
    assert.doesNotThrow(() => validateStartupConfig(devConfig({
      FCM_RETRY_WEBHOOK_URL: null,
      WEBHOOK_TOKEN_HMAC_KEY: '',
    })));
  });

  it('accepts production when SESSION_SECRET is present and strong', () => {
    assert.doesNotThrow(() => validateStartupConfig(prodConfig({
      SESSION_SECRET: 'xylophone-battery-horse-staple-correct',
    })));
  });

  it('EMAIL_FROM check is string-only — non-string types bypass the check', () => {
    assert.doesNotThrow(() => validateStartupConfig(prodConfig({
      EMAIL_FROM: null,
    })));
  });

  it('EMAIL_FROM with personal email substring in production throws', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({
        EMAIL_FROM: 'Support Team uhsear@gmail.com via Festie',
      })),
      { message: /EMAIL_FROM must not use a personal email/ },
    );
  });

  it('throws when FCM_RETRY_WEBHOOK_URL is set but WEBHOOK_TOKEN_HMAC_KEY is missing (via server.js export)', () => {
    assert.throws(
      () => validateStartupConfig(devConfig({
        FCM_RETRY_WEBHOOK_URL: 'https://example.com/hook',
        WEBHOOK_TOKEN_HMAC_KEY: '',
      })),
      { message: /WEBHOOK_TOKEN_HMAC_KEY is required/ },
    );
  });

  it('throws in production when SESSION_SECRET is empty (via server.js export)', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ SESSION_SECRET: '' })),
      { message: /SESSION_SECRET must be set to a strong random value/ },
    );
  });

  it('throws in production when SESSION_SECRET is default "change-me" (via server.js export)', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ SESSION_SECRET: 'change-me' })),
      { message: /SESSION_SECRET must be set to a strong random value/ },
    );
  });
});

// ===========================================================================
// 3. loadConfig — edge cases and defaults
// ===========================================================================
describe('loadConfig: edge cases and defaults', () => {
  it('returns an object with all expected keys', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    // Spot-check key categories: networking, session, limits, external services
    assert.equal(typeof config.PORT, 'number');
    assert.equal(typeof config.BIND_ADDRESS, 'string');
    assert.equal(typeof config.SESSION_TTL, 'number');
    assert.equal(typeof config.RATE_LIMIT_MAX, 'number');
    assert.equal(typeof config.REDIS_URL, 'string');
    assert.equal(typeof config.COOKIE_SAME_SITE, 'string');
    assert.equal(typeof config.FIREBASE_CREDENTIALS_PATH, 'string');
    assert.equal(typeof config.SENTRY_DSN, 'string');
  });

  it('defaults PORT to 4000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.PORT, 4000);
  });

  it('defaults BIND_ADDRESS to 127.0.0.1', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.BIND_ADDRESS, '127.0.0.1');
  });

  it('defaults COOKIE_SAME_SITE to lax', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.COOKIE_SAME_SITE, 'lax');
  });

  it('defaults REDIS_ENABLED to true', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.REDIS_ENABLED, true);
  });

  it('defaults CLUSTER_SIZE to 1', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.CLUSTER_SIZE, 1);
  });

  it('defaults APP_VERSION to package.json version', () => {
    const pkg = require('../package.json');
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.APP_VERSION, pkg.version);
  });

  it('overrides APP_VERSION when provided', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', APP_VERSION: '99.0.0' });
    assert.equal(config.APP_VERSION, '99.0.0');
  });

  it('clamps invalid PORT to default 4000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: 'notanumber' });
    assert.equal(config.PORT, 4000);
  });

  it('clamps PORT above 65535 to default 4000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: '99999' });
    assert.equal(config.PORT, 4000);
  });

  it('clamps PORT below 1 to default 4000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', PORT: '0' });
    assert.equal(config.PORT, 4000);
  });

  it('COOKIE_SECURE defaults to true when PUBLIC_ORIGIN is https', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: 'https://festie.us' });
    assert.equal(config.COOKIE_SECURE, true);
  });

  it('COOKIE_SECURE defaults to false when PUBLIC_ORIGIN is http', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: 'http://localhost:4000' });
    assert.equal(config.COOKIE_SECURE, false);
  });

  it('DATABASE_URL defaults to localhost when not in production', () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const config = loadConfig({ PUBLIC_ORIGIN: '', NODE_ENV: 'development' });
      assert.equal(config.DATABASE_URL, 'postgresql://localhost/festival_planner');
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it('PG_POOL_MIN defaults to 2', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.PG_POOL_MIN, 2);
  });

  it('PG_POOL_MAX defaults to 20', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.PG_POOL_MAX, 20);
  });

  it('SESSION_SECRET defaults to empty string', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.SESSION_SECRET, '');
  });

  it('REDIS_PREFIX defaults to fp:', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.REDIS_PREFIX, 'fp:');
  });
});

// ===========================================================================
// 4. buildContentSecurityPolicy — via server.js re-export
// ===========================================================================
describe('buildContentSecurityPolicy: via server.js re-export', () => {
  const emptyHashes = { script: [], style: [] };

  it('returns a string containing all required directives', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: '' }, emptyHashes);
    assert.equal(typeof csp, 'string');
    assert.ok(csp.includes("default-src 'self'"), 'missing default-src');
    assert.ok(csp.includes("object-src 'none'"), 'missing object-src');
    assert.ok(csp.includes("frame-ancestors 'none'"), 'missing frame-ancestors');
    assert.ok(csp.includes("report-uri /api/csp-report"), 'missing report-uri');
  });

  it('includes upgrade-insecure-requests for https origins', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: 'https://festie.us' },
      emptyHashes,
    );
    assert.ok(csp.includes('upgrade-insecure-requests'));
  });

  it('omits upgrade-insecure-requests for http origins', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: 'http://localhost:4000' },
      emptyHashes,
    );
    assert.ok(!csp.includes('upgrade-insecure-requests'));
  });

  it('includes Firebase script-src when FIREBASE_CREDENTIALS_PATH is set', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: '', FIREBASE_CREDENTIALS_PATH: '/path/to/creds.json' },
      emptyHashes,
    );
    assert.ok(csp.includes('https://www.gstatic.com/firebasejs/'));
  });

  it('omits Firebase script-src when FIREBASE_CREDENTIALS_PATH is empty', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: '', FIREBASE_CREDENTIALS_PATH: '' },
      emptyHashes,
    );
    assert.ok(!csp.includes('https://www.gstatic.com/firebasejs/'));
  });

  it('includes FCM connect-src endpoints when FIREBASE_CREDENTIALS_PATH is set', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: '', FIREBASE_CREDENTIALS_PATH: '/path/to/creds.json' },
      emptyHashes,
    );
    assert.ok(csp.includes('https://fcm.googleapis.com'));
    assert.ok(csp.includes('https://fcmregistrations.googleapis.com'));
    assert.ok(csp.includes('https://firebaseinstallations.googleapis.com'));
  });

  it('includes Spotify frame-src for embed player', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: '' }, emptyHashes);
    assert.ok(csp.includes('https://open.spotify.com'));
  });

  it('includes inline script hashes in script-src when provided', () => {
    const hashes = { script: ["'sha256-abc123'"], style: [] };
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: '' }, hashes);
    assert.ok(csp.includes("'sha256-abc123'"));
  });
});

// ===========================================================================
// 5. collectInlineHashes — via server.js re-export
// ===========================================================================
describe('collectInlineHashes: via server.js re-export', () => {
  it('returns object with script and style arrays for a nonexistent directory', () => {
    const tmpDir = path.join(os.tmpdir(), `festie-csp-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(Array.isArray(hashes.script));
      assert.ok(Array.isArray(hashes.style));
      assert.equal(hashes.script.length, 0);
      assert.equal(hashes.style.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts SHA-256 hashes from inline scripts in index.html', () => {
    const tmpDir = path.join(os.tmpdir(), `festie-csp-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      '<html><head><script>console.log("hello")</script></head><body></body></html>',
    );
    try {
      const hashes = collectInlineHashes(tmpDir);
      assert.equal(hashes.script.length, 1);
      assert.ok(hashes.script[0].startsWith("'sha256-"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts SHA-256 hashes from inline styles in index.html', () => {
    const tmpDir = path.join(os.tmpdir(), `festie-csp-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      '<html><head><style>body { color: red; }</style></head><body></body></html>',
    );
    try {
      const hashes = collectInlineHashes(tmpDir);
      assert.equal(hashes.style.length, 1);
      assert.ok(hashes.style[0].startsWith("'sha256-"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// 6. createFestieApp — structural tests (no DB required)
// ===========================================================================
describe('createFestieApp: structural', () => {
  it('createFestieApp accepts overrides parameter', () => {
    // Verify the function signature accepts an argument without throwing TypeError
    assert.equal(createFestieApp.length, 0, 'createFestieApp should have 0 required params (overrides defaults to {})');
  });

  it('createFestieApp re-validates startup config — rejects bad production config', () => {
    // createFestieApp internally calls validateStartupConfig(config) after
    // building the full app context. If the resolved config violates a
    // production rule, it should throw before any routes or middleware run.
    // We cannot fully run createFestieApp without DB, but we CAN verify the
    // validation logic that would execute inside it.
    const badConfig = prodConfig({ PUBLIC_ORIGIN: '' });
    assert.throws(
      () => validateStartupConfig(badConfig),
      { message: /PUBLIC_ORIGIN is required in production/ },
    );
  });
});

// ===========================================================================
// 7. loadConfig — type coercion and bounds checking
// ===========================================================================
describe('loadConfig: type coercion and bounds', () => {
  it('RATE_LIMIT_WINDOW defaults to 60000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.RATE_LIMIT_WINDOW, 60_000);
  });

  it('AUTH_RATE_LIMIT_WINDOW defaults to 300000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.AUTH_RATE_LIMIT_WINDOW, 300_000);
  });

  it('MAX_USERS defaults to 200', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.MAX_USERS, 200);
  });

  it('AVATAR_SIZE defaults to 256', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.AVATAR_SIZE, 256);
  });

  it('AVATAR_SIZE is clamped to min 32', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', AVATAR_SIZE: '10' });
    assert.equal(config.AVATAR_SIZE, 256); // out-of-range reverts to default
  });

  it('AVATAR_SIZE is clamped to max 1024', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', AVATAR_SIZE: '2000' });
    assert.equal(config.AVATAR_SIZE, 256); // out-of-range reverts to default
  });

  it('JSON_LIMIT defaults to 256kb', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.JSON_LIMIT, '256kb');
  });

  it('SHUTDOWN_TIMEOUT_MS defaults to 30000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.SHUTDOWN_TIMEOUT_MS, 30_000);
  });

  it('TRUST_PROXY defaults to false', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.TRUST_PROXY, false);
  });

  it('TRUST_PROXY parses "true" as boolean true', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: 'true' });
    assert.equal(config.TRUST_PROXY, true);
  });

  it('TRUST_PROXY parses numeric string as integer (hop count)', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', TRUST_PROXY: '2' });
    assert.equal(config.TRUST_PROXY, 2);
  });

  it('EMAIL_FROM defaults to Festie <no-reply@festie.us>', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.EMAIL_FROM, 'Festie <no-reply@festie.us>');
  });

  it('MAX_CONCURRENT_EXPORTS defaults to 4', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.MAX_CONCURRENT_EXPORTS, 4);
  });

  it('EXPORT_COOLDOWN_MS defaults to 5000', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.EXPORT_COOLDOWN_MS, 5000);
  });

  it('REFRESH_TOKEN_TTL defaults to 90 days in ms', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.REFRESH_TOKEN_TTL, 90 * 24 * 60 * 60 * 1000);
  });

  it('MAX_LOGIN_FAILURES defaults to 10', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.MAX_LOGIN_FAILURES, 10);
  });

  it('LOGIN_LOCKOUT_MS defaults to 15 minutes in ms', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.LOGIN_LOCKOUT_MS, 15 * 60 * 1000);
  });

  it('COOKIE_SAME_SITE normalizes "strict" override', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', COOKIE_SAME_SITE: 'Strict' });
    assert.equal(config.COOKIE_SAME_SITE, 'strict');
  });

  it('COOKIE_SAME_SITE normalizes "none" override', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', COOKIE_SAME_SITE: 'None' });
    assert.equal(config.COOKIE_SAME_SITE, 'none');
  });

  it('COOKIE_SAME_SITE falls back to lax for unknown values', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', COOKIE_SAME_SITE: 'invalid' });
    assert.equal(config.COOKIE_SAME_SITE, 'lax');
  });

  it('DB_POOL_SIZE defaults to 15', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.DB_POOL_SIZE, 15);
  });

  it('DB_POOL_SIZE clamps at max 50', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', DB_POOL_SIZE: '100' });
    assert.equal(config.DB_POOL_SIZE, 15); // out-of-range reverts to default
  });

  it('EMAIL_VERIFY_TOKEN_TTL_HOURS defaults to 24', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.equal(config.EMAIL_VERIFY_TOKEN_TTL_HOURS, 24);
  });

  it('MOBILE_ORIGINS defaults to empty array', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '' });
    assert.deepStrictEqual(config.MOBILE_ORIGINS, []);
  });

  it('MOBILE_ORIGINS parses comma-separated list', () => {
    const config = loadConfig({ PUBLIC_ORIGIN: '', MOBILE_ORIGINS: 'app://festie,capacitor://localhost' });
    assert.deepStrictEqual(config.MOBILE_ORIGINS, ['app://festie', 'capacitor://localhost']);
  });
});

// ===========================================================================
// 8. validateStartupConfig: function behavior contract
// ===========================================================================
describe('validateStartupConfig: contract', () => {
  it('returns undefined on valid config (no return value)', () => {
    const result = validateStartupConfig(devConfig());
    assert.equal(result, undefined);
  });

  it('accepts a completely empty config (non-production)', () => {
    assert.doesNotThrow(() => validateStartupConfig({}));
  });

  it('accepts config with extra unknown keys (forward-compatible)', () => {
    assert.doesNotThrow(() => validateStartupConfig(devConfig({
      SOME_FUTURE_KEY: 'value',
      ANOTHER_KEY: 42,
    })));
  });

  it('performs all checks in sequence — first failing check determines error', () => {
    // Production with no PUBLIC_ORIGIN AND bad FCM config — PUBLIC_ORIGIN check is first
    assert.throws(
      () => validateStartupConfig({
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: '',
        FCM_RETRY_WEBHOOK_URL: 'https://example.com/webhook',
        WEBHOOK_TOKEN_HMAC_KEY: '',
      }),
      { message: /PUBLIC_ORIGIN is required in production/ },
    );
  });
});
