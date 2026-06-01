import { describe, it, expect } from 'vitest';
import { festivalStatus } from './festivalTime';
import type { Festival } from '../types/domain';

function fest(overrides: Partial<Festival> = {}): Festival {
  return {
    id: 'f1',
    name: 'Test Fest',
    startDate: '2026-09-04',
    endDate: '2026-09-06',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('festivalStatus', () => {
  it("returns 'past' after the final day's 23:59", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-07T00:00:00'))).toBe('past');
  });

  it("returns 'upcoming' before the first day", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-08-01T00:00:00'))).toBe('upcoming');
  });

  it("returns 'ongoing' during the festival", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-05T12:00:00'))).toBe('ongoing');
  });

  it('prefers inline days[] over start/end dates', () => {
    const f = fest({ startDate: '', endDate: '' });
    const days = [{ date: '2026-09-04' }, { date: '2026-09-06' }];
    expect(festivalStatus(f, days, new Date('2026-09-07T00:00:00'))).toBe('past');
    expect(festivalStatus(f, days, new Date('2026-08-01T00:00:00'))).toBe('upcoming');
  });

  it('returns null when no dates are available', () => {
    expect(festivalStatus(fest({ startDate: '', endDate: '' }), undefined, new Date())).toBeNull();
    expect(festivalStatus(null)).toBeNull();
  });
});
