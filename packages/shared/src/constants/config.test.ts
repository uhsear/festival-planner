import { describe, it, expect } from 'vitest';
import {
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  CREW_ACTIVITY_LABELS,
  EXPENSE_CATEGORIES,
  expenseCategoryFor,
  RATING_SCALE_DATA,
  RATING_SCALE,
  RATING_LABEL,
} from './config';
import { PRIORITY_WEIGHT } from '../utils/crewNudges';

describe('PRIORITY_LABEL', () => {
  it('has short labels for all three priorities', () => {
    expect(PRIORITY_LABEL.must).toBe('Must');
    expect(PRIORITY_LABEL['want-to-see']).toBe('Want');
    expect(PRIORITY_LABEL.maybe).toBe('Maybe');
  });
});

describe('PRIORITY_WEIGHT', () => {
  it('must > want-to-see > maybe', () => {
    expect(PRIORITY_WEIGHT.must).toBeGreaterThan(PRIORITY_WEIGHT['want-to-see']);
    expect(PRIORITY_WEIGHT['want-to-see']).toBeGreaterThan(PRIORITY_WEIGHT.maybe);
  });

  it('has values 3 / 2 / 1', () => {
    expect(PRIORITY_WEIGHT.must).toBe(3);
    expect(PRIORITY_WEIGHT['want-to-see']).toBe(2);
    expect(PRIORITY_WEIGHT.maybe).toBe(1);
  });
});

describe('PRIORITY_OPTIONS', () => {
  it('has exactly three entries', () => {
    expect(PRIORITY_OPTIONS).toHaveLength(3);
  });

  it('covers all three priority values', () => {
    const values = PRIORITY_OPTIONS.map((o) => o.value);
    expect(values).toContain('must');
    expect(values).toContain('want-to-see');
    expect(values).toContain('maybe');
  });

  it('sort order is ascending must→want→maybe', () => {
    const sorted = [...PRIORITY_OPTIONS].sort((a, b) => a.sort - b.sort);
    expect(sorted[0]!.value).toBe('must');
    expect(sorted[1]!.value).toBe('want-to-see');
    expect(sorted[2]!.value).toBe('maybe');
  });

  it('short matches PRIORITY_LABEL', () => {
    for (const opt of PRIORITY_OPTIONS) {
      expect(opt.short).toBe(PRIORITY_LABEL[opt.value]);
    }
  });
});

describe('CREW_ACTIVITY_LABELS', () => {
  it('covers core crew event types', () => {
    const required = [
      'member-joined',
      'member-left',
      'member-kicked',
      'poll-created',
      'poll-voted',
      'expense-added',
      'expense-deleted',
      'expense-settled',
      'home-base-updated',
      'meeting-point-added',
      'meeting-point-removed',
      'crew-updated',
    ];
    for (const key of required) {
      expect(CREW_ACTIVITY_LABELS[key], `missing key: ${key}`).toBeTruthy();
    }
  });

  it('all values are non-empty strings', () => {
    for (const [, label] of Object.entries(CREW_ACTIVITY_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('EXPENSE_CATEGORIES', () => {
  it('has 6 entries', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(6);
  });

  it('last entry is "other" (the fallback)', () => {
    expect(EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]!.id).toBe('other');
  });

  it('all entries have non-empty id, emoji and label', () => {
    for (const cat of EXPENSE_CATEGORIES) {
      expect(cat.id.length).toBeGreaterThan(0);
      expect(cat.emoji.length).toBeGreaterThan(0);
      expect(cat.label.length).toBeGreaterThan(0);
    }
  });
});

describe('expenseCategoryFor', () => {
  it('returns the matching category by id', () => {
    expect(expenseCategoryFor('food').label).toBe('Food');
    expect(expenseCategoryFor('transport').label).toBe('Ride');
  });

  it('falls back to "other" for unknown id', () => {
    expect(expenseCategoryFor('unknown').id).toBe('other');
  });
});

describe('RATING_SCALE_DATA', () => {
  it('has 5 entries, values 1-5', () => {
    expect(RATING_SCALE_DATA).toHaveLength(5);
    const values = RATING_SCALE_DATA.map((r) => r.value);
    expect(values).toContain(1);
    expect(values).toContain(5);
  });

  it('order is highest-first (value 5 is order 0)', () => {
    const fire = RATING_SCALE_DATA.find((r) => r.value === 5)!;
    const skip = RATING_SCALE_DATA.find((r) => r.value === 1)!;
    expect(fire.order).toBeLessThan(skip.order);
  });
});

describe('RATING_SCALE', () => {
  it('is [5, 4, 3, 2, 1]', () => {
    expect(RATING_SCALE).toEqual([5, 4, 3, 2, 1]);
  });
});

describe('RATING_LABEL', () => {
  it('maps 5→Fire, 1→Skip', () => {
    expect(RATING_LABEL[5]).toBe('Fire');
    expect(RATING_LABEL[1]).toBe('Skip');
  });
});
