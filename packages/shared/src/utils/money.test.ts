import { describe, it, expect } from 'vitest';
import { formatBalance, formatAmount } from './money';

describe('formatBalance', () => {
  it('prefixes a positive balance with +$', () => {
    expect(formatBalance(12.5)).toBe('+$12.50');
  });

  it('prefixes a negative balance with -$ using the absolute value', () => {
    expect(formatBalance(-12.5)).toBe('-$12.50');
  });

  it('renders exact zero as $0.00', () => {
    expect(formatBalance(0)).toBe('$0.00');
  });

  it('swallows sub-cent rounding noise inside the epsilon to $0.00', () => {
    expect(formatBalance(0.01)).toBe('$0.00');
    expect(formatBalance(-0.01)).toBe('$0.00');
    expect(formatBalance(0.005)).toBe('$0.00');
    expect(formatBalance(-0.009)).toBe('$0.00');
  });

  it('treats values just past the epsilon as signed', () => {
    expect(formatBalance(0.02)).toBe('+$0.02');
    expect(formatBalance(-0.02)).toBe('-$0.02');
  });

  it('rounds to two decimal places', () => {
    expect(formatBalance(1.005)).toBe('+$1.00');
    expect(formatBalance(2.349)).toBe('+$2.35');
  });
});

describe('formatAmount', () => {
  it('formats a numeric amount as $X.XX', () => {
    expect(formatAmount(9.5)).toBe('$9.50');
  });

  it('coerces a string amount (the API returns amounts as strings)', () => {
    expect(formatAmount('15')).toBe('$15.00');
    expect(formatAmount('15.4')).toBe('$15.40');
  });

  it('renders zero as $0.00', () => {
    expect(formatAmount(0)).toBe('$0.00');
  });

  it('does not sign negative amounts (bare formatter)', () => {
    expect(formatAmount(-3.2)).toBe('$-3.20');
  });
});
