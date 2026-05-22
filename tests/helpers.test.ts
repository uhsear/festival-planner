import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  sanitizeString,
  normalizeRecordKey,
  sanitizeIdentifier,
  parseCookies,
  escapeHtml,
  sanitizeLogMeta,
  getLogSafeRequestInfo,
  safeDataFilename,
  stripBom,
  encodeContentDispositionFilename,
  createAuditLog,
} from '../lib/helpers/sanitize.js';

import {
  validateTime,
  validateColor,
  validateUsername,
  validatePasswordStrength,
} from '../lib/helpers/validation.js';

import {
  formatTime,
  timeToMinutes,
  getAvatarColor,
  getInitials,
} from '../lib/helpers/export-utils.js';

// ── sanitize.js ─────────────────────────────────────────────────────────────

describe('helpers/sanitize: parseCookies', () => {
  it('parses standard cookie string', () => {
    const result = parseCookies('name=value; session=abc123');
    assert.equal(result.name, 'value');
    assert.equal(result.session, 'abc123');
  });

  it('handles URL-encoded values', () => {
    const result = parseCookies('data=%7B%22key%22%3A%22val%22%7D');
    assert.equal(result.data, '{"key":"val"}');
  });

  it('falls back to raw value on decode error', () => {
    const result = parseCookies('bad=%E0%A4%A');
    assert.equal(typeof result.bad, 'string');
  });

  it('returns empty object for empty string', () => {
    assert.deepEqual(parseCookies(''), {});
  });

  it('returns empty object for null', () => {
    assert.deepEqual(parseCookies(null), {});
  });

  it('returns empty object for undefined', () => {
    assert.deepEqual(parseCookies(undefined), {});
  });

  it('skips entries without equals sign', () => {
    const result = parseCookies('valid=yes; noequals; also=good');
    assert.equal(result.valid, 'yes');
    assert.equal(result.also, 'good');
    assert.ok(!('noequals' in result));
  });

  it('skips entries with empty key', () => {
    const result = parseCookies('=nokey; valid=yes');
    assert.ok(!result['']);
    assert.equal(result.valid, 'yes');
  });

  it('handles cookies with equals in value', () => {
    const result = parseCookies('token=abc=def==');
    assert.equal(result.token, 'abc=def==');
  });

  it('trims whitespace from keys and values', () => {
    const result = parseCookies('  key  =  value  ');
    assert.equal(result.key, 'value');
  });
});

describe('helpers/sanitize: escapeHtml', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeHtml('a&b'), 'a&amp;b');
  });

  it('escapes less than', () => {
    assert.equal(escapeHtml('a<b'), 'a&lt;b');
  });

  it('escapes greater than', () => {
    assert.equal(escapeHtml('a>b'), 'a&gt;b');
  });

  it('escapes double quotes', () => {
    assert.equal(escapeHtml('a"b'), 'a&quot;b');
  });

  it('escapes single quotes', () => {
    assert.equal(escapeHtml("a'b"), 'a&#39;b');
  });

  it('escapes backticks', () => {
    assert.equal(escapeHtml('a`b'), 'a&#96;b');
  });

  it('escapes all dangerous chars together', () => {
    assert.equal(
      escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('handles non-string input by coercing to string', () => {
    assert.equal(escapeHtml(123), '123');
    assert.equal(escapeHtml(null), 'null');
  });

  it('returns empty string for empty input', () => {
    assert.equal(escapeHtml(''), '');
  });
});

describe('helpers/sanitize: sanitizeLogMeta', () => {
  it('redacts password field', () => {
    const result = sanitizeLogMeta({ password: 'secret' });
    assert.equal(result.password, '[REDACTED]');
  });

  it('redacts token field', () => {
    const result = sanitizeLogMeta({ token: 'abc123' });
    assert.equal(result.token, '[REDACTED]');
  });

  it('redacts nested sensitive fields', () => {
    const result = sanitizeLogMeta({ user: { email: 'test@x.com', name: 'Joe' } });
    assert.equal(result.user.email, '[REDACTED]');
    assert.equal(result.user.name, 'Joe');
  });

  it('handles arrays', () => {
    const result = sanitizeLogMeta([{ password: 'x' }, { name: 'ok' }]);
    assert.equal(result[0].password, '[REDACTED]');
    assert.equal(result[1].name, 'ok');
  });

  it('returns null for null input', () => {
    assert.equal(sanitizeLogMeta(null), null);
  });

  it('returns primitives unchanged', () => {
    assert.equal(sanitizeLogMeta('hello'), 'hello');
    assert.equal(sanitizeLogMeta(42), 42);
    assert.equal(sanitizeLogMeta(true), true);
  });

  it('is case-insensitive for field names', () => {
    const result = sanitizeLogMeta({ Password: 'x', TOKEN: 'y', ApiKey: 'z' });
    assert.equal(result.Password, '[REDACTED]');
    assert.equal(result.TOKEN, '[REDACTED]');
    assert.equal(result.ApiKey, '[REDACTED]');
  });

  it('preserves non-sensitive fields', () => {
    const result = sanitizeLogMeta({ method: 'GET', path: '/api/test', status: 200 });
    assert.deepEqual(result, { method: 'GET', path: '/api/test', status: 200 });
  });
});

describe('helpers/sanitize: getLogSafeRequestInfo', () => {
  it('excludes authorization header', () => {
    const req = {
      method: 'GET', path: '/api/test', ip: '127.0.0.1',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    };
    const result = getLogSafeRequestInfo(req);
    assert.ok(!('authorization' in result.headers));
    assert.equal(result.headers['content-type'], 'application/json');
  });

  it('excludes cookie header', () => {
    const req = {
      method: 'POST', path: '/login', ip: '10.0.0.1',
      headers: { cookie: 'session=abc', host: 'example.com' },
    };
    const result = getLogSafeRequestInfo(req);
    assert.ok(!('cookie' in result.headers));
    assert.equal(result.headers.host, 'example.com');
  });

  it('includes method, path, ip', () => {
    const req = { method: 'DELETE', path: '/api/users/1', ip: '1.2.3.4', headers: {} };
    const result = getLogSafeRequestInfo(req);
    assert.equal(result.method, 'DELETE');
    assert.equal(result.path, '/api/users/1');
    assert.equal(result.ip, '1.2.3.4');
  });
});

describe('helpers/sanitize: safeDataFilename', () => {
  it('allows alphanumeric with dot, dash, underscore', () => {
    assert.equal(safeDataFilename('data-file_1.json'), 'data-file_1.json');
  });

  it('throws on path traversal', () => {
    assert.throws(() => safeDataFilename('../etc/passwd'), /Unsafe data filename/);
  });

  it('throws on spaces', () => {
    assert.throws(() => safeDataFilename('my file.txt'), /Unsafe data filename/);
  });
});

describe('helpers/sanitize: stripBom', () => {
  it('removes UTF-8 BOM', () => {
    assert.equal(stripBom('﻿hello'), 'hello');
  });

  it('returns non-string input unchanged', () => {
    assert.equal(stripBom(42), 42);
    assert.equal(stripBom(null), null);
  });

  it('leaves text without BOM unchanged', () => {
    assert.equal(stripBom('hello'), 'hello');
  });
});

describe('helpers/sanitize: encodeContentDispositionFilename', () => {
  it('encodes special characters', () => {
    const result = encodeContentDispositionFilename("file's (copy).txt");
    assert.ok(!result.includes("'"));
    assert.ok(!result.includes('('));
    assert.ok(!result.includes(')'));
  });

  it('encodes asterisk', () => {
    const result = encodeContentDispositionFilename('file*.txt');
    assert.ok(result.includes('%2A'));
  });
});

describe('helpers/sanitize: createAuditLog', () => {
  it('creates entry with timestamp, action, userId', () => {
    const log = createAuditLog('user.login', 'user-123');
    assert.equal(log.action, 'user.login');
    assert.equal(log.userId, 'user-123');
    assert.ok(log.timestamp);
  });

  it('merges additional details', () => {
    const log = createAuditLog('festival.create', 'u1', { festivalId: 'f1' });
    assert.equal(log.festivalId, 'f1');
    assert.equal(log.action, 'festival.create');
  });
});

// ── export-utils.js ────────────────────────────────────────────────────────

describe('helpers/export-utils: getAvatarColor', () => {
  it('returns a hex color string', () => {
    const color = getAvatarColor('Alice');
    assert.match(color as string, /^#[0-9a-f]{6}$/i);
  });

  it('returns deterministic result for same name', () => {
    assert.equal(getAvatarColor('Bob'), getAvatarColor('Bob'));
  });

  it('returns a color from the palette for any input', () => {
    const colors = ['#ff3366', '#00e8d0', '#ffb020', '#39ff14', '#ff8c00', '#4488ff', '#ff4444', '#e040fb', '#00e5ff', '#ffab00'];
    assert.ok(colors.includes(getAvatarColor('Test User') as string));
  });
});

describe('helpers/export-utils: getInitials', () => {
  it('returns first letters of each word, uppercased', () => {
    assert.equal(getInitials('John Doe'), 'JD');
  });

  it('returns at most 2 characters', () => {
    assert.equal(getInitials('A B C D').length, 2);
  });

  it('handles single word', () => {
    assert.equal(getInitials('Alice'), 'A');
  });

  it('handles empty string', () => {
    assert.equal(getInitials(''), '');
  });
});

describe('helpers/export-utils: formatTime', () => {
  it('converts 00:00 to 12:00 AM', () => {
    assert.equal(formatTime('00:00'), '12:00 AM');
  });

  it('converts 12:00 to 12:00 PM', () => {
    assert.equal(formatTime('12:00'), '12:00 PM');
  });

  it('converts 13:30 to 1:30 PM', () => {
    assert.equal(formatTime('13:30'), '1:30 PM');
  });

  it('converts 23:59 to 11:59 PM', () => {
    assert.equal(formatTime('23:59'), '11:59 PM');
  });

  it('returns empty string for empty input', () => {
    assert.equal(formatTime(''), '');
  });

  it('returns empty string for null', () => {
    assert.equal(formatTime(null), '');
  });
});

describe('helpers/export-utils: timeToMinutes', () => {
  it('converts 00:00 to 0', () => {
    assert.equal(timeToMinutes('00:00'), 0);
  });

  it('converts 01:30 to 90', () => {
    assert.equal(timeToMinutes('01:30'), 90);
  });

  it('converts 23:59 to 1439', () => {
    assert.equal(timeToMinutes('23:59'), 1439);
  });

  it('returns 0 for null', () => {
    assert.equal(timeToMinutes(null), 0);
  });

  it('returns 0 for empty string', () => {
    assert.equal(timeToMinutes(''), 0);
  });
});
