import { formatFestivalDate, formatDateSpan, passwordStrength } from './accountFormat';

describe('formatFestivalDate', () => {
  it('formats a YYYY-MM-DD date without a timezone shift', () => {
    expect(formatFestivalDate('2025-06-21')).toBe('Jun 21, 2025');
  });
  it('reads the calendar parts off a full ISO timestamp', () => {
    expect(formatFestivalDate('2025-12-01T23:30:00.000Z')).toBe('Dec 1, 2025');
  });
  it('returns null for empty input and echoes an unparseable string', () => {
    expect(formatFestivalDate(null)).toBeNull();
    expect(formatFestivalDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateSpan', () => {
  it('collapses a single-day festival to one date', () => {
    expect(formatDateSpan('2025-06-21', '2025-06-21')).toBe('Jun 21, 2025');
  });
  it('drops the repeated year inside a same-year span', () => {
    expect(formatDateSpan('2025-06-21', '2025-06-23')).toBe('Jun 21 – Jun 23, 2025');
  });
  it('keeps both years when they differ', () => {
    expect(formatDateSpan('2024-12-31', '2025-01-01')).toBe('Dec 31, 2024 – Jan 1, 2025');
  });
  it('returns null when both ends are missing', () => {
    expect(formatDateSpan(null, null)).toBeNull();
  });
});

describe('passwordStrength', () => {
  it('scores empty as 0 with no label', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });
  it('flags sub-8-char as too short', () => {
    expect(passwordStrength('abc')).toEqual({ score: 1, label: 'Too short' });
  });
  it('rewards length + variety toward strong', () => {
    expect(passwordStrength('Abcdefgh1!').score).toBeGreaterThanOrEqual(3);
  });
});
