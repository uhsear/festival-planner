'use strict';

const assert = require('node:assert/strict');
const { describe, it, mock } = require('node:test');

const { createLogger, sanitizeLogMeta, getPinoRoot, pinoAvailable } = require('../lib/logger');

// ─── sanitizeLogMeta ─────────────────────────────────────────────────────────

describe('logger: sanitizeLogMeta', () => {
  it('redacts password fields', () => {
    const result = sanitizeLogMeta({ password: 'secret123', username: 'alice' });
    assert.equal(result.password, '[REDACTED]');
    assert.equal(result.username, 'alice');
  });

  it('redacts token, secret, authorization', () => {
    const result = sanitizeLogMeta({ token: 'abc', secret: 'def', authorization: 'Bearer xyz' });
    assert.equal(result.token, '[REDACTED]');
    assert.equal(result.secret, '[REDACTED]');
    assert.equal(result.authorization, '[REDACTED]');
  });

  it('redacts PII fields (email, creditcard, ssn)', () => {
    const result = sanitizeLogMeta({ email: 'a@b.com', ssn: '123', creditcard: '4111' });
    assert.equal(result.email, '[REDACTED]');
    assert.equal(result.ssn, '[REDACTED]');
    assert.equal(result.creditcard, '[REDACTED]');
  });

  it('redacts nested objects recursively', () => {
    const result = sanitizeLogMeta({ user: { password: 'x', name: 'Bob' } });
    assert.equal(result.user.password, '[REDACTED]');
    assert.equal(result.user.name, 'Bob');
  });

  it('handles arrays by sanitizing each element', () => {
    const result = sanitizeLogMeta([{ password: 'a' }, { token: 'b' }]);
    assert.equal(result[0].password, '[REDACTED]');
    assert.equal(result[1].token, '[REDACTED]');
  });

  it('returns non-object values unchanged', () => {
    assert.equal(sanitizeLogMeta(null), null);
    assert.equal(sanitizeLogMeta(undefined), undefined);
    assert.equal(sanitizeLogMeta(42), 42);
    assert.equal(sanitizeLogMeta('hello'), 'hello');
  });

  it('is case-insensitive for key matching', () => {
    const result = sanitizeLogMeta({ Password: 'x', TOKEN: 'y', Secret: 'z' });
    assert.equal(result.Password, '[REDACTED]');
    assert.equal(result.TOKEN, '[REDACTED]');
    assert.equal(result.Secret, '[REDACTED]');
  });

  it('redacts api_key and access_token', () => {
    const result = sanitizeLogMeta({ api_key: 'k', access_token: 't', other: 'v' });
    assert.equal(result.api_key, '[REDACTED]');
    assert.equal(result.access_token, '[REDACTED]');
    assert.equal(result.other, 'v');
  });

  it('redacts session-related fields', () => {
    const result = sanitizeLogMeta({ sessionToken: 'st', session_token: 'st2', session: 's' });
    assert.equal(result.sessionToken, '[REDACTED]');
    assert.equal(result.session_token, '[REDACTED]');
    assert.equal(result.session, '[REDACTED]');
  });
});

// ─── createLogger ────────────────────────────────────────────────────────────

describe('logger: createLogger', () => {
  it('returns an object with error, warn, info, debug methods', () => {
    const log = createLogger('test');
    assert.equal(typeof log.error, 'function');
    assert.equal(typeof log.warn, 'function');
    assert.equal(typeof log.info, 'function');
    assert.equal(typeof log.debug, 'function');
  });

  it('has a child method that returns a new logger', () => {
    const log = createLogger('parent');
    const child = log.child({ requestId: '123' });
    assert.equal(typeof child.error, 'function');
    assert.equal(typeof child.info, 'function');
    assert.equal(typeof child.child, 'function');
  });

  it('has a level property', () => {
    const log = createLogger();
    assert.ok(typeof log.level === 'string' || typeof log.level === 'number');
  });

  it('has an isPino boolean', () => {
    const log = createLogger();
    assert.equal(typeof log.isPino, 'boolean');
  });

  it('does not throw when called with no arguments', () => {
    assert.doesNotThrow(() => createLogger());
  });

  it('does not throw when logging with meta', () => {
    const log = createLogger('test-prefix');
    assert.doesNotThrow(() => log.info('test message', { key: 'value' }));
  });

  it('does not throw when logging with no meta', () => {
    const log = createLogger('prefix');
    assert.doesNotThrow(() => log.warn('warning message'));
  });

  it('does not throw with undefined meta', () => {
    const log = createLogger();
    assert.doesNotThrow(() => log.error('err', undefined));
  });

  it('does not throw with null meta', () => {
    const log = createLogger();
    assert.doesNotThrow(() => log.debug('debug', null));
  });

  it('does not throw with scalar meta', () => {
    const log = createLogger();
    assert.doesNotThrow(() => log.info('info', 42));
  });
});

// ─── getPinoRoot ─────────────────────────────────────────────────────────────

describe('logger: getPinoRoot', () => {
  it('returns an object or null', () => {
    const root = getPinoRoot();
    assert.ok(root === null || typeof root === 'object');
  });

  it('pinoAvailable matches whether getPinoRoot returns non-null', () => {
    const root = getPinoRoot();
    if (root) {
      assert.equal(pinoAvailable, true);
    } else {
      assert.equal(pinoAvailable, false);
    }
  });
});
