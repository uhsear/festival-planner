/**
 * Pure unit tests for lib/helpers/export-utils.js
 *
 * No DB required — all functions under test are pure (HTML rendering, time
 * formatting, set sorting, profile serialization). Tests run unconditionally
 * (no TEST_DATABASE_URL skip gate).
 *
 * Actual exports (verified against lib/helpers/export-utils.js):
 *   getAvatarColor, getInitials, formatTime, formatExportTimestamp,
 *   timeToMinutes, buildSetDateStamp, getSetTiming, buildFestivalSetList,
 *   pickTimedFestivalSet, getExportPickLabel, getExportPickChipClass,
 *   formatSetRangeLabel, formatSetLocationLabel,
 *   getExportCurrentOrNextPickedSet, getExportReminderItems,
 *   formatCrewOverlapLabel, getExportNextCrewOverlap,
 *   buildAvatarUrl, serializeOwnProfile, serializeProfileForViewer,
 *   buildExportHtml, serializeExportCrewProfile
 *
 * Template placeholder tokens (verified against buildExportHtml):
 *   __TITLE__, __SUBTITLE__, __OVERVIEW__, __LIVE__, __REMINDERS__,
 *   __SECTIONS__, __EXPORTED_AT__
 *
 * NOTE: The subtitle is passed through escapeHtml, which escapes apostrophes
 * (e.g. `Alice's` becomes `Alice&#39;s` or `Alice&apos;s` depending on the
 * sanitize impl). Subtitle assertions tolerate either raw or entity-escaped
 * apostrophe forms.
 *
 * The old parked tests referenced nonexistent `buildIcs`/`buildJson` — those
 * are NOT exported here; ICS generation lives elsewhere.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as exportUtils from '../lib/helpers/export-utils';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeFestival(overrides: any = {}) {
  return {
    id: 'fest-unit',
    name: 'Unit Fest',
    location: 'Testville',
    stages: [
      { id: 'main', name: 'Main Stage', color: '#ff3366' },
      { id: 'forest', name: 'Forest Stage', color: '#00e8d0' },
    ],
    days: [
      {
        label: 'Friday',
        date: '2026-06-05',
        sets: [
          { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
          { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
        ],
      },
      {
        label: 'Saturday',
        date: '2026-06-06',
        sets: [
          { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '14:00', endTime: '15:00' },
        ],
      },
    ],
    ...overrides,
  };
}

function makeProfile(overrides: any = {}) {
  return {
    id: 'prof-1',
    festivalId: 'fest-unit',
    userId: 'user-1',
    name: 'Alice',
    picks: {},
    notes: {},
    reminders: {},
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// Minimal HTML template reflecting the placeholder contract expected by
// buildExportHtml (verified in source).
const TEMPLATE = [
  '<!doctype html><html><head><title>__TITLE__</title></head><body>',
  '<header><h1>__TITLE__</h1><p>__SUBTITLE__</p></header>',
  '<main>__OVERVIEW__ __LIVE__ __REMINDERS__ __SECTIONS__</main>',
  '<footer>__EXPORTED_AT__</footer></body></html>',
].join('');

// ──────────────────────────────────────────────────────────────────────────────
// Pure helpers: time / date / identity
// ──────────────────────────────────────────────────────────────────────────────

describe('export-utils pure helpers', () => {
  test('formatTime converts 24h to 12h AM/PM', () => {
    assert.equal(exportUtils.formatTime('00:00'), '12:00 AM');
    assert.equal(exportUtils.formatTime('09:05'), '9:05 AM');
    assert.equal(exportUtils.formatTime('12:00'), '12:00 PM');
    assert.equal(exportUtils.formatTime('13:30'), '1:30 PM');
    assert.equal(exportUtils.formatTime('23:59'), '11:59 PM');
  });

  test('formatTime returns empty string for falsy input', () => {
    assert.equal(exportUtils.formatTime(''), '');
    assert.equal(exportUtils.formatTime(null), '');
    assert.equal(exportUtils.formatTime(undefined), '');
  });

  test('formatExportTimestamp returns empty for invalid dates', () => {
    assert.equal(exportUtils.formatExportTimestamp(''), '');
    assert.equal(exportUtils.formatExportTimestamp('not-a-date'), '');
    const formatted = exportUtils.formatExportTimestamp('2026-06-05T10:00:00Z');
    assert.ok(formatted.length > 0, 'valid date should format to non-empty string');
  });

  test('timeToMinutes converts HH:MM to minutes', () => {
    assert.equal(exportUtils.timeToMinutes('00:00'), 0);
    assert.equal(exportUtils.timeToMinutes('01:30'), 90);
    assert.equal(exportUtils.timeToMinutes('23:59'), 23 * 60 + 59);
    assert.equal(exportUtils.timeToMinutes(''), 0);
    assert.equal(exportUtils.timeToMinutes(null), 0);
  });

  test('buildSetDateStamp returns Date for valid pair, null otherwise', () => {
    const d = exportUtils.buildSetDateStamp('2026-06-05', '10:00');
    assert.ok(d instanceof Date);
    assert.equal(Number.isNaN(d.getTime()), false);
    assert.equal(exportUtils.buildSetDateStamp('', '10:00'), null);
    assert.equal(exportUtils.buildSetDateStamp('2026-06-05', ''), null);
    assert.equal(exportUtils.buildSetDateStamp('bogus', '10:00'), null);
  });

  test('getSetTiming rolls end over midnight when end <= start', () => {
    const { start, end } = exportUtils.getSetTiming({
      dayDate: '2026-06-05',
      startTime: '23:00',
      endTime: '01:00',
    });
    assert.ok(start instanceof Date && end instanceof Date);
    assert.equal(end.getTime() - start.getTime(), 2 * 60 * 60 * 1000,
      'end should be rolled forward 24h so duration is 2h');
  });

  test('getAvatarColor is deterministic for the same name', () => {
    const a = exportUtils.getAvatarColor('Alice');
    const b = exportUtils.getAvatarColor('Alice');
    assert.equal(a, b);
    assert.match(a as string, /^#[0-9a-f]{6}$/i);
  });

  test('getAvatarColor varies across different names', () => {
    const colors = new Set(
      ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank']
        .map(exportUtils.getAvatarColor)
    );
    assert.ok(colors.size >= 3, 'expected multiple distinct colors across names');
  });

  test('getInitials returns up to 2 uppercase letters', () => {
    assert.equal(exportUtils.getInitials('Alice'), 'A');
    assert.equal(exportUtils.getInitials('alice bob'), 'AB');
    assert.equal(exportUtils.getInitials('first middle last'), 'FM');
    assert.equal(exportUtils.getInitials(''), '');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Set list building + timing selection
// ──────────────────────────────────────────────────────────────────────────────

describe('buildFestivalSetList', () => {
  test('flattens all days into a single list with dayIndex + dayLabel + dayDate', () => {
    const fest = makeFestival();
    const list = exportUtils.buildFestivalSetList(fest);
    assert.equal(list.length, 3);
    const ids = list.map((s: any) => s.id);
    assert.deepEqual(ids.sort(), ['set-a', 'set-b', 'set-c']);
    for (const entry of list) {
      assert.equal(typeof entry.dayIndex, 'number');
      assert.ok(typeof entry.dayLabel === 'string' && entry.dayLabel.length > 0);
      assert.ok(typeof entry.dayDate === 'string');
    }
  });

  test('sorts by (dayIndex, startTime, artist)', () => {
    const fest = makeFestival();
    const list = exportUtils.buildFestivalSetList(fest);
    assert.deepEqual(list.map((s: any) => s.id), ['set-a', 'set-b', 'set-c']);
  });

  test('empty/missing days returns empty array', () => {
    assert.deepEqual(exportUtils.buildFestivalSetList({}), []);
    assert.deepEqual(exportUtils.buildFestivalSetList({ days: [] }), []);
  });

  test('handles sets with no startTime (sorts after timed, by artist)', () => {
    const fest = {
      days: [{
        label: 'Day 1', date: '2026-06-05',
        sets: [
          { id: 'z', artist: 'Zed', stageId: 'main' },
          { id: 'a', artist: 'Ann', stageId: 'main', startTime: '10:00', endTime: '11:00' },
          { id: 'y', artist: 'Yves', stageId: 'main' },
        ],
      }],
    };
    const list = exportUtils.buildFestivalSetList(fest);
    assert.equal(list[0].id, 'a');
    assert.deepEqual([list[1].id, list[2].id], ['y', 'z']);
  });
});

describe('pickTimedFestivalSet', () => {
  function items() {
    return exportUtils.buildFestivalSetList(makeFestival());
  }

  test('returns null for empty list', () => {
    assert.equal(exportUtils.pickTimedFestivalSet([], '2026-06-05T10:30:00Z'), null);
  });

  test('returns first item when exportedAt is invalid', () => {
    const list = items();
    const result = exportUtils.pickTimedFestivalSet(list, 'not-a-date');
    assert.equal(result, list[0]);
  });

  test('identifies a Live now set during its window', () => {
    const list = items();
    const result = exportUtils.pickTimedFestivalSet(list, '2026-06-05T10:30:00');
    assert.ok(result && result.mode === 'Live now');
    assert.equal(result.set.id, 'set-a');
  });

  test('identifies Next move when between sets', () => {
    const list = items();
    const result = exportUtils.pickTimedFestivalSet(list, '2026-06-05T12:00:00');
    assert.ok(result && result.mode === 'Next move');
    assert.equal(result.set.id, 'set-c');
  });

  test('falls back to first item when all sets are in the past', () => {
    const list = items();
    const result = exportUtils.pickTimedFestivalSet(list, '2030-01-01T00:00:00Z');
    assert.ok(result && result.mode === 'Next move');
    assert.ok(result.set);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Label builders
// ──────────────────────────────────────────────────────────────────────────────

describe('label builders', () => {
  test('getExportPickLabel maps priorities and falls back', () => {
    assert.equal(exportUtils.getExportPickLabel('must'), 'Must See');
    assert.equal(exportUtils.getExportPickLabel('want-to-see'), 'Want to See');
    assert.equal(exportUtils.getExportPickLabel('maybe'), 'Maybe');
    assert.equal(exportUtils.getExportPickLabel('other'), 'Saved');
    assert.equal(exportUtils.getExportPickLabel(undefined), 'Saved');
  });

  test('getExportPickChipClass maps priorities and falls back', () => {
    assert.equal(exportUtils.getExportPickChipClass('must'), 'chip-must');
    assert.equal(exportUtils.getExportPickChipClass('want-to-see'), 'chip-want');
    assert.equal(exportUtils.getExportPickChipClass('maybe'), 'chip-maybe');
    assert.equal(exportUtils.getExportPickChipClass('weird'), 'chip-accent');
  });

  test('formatSetRangeLabel handles both-times, start-only, and TBA', () => {
    assert.equal(
      exportUtils.formatSetRangeLabel({ dayLabel: 'Fri', startTime: '10:00', endTime: '11:00' }),
      'Fri · 10:00 AM - 11:00 AM',
    );
    assert.equal(
      exportUtils.formatSetRangeLabel({ dayLabel: 'Fri', startTime: '10:00' }),
      'Fri · 10:00 AM',
    );
    assert.equal(
      exportUtils.formatSetRangeLabel({ dayLabel: 'Fri' }),
      'Fri · TBA',
    );
  });

  test('formatSetLocationLabel appends stage name (or Unknown)', () => {
    const map = new Map([['main', { id: 'main', name: 'Main Stage', color: '#ff3366' }]]);
    assert.equal(
      exportUtils.formatSetLocationLabel(
        { dayLabel: 'Fri', startTime: '10:00', endTime: '11:00', stageId: 'main' },
        map,
      ),
      'Fri · 10:00 AM - 11:00 AM · Main Stage',
    );
    assert.equal(
      exportUtils.formatSetLocationLabel(
        { dayLabel: 'Fri', startTime: '10:00', stageId: 'missing' },
        map,
      ),
      'Fri · 10:00 AM · Unknown',
    );
  });

  test('formatCrewOverlapLabel handles 0/1/2/N name variations', () => {
    assert.equal(exportUtils.formatCrewOverlapLabel([]), 'No shared set yet');
    assert.equal(exportUtils.formatCrewOverlapLabel(['Alice']), 'Alice also saved this');
    assert.equal(
      exportUtils.formatCrewOverlapLabel(['Alice', 'Bob']),
      'Alice and Bob also saved this',
    );
    assert.equal(
      exportUtils.formatCrewOverlapLabel(['Alice', 'Bob', 'Carol', 'Dave']),
      'Alice + 3 others also saved this',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Reminder selection
// ──────────────────────────────────────────────────────────────────────────────

describe('getExportReminderItems', () => {
  test('returns only sets with a positive lead time, sorted by startsAt', () => {
    const fest = makeFestival();
    const sets = exportUtils.buildFestivalSetList(fest);
    const profile = makeProfile({
      reminders: {
        'set-a': 15,
        'set-b': 0,
        'set-c': 30,
        'bogus': 10,
      },
    });
    const reminders = exportUtils.getExportReminderItems(sets, profile);
    assert.equal(reminders.length, 2);
    assert.deepEqual(reminders.map((r: any) => r.set.id), ['set-a', 'set-c']);
    assert.equal(reminders[0].lead, 15);
    assert.equal(reminders[1].lead, 30);
  });

  test('returns empty list when no reminders are set', () => {
    const sets = exportUtils.buildFestivalSetList(makeFestival());
    const reminders = exportUtils.getExportReminderItems(sets, makeProfile());
    assert.deepEqual(reminders, []);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Profile serialization
// ──────────────────────────────────────────────────────────────────────────────

describe('profile serialization', () => {
  test('serializeOwnProfile includes picks, notes, reminders, avatarUrl', () => {
    const profile = makeProfile({
      picks: { 'set-a': 'must' },
      notes: { 'set-a': 'Front row' },
      reminders: { 'set-a': 15 },
    });
    const user = { avatarKey: 'abc123', avatarVersion: 7 };
    const out = exportUtils.serializeOwnProfile(profile, user);
    assert.equal(out.id, 'prof-1');
    assert.equal(out.userId, 'user-1');
    assert.deepEqual(out.picks, { 'set-a': 'must' });
    assert.deepEqual(out.notes, { 'set-a': 'Front row' });
    assert.deepEqual(out.reminders, { 'set-a': 15 });
    assert.equal(out.avatarUrl, '/uploads/avatars/abc123.webp?v=7');
  });

  test('serializeOwnProfile without user yields null avatarUrl', () => {
    const out = exportUtils.serializeOwnProfile(makeProfile());
    assert.equal(out.avatarUrl, null);
  });

  test('serializeProfileForViewer hides notes/reminders from other viewers', () => {
    const profile = makeProfile({
      notes: { 'set-a': 'private' },
      reminders: { 'set-a': 15 },
    });
    const out = exportUtils.serializeProfileForViewer(profile, 'different-viewer');
    assert.equal(out.notes, undefined);
    assert.equal(out.reminders, undefined);
    assert.equal(out.userId, 'user-1');
  });

  test('serializeProfileForViewer exposes notes/reminders to owning viewer', () => {
    const profile = makeProfile({
      notes: { 'set-a': 'private' },
      reminders: { 'set-a': 15 },
    });
    const out = exportUtils.serializeProfileForViewer(profile, 'user-1');
    assert.deepEqual(out.notes, { 'set-a': 'private' });
    assert.deepEqual(out.reminders, { 'set-a': 15 });
  });

  test('serializeExportCrewProfile only exposes id/name/picks', () => {
    const profile = makeProfile({
      notes: { 'set-a': 'secret' },
      reminders: { 'set-a': 15 },
      picks: { 'set-a': 'must' },
    });
    const out: any = exportUtils.serializeExportCrewProfile(profile);
    assert.deepEqual(Object.keys(out).sort(), ['id', 'name', 'picks']);
    assert.equal(out.notes, undefined);
    assert.equal(out.reminders, undefined);
  });

  test('buildAvatarUrl returns null when key or version missing', () => {
    assert.equal(exportUtils.buildAvatarUrl(null), null);
    assert.equal(exportUtils.buildAvatarUrl({}), null);
    assert.equal(exportUtils.buildAvatarUrl({ avatarKey: 'x' }), null);
    assert.equal(exportUtils.buildAvatarUrl({ avatarVersion: 1 }), null);
    assert.equal(
      exportUtils.buildAvatarUrl({ avatarKey: 'abc', avatarVersion: 3 }),
      '/uploads/avatars/abc.webp?v=3',
    );
  });

  test('buildAvatarUrl URL-encodes the version token', () => {
    const url = exportUtils.buildAvatarUrl({ avatarKey: 'abc', avatarVersion: 'v 1&2' });
    assert.equal(url, '/uploads/avatars/abc.webp?v=v%201%262');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// HTML export
// ──────────────────────────────────────────────────────────────────────────────

describe('buildExportHtml', () => {
  test('replaces all placeholders and preserves festival name in title', () => {
    const fest = makeFestival();
    const profile = makeProfile({ picks: { 'set-a': 'must' } });
    const html = exportUtils.buildExportHtml(TEMPLATE, fest, profile, [profile], '2026-06-05T10:30:00');
    assert.ok(!/__[A-Z_]+__/.test(html), 'all __TOKEN__ placeholders should be replaced');
    assert.ok(html.includes('<title>Unit Fest</title>'), 'title token replaced with festival name');
    // Subtitle contains profile name + festival location; apostrophe gets
    // HTML-escaped (&#39; or &apos;), so match structurally around it.
    assert.match(html, /Alice(?:&#39;|&apos;|')s Schedule - Testville/);
  });

  test('escapes HTML entities in festival/artist/profile name', () => {
    const fest = makeFestival({
      name: '<script>alert(1)</script>',
      days: [{
        label: 'D1', date: '2026-06-05',
        sets: [{ id: 's-xss', artist: '<b>Evil</b>', stageId: 'main', startTime: '10:00', endTime: '11:00' }],
      }],
    });
    const profile = makeProfile({ name: 'A&B', picks: { 's-xss': 'must' } });
    const html = exportUtils.buildExportHtml(TEMPLATE, fest, profile, [profile], '2026-06-05T10:30:00');

    assert.ok(!html.includes('<script>alert(1)</script>'),
      'raw <script> tag from festival name must be escaped');
    assert.ok(!html.includes('<b>Evil</b>'),
      'raw <b> tag from artist name must be escaped');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'));
    assert.ok(html.includes('A&amp;B'));
  });

  test('renders empty-state when profile has no picks', () => {
    const fest = makeFestival();
    const profile = makeProfile();
    const html = exportUtils.buildExportHtml(TEMPLATE, fest, profile, [profile], '2026-06-05T10:30:00');
    assert.ok(html.includes('No sets picked yet'));
    assert.ok(!/__[A-Z_]+__/.test(html), 'placeholders fully replaced in empty-state too');
  });

  test('overview card shows total picks count', () => {
    const fest = makeFestival();
    const profile = makeProfile({
      picks: { 'set-a': 'must', 'set-b': 'maybe', 'set-c': 'want-to-see' },
    });
    const html = exportUtils.buildExportHtml(TEMPLATE, fest, profile, [profile], '2026-06-05T10:30:00');
    assert.ok(html.includes('Total picks'));
    assert.ok(html.includes('<strong>3</strong>'));
  });

  test('includes crew section when another profile shares picks', () => {
    const fest = makeFestival();
    const mine = makeProfile({
      id: 'p-me', name: 'Me', userId: 'u-me',
      picks: { 'set-a': 'must' },
    });
    const crewMate = makeProfile({
      id: 'p-friend', name: 'Friend', userId: 'u-friend',
      picks: { 'set-a': 'must' },
    });
    const html = exportUtils.buildExportHtml(TEMPLATE, fest, mine, [mine, crewMate], '2026-06-05T10:30:00');
    assert.ok(html.includes('Crew Schedules'));
    assert.ok(html.includes('Friend'));
  });

  test('omits crew section when no other profile has picks', () => {
    const fest = makeFestival();
    const mine = makeProfile({ picks: { 'set-a': 'must' } });
    const html = exportUtils.buildExportHtml(TEMPLATE, fest, mine, [mine], '2026-06-05T10:30:00');
    assert.ok(!html.includes('Crew Schedules'));
  });

  test('getExportCurrentOrNextPickedSet returns Live now during a picked window', () => {
    const fest = makeFestival();
    const sets = exportUtils.buildFestivalSetList(fest);
    const profile = makeProfile({ picks: { 'set-a': 'must' } });
    const result = exportUtils.getExportCurrentOrNextPickedSet(sets, profile, '2026-06-05T10:30:00');
    assert.ok(result);
    assert.equal(result.mode, 'Live now');
    assert.equal(result.set.id, 'set-a');
  });

  test('getExportCurrentOrNextPickedSet returns null when nothing is picked', () => {
    const fest = makeFestival();
    const sets = exportUtils.buildFestivalSetList(fest);
    const profile = makeProfile();
    const result = exportUtils.getExportCurrentOrNextPickedSet(sets, profile, '2026-06-05T10:30:00');
    assert.equal(result, null);
  });

  test('getExportNextCrewOverlap returns null when no crewmate shares a pick', () => {
    const fest = makeFestival();
    const sets = exportUtils.buildFestivalSetList(fest);
    const mine = makeProfile({ id: 'p-me', userId: 'u-me', picks: { 'set-a': 'must' } });
    const other = makeProfile({ id: 'p-other', userId: 'u-other', picks: {} });
    const result = exportUtils.getExportNextCrewOverlap(sets, mine, [mine, other], '2026-06-05T09:00:00');
    assert.equal(result, null);
  });

  test('getExportNextCrewOverlap returns overlap info when crewmate shares pick', () => {
    const fest = makeFestival();
    const sets = exportUtils.buildFestivalSetList(fest);
    const mine = makeProfile({ id: 'p-me', userId: 'u-me', name: 'Me', picks: { 'set-a': 'must' } });
    const crewmate = makeProfile({ id: 'p-c', userId: 'u-c', name: 'Cassie', picks: { 'set-a': 'must' } });
    const result = exportUtils.getExportNextCrewOverlap(sets, mine, [mine, crewmate], '2026-06-05T10:30:00');
    assert.ok(result);
    assert.equal(result.set.id, 'set-a');
    assert.deepEqual(result.otherNames, ['Cassie']);
  });
});
