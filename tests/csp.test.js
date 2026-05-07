'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { buildCspPolicies, buildContentSecurityPolicy, collectInlineHashes } = require('../lib/app-context/csp');

// ─── collectInlineHashes ─────────────────────────────────────────────────────

describe('csp: collectInlineHashes', () => {
  it('returns object with script and style arrays', () => {
    // Use a temp dir with no HTML files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(Array.isArray(hashes.script));
      assert.ok(Array.isArray(hashes.style));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('collects hashes from inline script tags', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><head><script>console.log("hello")</script></head></html>');
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(hashes.script.length >= 1);
      assert.ok(hashes.script[0].startsWith("'sha256-"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('collects hashes from inline style tags', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><head><style>body { color: red; }</style></head></html>');
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(hashes.style.length >= 1);
      assert.ok(hashes.style[0].startsWith("'sha256-"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips script tags with src attribute', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><head><script src="app.js">fallback</script></head></html>');
      const hashes = collectInlineHashes(tmpDir);
      assert.equal(hashes.script.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles missing files gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      // No files at all — should not throw
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(Array.isArray(hashes.script));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── buildContentSecurityPolicy ──────────────────────────────────────────────

describe('csp: buildContentSecurityPolicy', () => {
  const minimalConfig = { PUBLIC_ORIGIN: 'https://festie.us' };
  const emptyHashes = { script: [], style: [] };

  it('returns a non-empty string', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(typeof csp === 'string');
    assert.ok(csp.length > 50);
  });

  it('includes default-src self', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes("default-src 'self'"));
  });

  it('includes frame-ancestors none', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes("frame-ancestors 'none'"));
  });

  it('includes script-src self', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes("script-src 'self'"));
  });

  it('includes websocket origin for wss when PUBLIC_ORIGIN is https', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: 'https://festie.us' }, emptyHashes);
    assert.ok(csp.includes('wss://festie.us'));
  });

  it('includes firebase script-src when FIREBASE_CREDENTIALS_PATH is set', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: 'https://festie.us', FIREBASE_CREDENTIALS_PATH: '/path/to/creds' },
      emptyHashes,
    );
    assert.ok(csp.includes('https://www.gstatic.com/firebasejs/'));
  });

  it('includes upgrade-insecure-requests for https origins', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: 'https://festie.us' }, emptyHashes);
    assert.ok(csp.includes('upgrade-insecure-requests'));
  });

  it('does not include upgrade-insecure-requests for http origins', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: 'http://localhost:4000' }, emptyHashes);
    assert.ok(!csp.includes('upgrade-insecure-requests'));
  });

  it('includes style-src-attr unsafe-inline when allowStyleAttributes is true', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes, { allowStyleAttributes: true });
    assert.ok(csp.includes("style-src-attr 'unsafe-inline'"));
  });

  it('excludes style-src-attr when allowStyleAttributes is false', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes, { allowStyleAttributes: false });
    assert.ok(!csp.includes('style-src-attr'));
  });

  it('includes inline script hashes in script-src', () => {
    const hashes = { script: ["'sha256-abc123'"], style: [] };
    const csp = buildContentSecurityPolicy(minimalConfig, hashes);
    assert.ok(csp.includes("'sha256-abc123'"));
  });

  it('includes csp-report directive', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes('report-uri /api/csp-report'));
  });
});

// ─── buildCspPolicies ────────────────────────────────────────────────────────

describe('csp: buildCspPolicies', () => {
  it('returns inlineHashes, contentSecurityPolicy, and exportContentSecurityPolicy', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      const result = buildCspPolicies({ PUBLIC_DIR: tmpDir, PUBLIC_ORIGIN: 'https://festie.us' });
      assert.ok(result.inlineHashes);
      assert.ok(typeof result.contentSecurityPolicy === 'string');
      assert.ok(typeof result.exportContentSecurityPolicy === 'string');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
