/**
 * Pure formatting + scoring helpers for the Account tab. No React Native / DOM
 * imports so this stays trivially unit-testable and safe to import anywhere.
 *
 * Lives in packages/mobile/lib (mobile-local) rather than @festie/shared because
 * it is presentation-only sugar for the native Account screen; the shared
 * package owns the data shapes, not how mobile chrome labels them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Format an ISO-ish date string into a short, human label like "Jun 21, 2025".
 *
 * The server's festival dates arrive as 'YYYY-MM-DD' (or a full ISO timestamp);
 * we parse the calendar parts by hand instead of `new Date(iso)` so a device in
 * a negative UTC offset doesn't render the day before (the classic midnight-UTC
 * off-by-one). Returns the raw input on any parse miss so we never blank a date.
 */
export function formatFestivalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const month = MONTHS[monthIdx];
  if (!month || day < 1 || day > 31) return iso;
  return `${month} ${day}, ${year}`;
}

/**
 * Human date span for a festival row. Collapses a single-day festival to one
 * date, drops the repeated year when both ends share it ("Jun 21 – 23, 2025"),
 * and keeps both years when they differ.
 */
export function formatDateSpan(start: string | null | undefined, end: string | null | undefined): string | null {
  const a = formatFestivalDate(start);
  const b = formatFestivalDate(end);
  if (!a && !b) return null;
  if (a && b && a !== b) {
    // Same year → "Jun 21, 2025 – Jun 23, 2025" reads as "Jun 21 – Jun 23, 2025".
    const aYear = a.slice(a.lastIndexOf(',') + 1).trim();
    const bYear = b.slice(b.lastIndexOf(',') + 1).trim();
    if (aYear && aYear === bYear) {
      const aNoYear = a.slice(0, a.lastIndexOf(',')).trim();
      return `${aNoYear} – ${b}`;
    }
    return `${a} – ${b}`;
  }
  return a || b;
}

/**
 * Format a 24h 'HH:MM' clock string into a 12h label like "11:00 PM" / "8:00 AM".
 * Returns the raw input on any parse miss so a caption never blanks. Used by the
 * quiet-hours caption so it reflects the stored DND window instead of a
 * hardcoded "11 PM – 8 AM".
 */
export function formatClockTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  let hour = Number(m[1]);
  const minutes = m[2];
  if (hour < 0 || hour > 23 || Number(minutes) > 59) return hhmm;
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minutes} ${period}`;
}

/**
 * Human label for a quiet-hours / DND window, e.g. "11:00 PM – 8:00 AM".
 * Returns null when either bound is missing so callers can fall back.
 */
export function formatQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const a = formatClockTime(start);
  const b = formatClockTime(end);
  if (!a || !b) return null;
  return `${a} – ${b}`;
}

export interface PasswordStrength {
  /** 0 (empty) … 4 (strong). Drives the meter segment count + label. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/**
 * Lightweight password-strength heuristic for the change-password meter. This is
 * UX guidance only — the authoritative rule is the shared 8-char minimum the
 * form already enforces; this just rewards length + character variety so a user
 * gets a "weak / fair / good / strong" nudge as they type.
 */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: '' };
  let points = 0;
  if (pw.length >= 8) points += 1;
  if (pw.length >= 12) points += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points += 1;
  if (/\d/.test(pw)) points += 1;
  if (/[^A-Za-z0-9]/.test(pw)) points += 1;
  // Anything under the 8-char floor can never read above "Weak".
  if (pw.length < 8) {
    return { score: 1, label: 'Too short' };
  }
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  const label = (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  return { score, label };
}
