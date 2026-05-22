import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeHtml, renderInviteJoinPage, renderInviteErrorPage } from '../lib/invite-pages';

// ---------------------------------------------------------------------------
// escapeHtml (re-exported from lib/helpers/sanitize.js)
// ---------------------------------------------------------------------------

describe('invite-pages: escapeHtml', () => {
  it('escapes all dangerous HTML characters', () => {
    const input = '<script>alert("xss")</script> & \'backtick`';
    const result = escapeHtml(input);
    assert.ok(!result.includes('<'));
    assert.ok(!result.includes('>'));
    assert.ok(!result.includes('"'));
    assert.ok(result.includes('&lt;script&gt;'));
    assert.ok(result.includes('&amp;'));
    assert.ok(result.includes('&#39;'));
    assert.ok(result.includes('&#96;'));
  });

  it('coerces non-string values to string', () => {
    assert.equal(escapeHtml(42 as any), '42');
    assert.equal(escapeHtml(null as any), 'null');
    assert.equal(escapeHtml(undefined as any), 'undefined');
  });

  it('returns safe strings unchanged', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });
});

// ---------------------------------------------------------------------------
// renderInviteJoinPage
// ---------------------------------------------------------------------------

describe('invite-pages: renderInviteJoinPage', () => {
  const defaultArgs = {
    crewName: 'Test Crew',
    festivalName: 'Summer Fest',
    inviteCode: 'ABC123',
    origin: 'https://festie.us',
  };

  it('returns valid HTML document', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('contains crew name in title and body', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('<title>Join Crew - Test Crew</title>'));
    assert.ok(html.includes('Test Crew'));
  });

  it('contains festival name', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('for Summer Fest'));
  });

  it('contains correct join link with invite code', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('href="https://festie.us?joinCrew=ABC123"'));
  });

  it('contains back-to-festie link with origin', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('href="https://festie.us"'));
    assert.ok(html.includes('Back to Festie'));
  });

  it('contains og meta tags for social sharing', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('og:title'));
    assert.ok(html.includes('og:description'));
    assert.ok(html.includes('og:type'));
  });

  it('contains invite description text', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('invited to join this crew'));
  });

  it('contains invite button with correct class', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('class="invite-button"'));
    assert.ok(html.includes('Join Crew</a>'));
  });

  it('handles special characters in crew name (no escaping in join page)', () => {
    // Note: renderInviteJoinPage uses template literals directly (no escapeHtml).
    // The caller (routes/crews.js) is responsible for pre-sanitization.
    // This test documents the current behavior.
    const html = renderInviteJoinPage({
      ...defaultArgs,
      crewName: 'Rock & Roll',
    });
    assert.ok(html.includes('Rock & Roll'));
  });

  it('handles empty strings without throwing', () => {
    const html = renderInviteJoinPage({
      crewName: '',
      festivalName: '',
      inviteCode: '',
      origin: '',
    });
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Join Crew - </title>'));
  });

  it('embeds viewport meta tag for mobile', () => {
    const html = renderInviteJoinPage(defaultArgs);
    assert.ok(html.includes('width=device-width, initial-scale=1.0'));
  });
});

// ---------------------------------------------------------------------------
// renderInviteErrorPage
// ---------------------------------------------------------------------------

describe('invite-pages: renderInviteErrorPage', () => {
  it('returns valid HTML document', () => {
    const html = renderInviteErrorPage('https://festie.us', 'Invite expired');
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('contains the error title', () => {
    const html = renderInviteErrorPage('https://festie.us', 'Invite expired');
    assert.ok(html.includes('Invalid or Expired'));
  });

  it('contains the error message', () => {
    const html = renderInviteErrorPage('https://festie.us', 'This invite has expired');
    assert.ok(html.includes('This invite has expired'));
  });

  it('contains return-to-festie link with origin', () => {
    const html = renderInviteErrorPage('https://festie.us', 'error');
    assert.ok(html.includes('href="https://festie.us"'));
    assert.ok(html.includes('Return to Festie'));
  });

  it('HTML-escapes the error message to prevent XSS', () => {
    const html = renderInviteErrorPage(
      'https://festie.us',
      '<script>alert("xss")</script>',
    );
    assert.ok(!html.includes('<script>alert("xss")</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('escapes ampersands in error message', () => {
    const html = renderInviteErrorPage('https://festie.us', 'A & B');
    assert.ok(html.includes('A &amp; B'));
  });

  it('escapes quotes in error message', () => {
    const html = renderInviteErrorPage('https://festie.us', 'say "hello"');
    assert.ok(html.includes('&quot;hello&quot;'));
  });

  it('handles empty message', () => {
    const html = renderInviteErrorPage('https://festie.us', '');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('invite-error-message'));
  });

  it('handles null/undefined message by coercing to string', () => {
    // escapeHtml coerces via String(), so null -> "null"
    const html = renderInviteErrorPage('https://festie.us', null as any);
    assert.ok(html.includes('null'));
  });

  it('contains error icon', () => {
    const html = renderInviteErrorPage('https://festie.us', 'error');
    assert.ok(html.includes('invite-error-icon'));
  });

  it('contains viewport meta tag', () => {
    const html = renderInviteErrorPage('https://festie.us', 'error');
    assert.ok(html.includes('width=device-width, initial-scale=1.0'));
  });
});
