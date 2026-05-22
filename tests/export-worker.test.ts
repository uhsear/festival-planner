import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildExportHtml } from '../lib/helpers/export-utils.js';

// ---------------------------------------------------------------------------
// The export-worker runs buildExportHtml in a worker thread.
// We test the function directly since Worker threads can't resolve .ts
// imports without a build step. The Worker wrapper is a thin message relay.
// ---------------------------------------------------------------------------

describe('export-worker: message handling', () => {
  it('returns html when given a valid template', () => {
    const html = buildExportHtml(
      '<html><body>Hello</body></html>',
      { name: 'TestFest', days: [], stages: [] },
      { name: 'Alice', picks: {}, notes: {} },
      [],
      new Date().toISOString(),
    );
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0);
  });

  it('returns empty string when template is empty', () => {
    const html = buildExportHtml('', {}, {}, [], undefined);
    assert.equal(html, '');
  });

  it('handles non-string template gracefully', () => {
    try {
      const html = buildExportHtml(42 as any, {}, {}, [], undefined);
      assert.equal(typeof html, 'string');
    } catch {
      assert.ok(true, 'threw on non-string template');
    }
  });

  it('handles null template gracefully', () => {
    try {
      const html = buildExportHtml(null as any, {}, {}, [], undefined);
      assert.equal(typeof html, 'string');
    } catch {
      assert.ok(true, 'threw on null template');
    }
  });

  it('produces a string result', () => {
    const html = buildExportHtml('<div>__SECTIONS__</div>', {}, {}, [], undefined);
    assert.equal(typeof html, 'string');
  });

  it('handles festival with stages and days', () => {
    const html = buildExportHtml(
      '<html><body>Schedule</body></html>',
      {
        name: 'EDC',
        days: [{ id: 'd1', date: '2024-06-01', label: 'Day 1' }],
        stages: [{ id: 's1', name: 'Main Stage' }],
      },
      {
        name: 'Bob',
        picks: { 'set-1': 'must' },
        notes: { 'set-1': 'Bring earplugs' },
      },
      [
        { name: 'Bob', picks: { 'set-1': 'must' } },
        { name: 'Carol', picks: { 'set-1': 'maybe' } },
      ],
      '2024-06-01T12:00:00Z',
    );
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0);
  });

  it('handles profile with empty picks and notes', () => {
    const html = buildExportHtml(
      '<html><body>Empty</body></html>',
      { name: 'Fest', days: [], stages: [] },
      { name: 'User', picks: {}, notes: {} },
      [],
      new Date().toISOString(),
    );
    assert.equal(typeof html, 'string');
  });

  it('handles missing optional fields gracefully', () => {
    const html = buildExportHtml(
      '<html><body>Minimal</body></html>',
      { name: 'Minimal Fest' },
      { name: 'User' },
      [],
      undefined,
    );
    assert.equal(typeof html, 'string');
  });
});
