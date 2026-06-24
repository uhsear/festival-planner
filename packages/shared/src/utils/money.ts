/**
 * Money formatting shared by the web SPA and the mobile app so both render
 * expense amounts and balances identically.
 *
 * These are pure, non-pixel string formatters: the per-platform pixel code
 * (Tailwind class strings on web, RN StyleSheet on mobile) picks the color and
 * weight; these decide the text.
 */

/** Below this magnitude a balance is treated as exactly zero (rounding noise). */
const ZERO_EPSILON = 0.01;

/**
 * Signed balance string for a net position:
 *   value >  0.01  → "+$X.XX"  (they're owed)
 *   value < -0.01  → "-$X.XX"  (they owe)
 *   otherwise      → "$0.00"   (settled, swallowing sub-cent rounding noise)
 */
export function formatBalance(value: number): string {
  if (value > ZERO_EPSILON) return `+$${value.toFixed(2)}`;
  if (value < -ZERO_EPSILON) return `-$${Math.abs(value).toFixed(2)}`;
  return '$0.00';
}

/**
 * Bare currency string for a (non-signed) amount: "$X.XX". Coerces string|number
 * inputs (the API returns amounts as strings) the same way both apps did inline.
 */
export function formatAmount(value: string | number): string {
  return `$${Number(value).toFixed(2)}`;
}
