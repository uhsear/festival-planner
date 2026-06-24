import { describe, it, expect } from 'vitest';
import { buildOngoingNotificationModel, pickOngoingMeetingPoint, type OngoingSetInput } from './ongoingNotification';
import type { CrewMeetingPoint, FestivalDay } from '../types/domain';

const DAY = '2026-09-04';
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

function set(id: string, startTime: string, endTime: string, name: string): OngoingSetInput {
  return {
    set: { id, startTime, endTime, date: DAY, dayIndex: 0 },
    name,
    stageName: 'Main',
  };
}

// 2026-09-04 in the LOCAL frame (the model uses createDateInLocalFrame).
function localMs(hh: number, mm: number): number {
  const d = new Date();
  d.setFullYear(2026, 8, 4);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

function mp(over: Partial<CrewMeetingPoint> = {}): CrewMeetingPoint {
  return {
    id: 'mp1',
    crew_id: 'c1',
    created_by: 'u1',
    label: 'Tower',
    location: 'NE corner',
    type: 'during',
    meet_at: null,
    stage_reference: null,
    active: true,
    created_at: '2026-09-04T10:00:00Z',
    ...over,
  };
}

describe('buildOngoingNotificationModel', () => {
  it('is inactive when there are no timed picks', () => {
    const m = buildOngoingNotificationModel({ sets: [], days, now: localMs(20, 0) });
    expect(m.active).toBe(false);
    expect(m.title).toBeNull();
  });

  it('is inactive well before the festival window (beyond lead-in)', () => {
    const sets = [set('s1', '20:00', '21:00', 'Anyma')];
    // 6h before first set — outside the 1h lead-in.
    const m = buildOngoingNotificationModel({ sets, days, now: localMs(14, 0) });
    expect(m.active).toBe(false);
  });

  it('activates within the lead-in and shows the NEXT set with a countdown', () => {
    const sets = [set('s1', '20:00', '21:00', 'Anyma')];
    const m = buildOngoingNotificationModel({ sets, days, now: localMs(19, 35) });
    expect(m.active).toBe(true);
    expect(m.focusSet).toEqual({ id: 's1', name: 'Anyma', kind: 'next' });
    expect(m.title).toContain('Next: Anyma');
    expect(m.title).toContain('25m');
  });

  it('shows the NOW set while it is playing, with until-clock', () => {
    const sets = [set('s1', '20:00', '21:00', 'Anyma')];
    const m = buildOngoingNotificationModel({ sets, days, now: localMs(20, 30) });
    expect(m.focusSet?.kind).toBe('now');
    expect(m.title).toBe('Now: Anyma');
    expect(m.body).toContain('until 21:00');
  });

  it('appends an offline-honest last-synced meeting-point line', () => {
    const sets = [set('s1', '20:00', '21:00', 'Anyma')];
    const m = buildOngoingNotificationModel({
      sets,
      days,
      meetingPoints: [mp()],
      now: localMs(20, 30),
    });
    expect(m.meetingPointLabel).toBe('Tower');
    expect(m.body).toContain('Meet: Tower');
    expect(m.body).toContain('last-synced');
    // NEVER implies live/real-time.
    expect(m.body?.toLowerCase()).not.toContain('live');
  });

  it('is inactive long after the last set ends (beyond linger)', () => {
    const sets = [set('s1', '20:00', '21:00', 'Anyma')];
    const m = buildOngoingNotificationModel({ sets, days, now: localMs(23, 0) });
    expect(m.active).toBe(false);
  });

  it('stays active between sets and surfaces just the meeting point', () => {
    const sets = [set('s1', '20:00', '20:30', 'A'), set('s2', '22:00', '23:00', 'B')];
    // 21:00 is between the two sets but inside the window.
    const m = buildOngoingNotificationModel({
      sets,
      days,
      meetingPoints: [mp()],
      now: localMs(21, 0),
    });
    expect(m.active).toBe(true);
    // s2 is the next set, so it focuses s2 rather than going meeting-point-only.
    expect(m.focusSet?.id).toBe('s2');
  });
});

describe('pickOngoingMeetingPoint', () => {
  it('returns null for an empty list', () => {
    expect(pickOngoingMeetingPoint([])).toBeNull();
  });

  it('prefers an active point over an inactive newer one', () => {
    const inactiveNewer = mp({ id: 'a', active: false, created_at: '2026-09-04T12:00:00Z' });
    const activeOlder = mp({ id: 'b', active: true, created_at: '2026-09-04T09:00:00Z' });
    expect(pickOngoingMeetingPoint([inactiveNewer, activeOlder])?.id).toBe('b');
  });

  it('falls back to the most recent when none are flagged active', () => {
    const older = mp({ id: 'a', active: false, created_at: '2026-09-04T09:00:00Z' });
    const newer = mp({ id: 'b', active: false, created_at: '2026-09-04T12:00:00Z' });
    expect(pickOngoingMeetingPoint([older, newer])?.id).toBe('b');
  });
});
