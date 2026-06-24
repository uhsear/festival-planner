import { describe, it, expect } from 'vitest';
import { pickActiveMeetingPoint, buildSlots, CREW_PLAN_SLOTS } from './crewPlan';
import { createDateInLocalFrame } from './setStatus';
import type { CrewMeetingPoint, FestivalDay, FestivalSet, Profile } from '../types/domain';

// ── Fixture helpers ────────────────────────────────────────────────────────
const mp = (over: Partial<CrewMeetingPoint>): CrewMeetingPoint =>
  ({
    id: 'mp',
    crew_id: 'c1',
    created_by: 'u1',
    label: 'Big tree',
    location: 'North field',
    type: 'custom',
    meet_at: null,
    stage_reference: null,
    ...over,
  }) as CrewMeetingPoint;

const day: FestivalDay = { date: '2026-09-04' } as FestivalDay;
// Device-local epoch-ms for a wall-clock time on the fixture day.
const at = (hh: number, mm = 0) => createDateInLocalFrame(day.date, hh, mm).getTime();

const set = (id: string, startTime: string, endTime: string): FestivalSet =>
  ({ id, stageId: 's1', dayIndex: 0, startTime, endTime } as unknown as FestivalSet);

const profile = (id: string, name: string, picks: Record<string, string>): Profile =>
  ({ id, userId: id, festivalId: 'f1', name, picks, notes: {}, updatedAt: '' } as unknown as Profile);

describe('pickActiveMeetingPoint', () => {
  const nowMs = at(12, 0);

  it('returns null for no points', () => {
    expect(pickActiveMeetingPoint([], nowMs)).toBeNull();
  });

  it('ignores inactive points', () => {
    const p = mp({ id: 'a', active: false, meet_at: new Date(at(15)).toISOString() } as Partial<CrewMeetingPoint>);
    expect(pickActiveMeetingPoint([p], nowMs)).toBeNull();
  });

  it('picks the soonest future-or-now timed point', () => {
    const later = mp({ id: 'later', active: true, meet_at: new Date(at(18)).toISOString() } as Partial<CrewMeetingPoint>);
    const soon = mp({ id: 'soon', active: true, meet_at: new Date(at(13)).toISOString() } as Partial<CrewMeetingPoint>);
    const past = mp({ id: 'past', active: true, meet_at: new Date(at(9)).toISOString() } as Partial<CrewMeetingPoint>);
    expect(pickActiveMeetingPoint([later, soon, past], nowMs)?.id).toBe('soon');
  });

  it('falls back to an active untimed point when no future timed point exists', () => {
    const past = mp({ id: 'past', active: true, meet_at: new Date(at(9)).toISOString() } as Partial<CrewMeetingPoint>);
    const standing = mp({ id: 'standing', active: true, meet_at: null });
    expect(pickActiveMeetingPoint([past, standing], nowMs)?.id).toBe('standing');
  });
});

describe('buildSlots', () => {
  const days = [day];
  const nowMs = at(12, 0);

  it('keeps only not-yet-ended sets and caps to the slot limit', () => {
    const sets = [
      set('past', '09:00', '10:00'), // ended before now → dropped
      set('a', '13:00', '14:00'),
      set('b', '15:00', '16:00'),
      set('c', '17:00', '18:00'),
      set('d', '19:00', '20:00'), // 4th distinct start → capped out (limit 3)
    ];
    const profiles = [
      profile('m1', 'Ann', { a: 'must', b: 'want-to-see', c: 'maybe', d: 'must' }),
    ];
    const slots = buildSlots(sets, days, profiles, nowMs);
    expect(slots).toHaveLength(CREW_PLAN_SLOTS);
    expect(slots.map((s) => s.startTime)).toEqual(['13:00', '15:00', '17:00']);
  });

  it('surfaces each member highest-priority pick, strongest first', () => {
    const sets = [set('a', '13:00', '14:00'), set('a2', '13:00', '14:00')];
    const profiles = [
      profile('m1', 'Ann', { a: 'maybe', a2: 'must' }), // best = must (a2)
      profile('m2', 'Bo', { a: 'want-to-see' }),
    ];
    const [slot] = buildSlots(sets, days, profiles, nowMs);
    expect(slot!.picks.map((p) => [p.memberName, p.priority])).toEqual([
      ['Ann', 'must'],
      ['Bo', 'want-to-see'],
    ]);
    expect(slot!.picks[0]!.set.id).toBe('a2');
  });

  it('honors a custom slot limit', () => {
    const sets = [set('a', '13:00', '14:00'), set('b', '15:00', '16:00')];
    const profiles = [profile('m1', 'Ann', { a: 'must', b: 'must' })];
    expect(buildSlots(sets, days, profiles, nowMs, 1)).toHaveLength(1);
  });
});
