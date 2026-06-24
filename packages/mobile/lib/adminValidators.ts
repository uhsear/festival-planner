// adminValidators — mobile-LOCAL, framework-free validators for the admin edit
// surfaces. Lifted out of components/admin/AdminFields.tsx so the pure branches
// behind DateField / TimeField / HexColorField can be unit-tested in isolation
// without pulling react / react-native (and the token runtime) into a node
// vitest run. AdminFields.tsx re-exports these, so the component and any other
// importer are unchanged.
//
// No React, no react-native imports — keep this importable from a plain test.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The accepted #RRGGBB hex-color pattern (6 hex digits, leading hash). */
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** True when the value is a structurally-valid YYYY-MM-DD calendar date. */
export function isValidDate(value: string): boolean {
  const v = value.trim();
  if (!DATE_RE.test(v)) return false;
  const parts = v.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True when the value is a valid 24h HH:MM time. */
export function isValidTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

/** Empty or a literal "TBA" (case-insensitive) is the permitted fallback. */
export function isTbaFallback(value: string): boolean {
  const v = value.trim();
  return v === '' || v.toLowerCase() === 'tba';
}
