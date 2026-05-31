import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateStartupConfig } from '../server.js';


// ---------------------------------------------------------------------------
// Helper: build a config object with sensible dev defaults, then override
// ---------------------------------------------------------------------------
function devConfig(overrides: any = {}) {
  return {
    NODE_ENV: 'development',
    PUBLIC_ORIGIN: '',
    SESSION_SECRET: 'dev-secret',
    EMAIL_FROM: 'dev@localhost',
    ...overrides,
  };
}

function prodConfig(overrides: any = {}) {
  return {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://festie.us',
    SESSION_SECRET: 'a-very-strong-random-value-1234567890',
    EMAIL_FROM: 'Festie <no-reply@festie.us>',
    ...overrides,
  };
}

// ===========================================================================
// 1. PUBLIC_ORIGIN in production
// ===========================================================================
describe('validateStartupConfig: PUBLIC_ORIGIN', () => {
  it('throws when production has no PUBLIC_ORIGIN', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ PUBLIC_ORIGIN: '' })),
      { message: /PUBLIC_ORIGIN is required in production/ },
    );
  });

  it('throws when production PUBLIC_ORIGIN is undefined', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ PUBLIC_ORIGIN: undefined })),
      { message: /PUBLIC_ORIGIN is required in production/ },
    );
  });

  it('passes when production has a valid PUBLIC_ORIGIN', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(prodConfig({ PUBLIC_ORIGIN: 'https://festie.us' })),
    );
  });

  it('passes in development even without PUBLIC_ORIGIN', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(devConfig({ PUBLIC_ORIGIN: '' })),
    );
  });
});

// ===========================================================================
// 2. FCM retry webhook requires HMAC key
// ===========================================================================
describe('validateStartupConfig: FCM webhook HMAC', () => {
  it('throws when FCM_RETRY_WEBHOOK_URL is set but WEBHOOK_TOKEN_HMAC_KEY is missing', () => {
    assert.throws(
      () => validateStartupConfig(devConfig({
        FCM_RETRY_WEBHOOK_URL: 'https://example.com/webhook',
        WEBHOOK_TOKEN_HMAC_KEY: '',
      })),
      { message: /WEBHOOK_TOKEN_HMAC_KEY is required/ },
    );
  });

  it('throws when FCM_RETRY_WEBHOOK_URL is set and WEBHOOK_TOKEN_HMAC_KEY is undefined', () => {
    assert.throws(
      () => validateStartupConfig(devConfig({
        FCM_RETRY_WEBHOOK_URL: 'https://example.com/webhook',
        WEBHOOK_TOKEN_HMAC_KEY: undefined,
      })),
      { message: /WEBHOOK_TOKEN_HMAC_KEY is required/ },
    );
  });

  it('passes when FCM_RETRY_WEBHOOK_URL is set with a valid HMAC key', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(devConfig({
        FCM_RETRY_WEBHOOK_URL: 'https://example.com/webhook',
        WEBHOOK_TOKEN_HMAC_KEY: 'super-secret-hmac-key',
      })),
    );
  });

  it('passes when FCM_RETRY_WEBHOOK_URL is not set (no HMAC key needed)', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(devConfig({
        FCM_RETRY_WEBHOOK_URL: undefined,
        WEBHOOK_TOKEN_HMAC_KEY: undefined,
      })),
    );
  });

  it('passes when FCM_RETRY_WEBHOOK_URL is empty string (falsy, no HMAC needed)', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(devConfig({
        FCM_RETRY_WEBHOOK_URL: '',
        WEBHOOK_TOKEN_HMAC_KEY: '',
      })),
    );
  });
});

// ===========================================================================
// 3. SESSION_SECRET strength in production
// ===========================================================================
describe('validateStartupConfig: SESSION_SECRET', () => {
  it('throws in production when SESSION_SECRET is empty string', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ SESSION_SECRET: '' })),
      { message: /SESSION_SECRET must be set to a strong random value/ },
    );
  });

  it('throws in production when SESSION_SECRET is the default "change-me"', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ SESSION_SECRET: 'change-me' })),
      { message: /SESSION_SECRET must be set to a strong random value/ },
    );
  });

  it('passes in production with a strong SESSION_SECRET', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(prodConfig({ SESSION_SECRET: 'a-very-strong-random-value-1234567890' })),
    );
  });

  it('passes in development even with weak SESSION_SECRET', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(devConfig({ SESSION_SECRET: 'change-me' })),
    );
  });

  it('passes in production when SESSION_SECRET key is absent from config (hasOwnProperty check)', () => {
    const cfg = prodConfig();
    delete cfg.SESSION_SECRET;
    assert.doesNotThrow(() => validateStartupConfig(cfg));
  });
});

// ===========================================================================
// 4. EMAIL_FROM must not be personal email in production
// ===========================================================================
describe('validateStartupConfig: EMAIL_FROM', () => {
  // example.com is the IANA-reserved documentation domain, used here only as the
  // required non-festie.us counterexample for the negative cases.
  it('throws in production when EMAIL_FROM is not a festie.us address', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ EMAIL_FROM: 'noreply@example.com' })),
      { message: /EMAIL_FROM must use a festie\.us sender address/ },
    );
  });

  it('throws in production when a non-festie.us address is in display name format', () => {
    assert.throws(
      () => validateStartupConfig(prodConfig({ EMAIL_FROM: 'Festie <noreply@example.com>' })),
      { message: /EMAIL_FROM must use a festie\.us sender address/ },
    );
  });

  it('passes in production with a proper festie.us sender email', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(prodConfig({ EMAIL_FROM: 'Festie <no-reply@festie.us>' })),
    );
  });

  it('passes in development even with a non-festie.us address', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(devConfig({ EMAIL_FROM: 'noreply@example.com' })),
    );
  });

  it('passes in production when EMAIL_FROM is undefined (no string check)', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(prodConfig({ EMAIL_FROM: undefined })),
    );
  });

  it('passes in production when EMAIL_FROM is a number (typeof !== string)', () => {
    assert.doesNotThrow(
      () => validateStartupConfig(prodConfig({ EMAIL_FROM: 42 })),
    );
  });
});

// ===========================================================================
// 5. Combined / edge-case scenarios
// ===========================================================================
describe('validateStartupConfig: combined scenarios', () => {
  it('valid production config passes all checks', () => {
    assert.doesNotThrow(() => validateStartupConfig(prodConfig()));
  });

  it('valid development config passes all checks', () => {
    assert.doesNotThrow(() => validateStartupConfig(devConfig()));
  });

  it('minimal empty dev config passes (all fields missing)', () => {
    assert.doesNotThrow(() => validateStartupConfig({ NODE_ENV: 'development' }));
  });
});
