/**
 * Compact "synced N ago" relative-time label from an **epoch-ms** timestamp.
 *
 * Single source of truth for the offline-freshness surfaces (web PendingSyncSheet,
 * mobile OfflineBanner, mobile crew tab) that previously each inlined an identical
 * copy. Pure and platform-agnostic — `Date.now()` works the same on web and RN.
 *
 * Buckets: <60s → "just now", <60m → "Nm ago", <24h → "Nh ago", else "Nd ago".
 * (Sub-minute collapses to "just now" rather than a glitchy "0m ago".)
 * A negative or non-finite delta (clock skew, missing timestamp) collapses to
 * "just now" so the UI never shows a nonsensical "-3m ago".
 */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Human-readable uptime string from a raw seconds value (server process uptime).
 *
 * Buckets: seconds-only → "Nm", hours present → "Nh Nm", days present → "Nd Nh Nm".
 * The `d` component is omitted when zero so "0d 2h 30m" never appears.
 *
 * Used by the admin dashboard health card on both web (AdminDashboard.tsx) and
 * mobile (admin/index.tsx) so they render identically from a single source.
 */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const mn = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${hr}h ${mn}m`;
  if (hr > 0) return `${hr}h ${mn}m`;
  return `${mn}m`;
}
