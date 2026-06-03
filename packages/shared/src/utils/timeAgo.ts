/**
 * Compact "synced N ago" relative-time label from an **epoch-ms** timestamp.
 *
 * Single source of truth for the offline-freshness surfaces (web PendingSyncSheet,
 * mobile OfflineBanner, mobile crew tab) that previously each inlined an identical
 * copy. Pure and platform-agnostic — `Date.now()` works the same on web and RN.
 *
 * Buckets: <45s → "just now", <60m → "Nm ago", <24h → "Nh ago", else "Nd ago".
 * A negative or non-finite delta (clock skew, missing timestamp) collapses to
 * "just now" so the UI never shows a nonsensical "-3m ago".
 */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
