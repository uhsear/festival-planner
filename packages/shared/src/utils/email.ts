/**
 * Email validation — a single UX-level check shared by web (register) and mobile
 * (forgot-password). This is intentionally a lightweight client-side gate; the
 * backend Zod schemas remain the authoritative validation boundary.
 *
 * Pure, no globals — safe for both web and React Native.
 */

/**
 * UX-level email pattern: one-or-more non-space chars, an `@`, one-or-more
 * non-space chars, a dot, and a 2+ letter TLD. Anchored. This unifies the two
 * prior per-app regexes (`/^\S+@\S+\.\w{2,}$/` and `/^\S+@\S+\.[a-zA-Z]{2,}$/`)
 * onto the stricter letters-only TLD form.
 */
export const EMAIL_RE = /^\S+@\S+\.[a-zA-Z]{2,}$/;

/** True when `value` looks like a valid email (UX check only — not a security boundary). */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return EMAIL_RE.test(value);
}
