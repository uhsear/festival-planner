/**
 * Unit tests for lib/helpers/ics-builder.ts
 *
 * Covers the ICS (RFC 5545) generation helpers shared by the one-off /export
 * route (routes/export.ts) and the subscribable /cal calendar-sync feed
 * (routes/calendar-sync.ts). No DB required — all functions under test are
 * pure string builders.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildIcsEventsFromPicks, buildVCalendar } from '../lib/helpers/ics-builder';

function makeFestival(overrides: any = {}) {
  return {
    id: 'fest-1',
    location: 'Testville',
    stages: [{ id: 'main', name: 'Main Stage' }],
    days: [
      {
        date: '2026-06-05',
        label: 'Friday',
        sets: [{ id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' }],
      },
    ],
    ...overrides,
  };
}

describe('buildIcsEventsFromPicks description separator', () => {
  test('joins priority and note with a real newline, not a pre-escaped literal backslash-n', () => {
    const festival = makeFestival();
    const profile = {
      picks: { 'set-a': 'must' },
      notes: { 'set-a': 'Front row, bring earplugs' },
    };
    const events = buildIcsEventsFromPicks(festival, profile, 'festie.us');
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(
      event.description,
      'Priority: must\nFront row, bring earplugs',
      'separator must be a real newline character so escIcs escapes it exactly once',
    );
  });

  test('final DESCRIPTION line carries a single RFC5545 newline escape, not a doubled backslash', () => {
    const festival = makeFestival();
    const profile = {
      picks: { 'set-a': 'must' },
      notes: { 'set-a': 'Front row, bring earplugs' },
    };
    const events = buildIcsEventsFromPicks(festival, profile, 'festie.us');
    const ics = buildVCalendar(events, { calendarName: 'Test Cal' });
    const descLine = ics.split('\r\n').find((l: string) => l.startsWith('DESCRIPTION:'));
    assert.equal(
      descLine,
      'DESCRIPTION:Priority: must\\nFront row\\, bring earplugs',
      'a calendar client must see one \\n line-break escape, not a literal \\\\n backslash-n',
    );
  });
});
