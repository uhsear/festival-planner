// The pure validators under test (isValidDate / isValidTime / HEX_RE) are
// lifted into lib/adminValidators.ts — a framework-free module with no react /
// react-native imports — so this test loads cleanly under node-vitest without
// stubbing the token runtime. AdminFields.tsx re-exports them for the component.
import { isValidDate, isValidTime, HEX_RE } from '../../lib/adminValidators';

// Mobile-LOCAL validators for the OTA-able admin write surface (no native
// datetimepicker / color-picker). These are the pure branches behind
// DateField / TimeField / HexColorField -- the screens themselves are thin, so
// the validation logic is the meaningful thing to lock down.

describe('isValidDate (YYYY-MM-DD calendar date)', () => {
  it('accepts a real date', () => {
    expect(isValidDate('2026-06-23')).toBe(true);
  });

  it('accepts a valid leap day (2024-02-29)', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects a non-leap-year Feb 29 (2025-02-29)', () => {
    expect(isValidDate('2025-02-29')).toBe(false);
  });

  it('rejects an impossible day-of-month (2026-02-30)', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
  });

  it('rejects an out-of-range month (2026-13-01)', () => {
    expect(isValidDate('2026-13-01')).toBe(false);
  });

  it('rejects a non-ISO format (6/23/26)', () => {
    expect(isValidDate('6/23/26')).toBe(false);
  });

  it('rejects empty, garbage and partial values', () => {
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('TBA')).toBe(false);
    expect(isValidDate('2026-6-3')).toBe(false); // unpadded
    expect(isValidDate('2026-00-10')).toBe(false); // month 0
    expect(isValidDate('2026-06-00')).toBe(false); // day 0
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidDate('  2026-06-23  ')).toBe(true);
  });
});

describe('isValidTime (24h HH:MM)', () => {
  it('accepts midnight and the last minute of the day', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('rejects 24:00 (hour out of range)', () => {
    expect(isValidTime('24:00')).toBe(false);
  });

  it('rejects 23:60 (minute out of range)', () => {
    expect(isValidTime('23:60')).toBe(false);
  });

  it("rejects unpadded '9:5'", () => {
    expect(isValidTime('9:5')).toBe(false);
  });

  it('rejects empty and garbage', () => {
    expect(isValidTime('')).toBe(false);
    expect(isValidTime('noon')).toBe(false);
    expect(isValidTime('12:00:00')).toBe(false); // seconds not allowed
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidTime('  09:05  ')).toBe(true);
  });
});

describe('HEX_RE (#RRGGBB)', () => {
  it('accepts a full lowercase 6-digit hex', () => {
    expect(HEX_RE.test('#1a2b3c')).toBe(true);
  });

  it('accepts uppercase and mixed-case hex', () => {
    expect(HEX_RE.test('#1A2B3C')).toBe(true);
    expect(HEX_RE.test('#FfAa00')).toBe(true);
  });

  it('rejects the 3-digit shorthand (#fff)', () => {
    expect(HEX_RE.test('#fff')).toBe(false);
  });

  it('rejects a named color (red)', () => {
    expect(HEX_RE.test('red')).toBe(false);
  });

  it('rejects out-of-range hex digits (#GGGGGG)', () => {
    expect(HEX_RE.test('#GGGGGG')).toBe(false);
  });

  it('rejects missing hash, wrong length, and empty', () => {
    expect(HEX_RE.test('1a2b3c')).toBe(false); // no #
    expect(HEX_RE.test('#1a2b3')).toBe(false); // 5 digits
    expect(HEX_RE.test('#1a2b3cc')).toBe(false); // 7 digits
    expect(HEX_RE.test('')).toBe(false);
  });
});
