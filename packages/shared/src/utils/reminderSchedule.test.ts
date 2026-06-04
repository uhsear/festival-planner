import { describe, it, expect } from 'vitest';
import { buildReminderPlan, diffReminderPlan, reminderIdentifier, MAX_LOCAL_REMINDERS } from './reminderSchedule';
import type { FestivalSet, FestivalDay, Priority } from '../types/domain';

// A fixed "now" the local-frame helpers anchor against. The planner builds set
// times via getSetTimeBounds (local frame), so we compute expectations the same
// way the impl does rather than hardcoding a TZ-specific epoch.
const DAY = '2026-08-15';
const days: FestivalDay[] = [
  {
    id: 'd0',
    festivalId: 'f1',
    date: DAY,
    dayIndex: 0,
    createdAt: '',
    updatedAt: '',
  },
];

function makeSet(id: string, startTime: string, endTime = ''): FestivalSet {
  return {
    id,
    festivalId: 'f1',
    stageId: 's1',
    dayIndex: 0,
    startTime,
    endTime,
    createdAt: '',
    updatedAt: '',
  };
}

// Local-frame epoch for a wall-clock on the festival day (mirrors createDateInLocalFrame).
function localMs(hh: number, mm: number): number {
  const [y, m, d] = DAY.split('-').map((x) => parseInt(x, 10));
  const dt = new Date();
  dt.setFullYear(y, m - 1, d);
  dt.setHours(hh, mm, 0, 0);
  return dt.getTime();
}

describe('buildReminderPlan', () => {
  it('schedules a reminder at start − lead with the deterministic id', () => {
    const sets = [makeSet('a', '20:00')];
    const reminders = { a: 15 };
    const picks: Record<string, Priority> = { a: 'must' };
    const nowMs = localMs(10, 0); // well before the set

    const plan = buildReminderPlan({ reminders, picks, sets, days, nowMs });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.identifier).toBe('festie-reminder-a');
    expect(plan[0]!.fireAtMs).toBe(localMs(20, 0) - 15 * 60_000);
    expect(plan[0]!.leadMinutes).toBe(15);
    expect(plan[0]!.startMs).toBe(localMs(20, 0));
  });

  it('drops reminders whose fire time is already past', () => {
    const sets = [makeSet('a', '20:00')];
    const reminders = { a: 15 };
    // now is after 19:45 (the fire time) — should be dropped.
    const nowMs = localMs(19, 50);
    const plan = buildReminderPlan({ reminders, picks: {}, sets, days, nowMs });
    expect(plan).toHaveLength(0);
  });

  it('skips TBA sets (no start time) and unknown setIds', () => {
    const sets = [makeSet('a', ''), makeSet('b', '21:00')];
    const reminders = { a: 10, missing: 10, b: 10 };
    const plan = buildReminderPlan({ reminders, picks: {}, sets, days, nowMs: localMs(8, 0) });
    expect(plan.map((e) => e.setId)).toEqual(['b']);
  });

  it('prioritizes must > want-to-see > maybe when capping', () => {
    // Three sets, all reminded; cap to 2 — must + want kept, maybe dropped.
    const sets = [makeSet('m', '22:00'), makeSet('w', '21:00'), makeSet('y', '20:00')];
    const reminders = { m: 10, w: 10, y: 10 };
    const picks: Record<string, Priority> = { m: 'must', w: 'want-to-see', y: 'maybe' };
    const plan = buildReminderPlan({ reminders, picks, sets, days, nowMs: localMs(8, 0), max: 2 });
    const ids = plan.map((e) => e.setId);
    expect(ids).toContain('m');
    expect(ids).toContain('w');
    expect(ids).not.toContain('y');
  });

  it('within the same priority, earlier fire times win', () => {
    const sets = [makeSet('late', '22:00'), makeSet('early', '20:00')];
    const reminders = { late: 10, early: 10 };
    const picks: Record<string, Priority> = { late: 'must', early: 'must' };
    const plan = buildReminderPlan({ reminders, picks, sets, days, nowMs: localMs(8, 0), max: 1 });
    expect(plan.map((e) => e.setId)).toEqual(['early']);
  });

  it('caps to the iOS limit by default', () => {
    expect(MAX_LOCAL_REMINDERS).toBe(64);
  });

  it('returns empty when reminders is null/undefined', () => {
    const sets = [makeSet('a', '20:00')];
    expect(buildReminderPlan({ reminders: null, picks: {}, sets, days })).toEqual([]);
    expect(buildReminderPlan({ reminders: undefined, picks: {}, sets, days })).toEqual([]);
  });

  it('ignores negative / non-finite lead minutes', () => {
    const sets = [makeSet('a', '20:00')];
    const reminders = { a: -5 } as Record<string, number>;
    expect(buildReminderPlan({ reminders, picks: {}, sets, days, nowMs: localMs(8, 0) })).toEqual([]);
  });
});

describe('diffReminderPlan', () => {
  it('cancels festie reminders no longer in the plan, keeps foreign ids', () => {
    const sets = [makeSet('a', '20:00')];
    const plan = buildReminderPlan({ reminders: { a: 10 }, picks: {}, sets, days, nowMs: localMs(8, 0) });
    const scheduled = ['festie-reminder-a', 'festie-reminder-old', 'some-other-app-notif'];

    const { toSchedule, toCancel } = diffReminderPlan(plan, scheduled);
    expect(toSchedule).toBe(plan);
    expect(toCancel).toEqual(['festie-reminder-old']);
  });
});

describe('reminderIdentifier', () => {
  it('is deterministic', () => {
    expect(reminderIdentifier('xyz')).toBe('festie-reminder-xyz');
  });
});
