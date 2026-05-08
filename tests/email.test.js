'use strict';

const assert = require('node:assert/strict');
const { describe, it, beforeEach, mock } = require('node:test');

// ---------------------------------------------------------------------------
// Mock Resend SDK before requiring the module under test.
// The email module caches the Resend client in a module-level variable,
// so we must mock `resend` before the first require. We use a fresh
// require for each describe block via a loader helper.
// ---------------------------------------------------------------------------

function createMockResend(sendFn) {
  return {
    emails: {
      send: sendFn || mock.fn(async () => ({ data: { id: 'msg-123' }, error: null })),
    },
  };
}

function createMockLog() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

function createMockConfig(overrides = {}) {
  return {
    RESEND_API_KEY: 'test-api-key',
    EMAIL_FROM: 'Festie <test@festie.us>',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Since email.js uses a module-level singleton for the Resend client, we
// need to clear the module cache between test groups to get a fresh client.
// ---------------------------------------------------------------------------

function freshRequire() {
  const modulePath = require.resolve('../lib/email');
  delete require.cache[modulePath];
  // Also clear the helpers/sanitize cache to avoid stale state
  return require('../lib/email');
}

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('email: sendEmail', () => {
  let email;

  beforeEach(() => {
    email = freshRequire();
  });

  it('returns false and logs warning when RESEND_API_KEY is not configured', async () => {
    const log = createMockLog();
    const result = await email.sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
      config: { RESEND_API_KEY: '' },
      log,
    });
    assert.equal(result, false);
    assert.equal(log.warn.mock.callCount(), 1);
  });

  it('returns false when config has no RESEND_API_KEY key at all', async () => {
    const log = createMockLog();
    const result = await email.sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
      config: {},
      log,
    });
    assert.equal(result, false);
  });

  it('suppresses duplicate sends within the idempotency window', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({ data: { id: 'msg-1' }, error: null }));

    // Monkey-patch the Resend module to inject our mock
    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const freshEmail = freshRequire();
      const config = createMockConfig();

      // First send should go through
      const first = await freshEmail.sendEmail({
        to: 'dup@example.com', subject: 'Dup Test',
        html: '<p>Hi</p>', text: 'Hi', config, log,
      });
      assert.equal(first, true);

      // Second send with same to+subject should be suppressed
      const second = await freshEmail.sendEmail({
        to: 'dup@example.com', subject: 'Dup Test',
        html: '<p>Hi again</p>', text: 'Hi again', config, log,
      });
      assert.equal(second, true); // returns true (suppressed, not error)
      assert.equal(sendMock.mock.callCount(), 1, 'Resend.send called only once');
    } finally {
      // Restore original module
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });

  it('returns false and logs error when Resend returns an error response', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({
      data: null,
      error: { message: 'Invalid API key' },
    }));

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const freshEmail = freshRequire();
      const config = createMockConfig();

      const result = await freshEmail.sendEmail({
        to: 'err@example.com', subject: 'Error Test',
        html: '<p>Hi</p>', text: 'Hi', config, log,
      });
      assert.equal(result, false);
      assert.equal(log.error.mock.callCount(), 1);
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });

  it('returns false and logs error when Resend throws an exception', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => { throw new Error('Network timeout'); });

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const freshEmail = freshRequire();
      const config = createMockConfig();

      const result = await freshEmail.sendEmail({
        to: 'throw@example.com', subject: 'Throw Test',
        html: '<p>Hi</p>', text: 'Hi', config, log,
      });
      assert.equal(result, false);
      assert.equal(log.error.mock.callCount(), 1);
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// sendPasswordResetEmail
// ---------------------------------------------------------------------------

describe('email: sendPasswordResetEmail', () => {
  it('returns false when API key is missing (graceful degradation)', async () => {
    const email = freshRequire();
    const log = createMockLog();
    const result = await email.sendPasswordResetEmail({
      to: 'user@example.com',
      username: 'alice',
      resetUrl: 'https://festie.us/reset/abc123',
      config: {},
      log,
    });
    assert.equal(result, false);
  });

  it('builds correct email content with password reset details', async () => {
    const log = createMockLog();
    let capturedArgs = null;
    const sendMock = mock.fn(async (args) => {
      capturedArgs = args;
      return { data: { id: 'msg-reset' }, error: null };
    });

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const email = freshRequire();
      const config = createMockConfig();

      await email.sendPasswordResetEmail({
        to: 'reset@example.com',
        username: 'alice',
        resetUrl: 'https://festie.us/reset/token123',
        config,
        log,
      });

      assert.ok(capturedArgs, 'Resend.send should have been called');
      assert.deepEqual(capturedArgs.to, ['reset@example.com']);
      assert.equal(capturedArgs.subject, 'Reset your Festie password');
      assert.ok(capturedArgs.html.includes('alice'), 'HTML should contain username');
      assert.ok(capturedArgs.html.includes('https://festie.us/reset/token123'), 'HTML should contain reset URL');
      assert.ok(capturedArgs.html.includes('Reset Password'), 'HTML should contain button label');
      assert.ok(capturedArgs.html.includes('60 minutes'), 'HTML should mention expiry');
      assert.ok(capturedArgs.text.includes('alice'), 'Plain text should contain username');
      assert.ok(capturedArgs.text.includes('https://festie.us/reset/token123'), 'Plain text should contain reset URL');
      assert.equal(capturedArgs.from, 'Festie <test@festie.us>');
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });

  it('escapes HTML in username to prevent XSS', async () => {
    const log = createMockLog();
    let capturedArgs = null;
    const sendMock = mock.fn(async (args) => {
      capturedArgs = args;
      return { data: { id: 'msg-xss' }, error: null };
    });

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const email = freshRequire();
      const config = createMockConfig();

      await email.sendPasswordResetEmail({
        to: 'xss@example.com',
        username: '<script>alert(1)</script>',
        resetUrl: 'https://festie.us/reset/token',
        config,
        log,
      });

      assert.ok(capturedArgs);
      assert.ok(!capturedArgs.html.includes('<script>alert(1)</script>'),
        'Raw script tag should be escaped in HTML');
      assert.ok(capturedArgs.html.includes('&lt;script&gt;'));
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// sendVerificationEmail
// ---------------------------------------------------------------------------

describe('email: sendVerificationEmail', () => {
  it('returns false when API key is missing (graceful degradation)', async () => {
    const email = freshRequire();
    const log = createMockLog();
    const result = await email.sendVerificationEmail({
      to: 'user@example.com',
      username: 'bob',
      verifyUrl: 'https://festie.us/verify/abc',
      config: {},
      log,
    });
    assert.equal(result, false);
  });

  it('builds correct email content with verification details', async () => {
    const log = createMockLog();
    let capturedArgs = null;
    const sendMock = mock.fn(async (args) => {
      capturedArgs = args;
      return { data: { id: 'msg-verify' }, error: null };
    });

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const email = freshRequire();
      const config = createMockConfig();

      await email.sendVerificationEmail({
        to: 'verify@example.com',
        username: 'bob',
        verifyUrl: 'https://festie.us/verify/token456',
        config,
        log,
      });

      assert.ok(capturedArgs, 'Resend.send should have been called');
      assert.deepEqual(capturedArgs.to, ['verify@example.com']);
      assert.equal(capturedArgs.subject, 'Verify your Festie email');
      assert.ok(capturedArgs.html.includes('bob'), 'HTML should contain username');
      assert.ok(capturedArgs.html.includes('https://festie.us/verify/token456'), 'HTML should contain verify URL');
      assert.ok(capturedArgs.html.includes('Verify Email'), 'HTML should contain button label');
      assert.ok(capturedArgs.html.includes('24 hours'), 'HTML should mention expiry');
      assert.ok(capturedArgs.text.includes('bob'), 'Plain text should contain username');
      assert.ok(capturedArgs.text.includes('https://festie.us/verify/token456'), 'Plain text should contain verify URL');
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });

  it('escapes HTML in username to prevent XSS', async () => {
    const log = createMockLog();
    let capturedArgs = null;
    const sendMock = mock.fn(async (args) => {
      capturedArgs = args;
      return { data: { id: 'msg-xss2' }, error: null };
    });

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const email = freshRequire();
      const config = createMockConfig();

      await email.sendVerificationEmail({
        to: 'xss2@example.com',
        username: 'A&B<C>',
        verifyUrl: 'https://festie.us/verify/t',
        config,
        log,
      });

      assert.ok(capturedArgs);
      assert.ok(capturedArgs.html.includes('A&amp;B&lt;C&gt;'),
        'Username with special chars should be escaped in HTML body');
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });

  it('uses default EMAIL_FROM when not configured', async () => {
    const log = createMockLog();
    let capturedArgs = null;
    const sendMock = mock.fn(async (args) => {
      capturedArgs = args;
      return { data: { id: 'msg-from' }, error: null };
    });

    const resendPath = require.resolve('resend');
    const originalModule = require.cache[resendPath];
    require.cache[resendPath] = {
      id: resendPath,
      filename: resendPath,
      loaded: true,
      exports: { Resend: function () { return createMockResend(sendMock); } },
    };

    try {
      const email = freshRequire();
      // Config with API key but no EMAIL_FROM
      const config = { RESEND_API_KEY: 'test-key' };

      await email.sendVerificationEmail({
        to: 'from@example.com',
        username: 'charlie',
        verifyUrl: 'https://festie.us/verify/t',
        config,
        log,
      });

      assert.ok(capturedArgs);
      assert.equal(capturedArgs.from, 'Festie <uhsear@gmail.com>',
        'Should use default from address');
    } finally {
      if (originalModule) {
        require.cache[resendPath] = originalModule;
      } else {
        delete require.cache[resendPath];
      }
    }
  });
});
