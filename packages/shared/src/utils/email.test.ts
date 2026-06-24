import { describe, it, expect } from 'vitest';
import { isValidEmail, EMAIL_RE } from './email';

describe('EMAIL_RE / isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
    expect(EMAIL_RE.test('alice@example.com')).toBe(true);
  });

  it('accepts subdomained and plus-tagged addresses', () => {
    expect(isValidEmail('bob.smith+tag@mail.festie.us')).toBe(true);
  });

  it('rejects a missing @', () => {
    expect(isValidEmail('alice.example.com')).toBe(false);
  });

  it('rejects a missing TLD dot', () => {
    expect(isValidEmail('alice@example')).toBe(false);
  });

  it('rejects a numeric-only / too-short TLD', () => {
    expect(isValidEmail('alice@example.c')).toBe(false);
    expect(isValidEmail('alice@example.12')).toBe(false);
  });

  it('rejects addresses with whitespace', () => {
    expect(isValidEmail('alice @example.com')).toBe(false);
    expect(isValidEmail('alice@exa mple.com')).toBe(false);
  });

  it('treats empty / nullish as invalid (no throw)', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });
});
