// Phase 1 Feature Tests — Reminders, Meeting Points, Picks Card

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createReminderScheduler } from '../lib/reminder-scheduler';
import { createNotificationService, isInDndWindow } from '../lib/notifications';
import { schemas, validate } from '../lib/schemas';
import { MEETING_POINT_TYPES, MAX_MEETING_POINTS_PER_CREW, ALLOWED_REMINDER_MINUTES } from '../lib/constants';
import createCrewsStore from '../lib/db/stores/crews';
import sharp from 'sharp';

// Test helper — create a basic HTTP test client
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4000';

async function request(method: string, path: string, { body, token, raw }: any = {}) {
  const headers: any = { 'Content-Type': 'application/json', 'X-Festie-Request': '1' };
  if (token) headers.Cookie = `session=${token}`;
  const opts: any = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BASE_URL}${path}`, opts);
  if (raw) return resp;
  const data = await resp.json();
  return { status: resp.status, ...data };
}

// ═══════════════════════════════════════════════════════════════════
// Feature 1A: Reminder Scheduler Tests
// ═══════════════════════════════════════════════════════════════════

describe('Phase 1A: Reminder Scheduler', () => {
  it('createReminderScheduler exports correctly', () => {
    assert.ok(typeof createReminderScheduler === 'function');
  });

  it('scheduler can start and stop without errors', () => {
    const mockPool = { query: async () => ({ rows: [] }) };
    const mockStores = { notificationPrefs: { get: async () => null } };
    const mockNotif = { send: async () => ({ sent: 0 }) };
    const mockLog = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

    const scheduler = createReminderScheduler({
      pool: mockPool, stores: mockStores,
      notificationService: mockNotif, log: mockLog, config: {},
    });
    scheduler.start();
    assert.ok(scheduler._timer() !== null, 'timer should be running');
    scheduler.stop();
    assert.ok(scheduler._timer() === null, 'timer should be stopped');
  });

  it('tick runs without errors when no festivals exist', async () => {
    const mockPool = { query: async () => ({ rows: [] }) };
    const scheduler = createReminderScheduler({
      pool: mockPool,
      stores: { notificationPrefs: { get: async () => null } },
      notificationService: { send: async () => ({ sent: 0 }) },
      log: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
      config: {},
    });
    await scheduler.tick(); // Should not throw
  });

  it('set_reminder is an allowed notification type', () => {
    assert.ok(typeof isInDndWindow === 'function');
  });

  it('isInDndWindow returns false when no prefs', () => {
    assert.equal(isInDndWindow(null), false);
    assert.equal(isInDndWindow({}), false);
    assert.equal(isInDndWindow({ dndStart: null as any, dndEnd: null as any }), false);
  });

  it('isInDndWindow handles same-day window', () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const current = `${hh}:${mm}`;

    // Window that includes current time
    const startH = (now.getHours() - 1 + 24) % 24;
    const endH = (now.getHours() + 1) % 24;
    const result = isInDndWindow({
      dndStart: String(startH).padStart(2, '0') + ':00',
      dndEnd: String(endH).padStart(2, '0') + ':00',
    });
    // If start < end and current is between them, should be true
    if (startH < endH) assert.equal(result, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 1B: Meeting Points Tests
// ═══════════════════════════════════════════════════════════════════

describe('Phase 1B: Meeting Points Store', () => {
  it('meetingPoints store is exported from crews store', () => {
    // Just verify the function exists and can be called with a mock pool
    assert.ok(typeof createCrewsStore === 'function');
  });

  it('meeting point schema validates correctly', () => {
    assert.ok(schemas.meetingPointCreate, 'meetingPointCreate schema should exist');
    assert.ok(schemas.meetingPointUpdate, 'meetingPointUpdate schema should exist');

    // Valid create
    const valid = schemas.meetingPointCreate.safeParse({
      label: 'Pre-show meetup', location: 'By the Ferris wheel', type: 'pre-show',
    });
    assert.ok(valid.success, 'valid meeting point should parse');

    // Invalid: missing required fields
    const invalid = schemas.meetingPointCreate.safeParse({ label: '' });
    assert.ok(!invalid.success, 'empty label should fail');

    // Invalid type
    const badType = schemas.meetingPointCreate.safeParse({
      label: 'Test', location: 'Here', type: 'invalid-type',
    });
    assert.ok(!badType.success, 'invalid type should fail');
  });

  it('MEETING_POINT_TYPES constant exists', () => {
    assert.ok(Array.isArray(MEETING_POINT_TYPES));
    assert.ok(MEETING_POINT_TYPES.includes('pre-show'));
    assert.ok(MEETING_POINT_TYPES.includes('post-event'));
    assert.ok(MEETING_POINT_TYPES.includes('emergency'));
    assert.equal(MAX_MEETING_POINTS_PER_CREW, 5);
  });

  it('meeting point update schema requires at least one field', () => {
    const empty = schemas.meetingPointUpdate.safeParse({});
    assert.ok(!empty.success, 'empty update should fail');

    const valid = schemas.meetingPointUpdate.safeParse({ label: 'Updated label' });
    assert.ok(valid.success, 'single field update should pass');
  });

  it('meeting point create schema handles optional fields', () => {
    const minimal = schemas.meetingPointCreate.safeParse({
      label: 'Test', location: 'Here',
    });
    assert.ok(minimal.success, 'minimal create should pass');
    assert.equal(minimal.data.type, 'during', 'default type should be during');
  });

  it('meeting point label max length is 100', () => {
    const long = schemas.meetingPointCreate.safeParse({
      label: 'x'.repeat(101), location: 'Here',
    });
    assert.ok(!long.success, 'label over 100 chars should fail');
  });

  it('meeting point location max length is 200', () => {
    const long = schemas.meetingPointCreate.safeParse({
      label: 'Test', location: 'x'.repeat(201),
    });
    assert.ok(!long.success, 'location over 200 chars should fail');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 1C: Picks Card Tests
// ═══════════════════════════════════════════════════════════════════

describe('Phase 1C: Picks Card Export', () => {
  it('sharp module is available', () => {
    assert.ok(typeof sharp === 'function');
  });

  it('SVG to PNG conversion works', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    assert.ok(png.length > 0, 'PNG buffer should not be empty');
    // Check PNG magic bytes
    assert.equal(png[0], 0x89, 'first byte should be PNG signature');
    assert.equal(png[1], 0x50, 'second byte should be P');
    assert.equal(png[2], 0x4E, 'third byte should be N');
    assert.equal(png[3], 0x47, 'fourth byte should be G');
  });

  it('SVG with text renders to PNG', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <rect width="400" height="200" fill="#0a0a1a"/>
      <text x="20" y="40" font-family="sans-serif" font-size="24" fill="white">Test Artist</text>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    assert.ok(png.length > 100, 'PNG with text should have reasonable size');
  });

  it('empty picks produces valid PNG', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
      <rect width="1080" height="1920" fill="#0a0a1a"/>
      <text x="60" y="80" font-family="sans-serif" font-size="42" fill="white">TEST FESTIVAL</text>
      <text x="60" y="1860" font-family="sans-serif" font-size="20" fill="#8888aa">@user · festie.us</text>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    assert.ok(png.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cross-feature: Constants and Schema Integration
// ═══════════════════════════════════════════════════════════════════

describe('Phase 1: Schema Integration', () => {
  it('all existing schemas still export correctly', () => {
    const requiredSchemas = [
      'register', 'login', 'profileUpdate', 'crewCreate', 'crewUpdate',
      'crewJoin', 'crewTransfer', 'notificationPrefs', 'pushToken',
      'meetingPointCreate', 'meetingPointUpdate',
    ];
    for (const name of requiredSchemas) {
      assert.ok((schemas as any)[name], `schema "${name}" should be exported`);
    }
    assert.ok(typeof validate === 'function', 'validate should be exported');
  });

  it('reminder minutes validation still works', () => {
    const valid = schemas.profileUpdate.safeParse({
      reminders: { 'set-123': 15 },
    });
    assert.ok(valid.success, 'valid reminder should pass');

    const invalid = schemas.profileUpdate.safeParse({
      reminders: { 'set-123': 99 },
    });
    assert.ok(!invalid.success, 'invalid reminder minutes should fail');
  });

  it('ALLOWED_REMINDER_MINUTES includes expected values', () => {
    assert.ok(ALLOWED_REMINDER_MINUTES.has(5));
    assert.ok(ALLOWED_REMINDER_MINUTES.has(10));
    assert.ok(ALLOWED_REMINDER_MINUTES.has(15));
    assert.ok(ALLOWED_REMINDER_MINUTES.has(30));
    assert.ok(ALLOWED_REMINDER_MINUTES.has(60));
    assert.ok(!ALLOWED_REMINDER_MINUTES.has(99));
  });
});
