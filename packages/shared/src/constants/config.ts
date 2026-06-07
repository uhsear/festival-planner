import { Priority } from '../types/domain';

export const API_BASE = '/api/v1';

export const PRIORITY_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  must: 'var(--priority-must)',
  'want-to-see': 'var(--priority-want)',
  maybe: 'var(--priority-maybe)',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'Must See',
  'want-to-see': 'Want to See',
  maybe: 'Maybe',
};

export const TRUSTED_MUTATION_HEADER = 'X-Festie-Request';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const OFFLINE_SNAPSHOT_KEY = 'festivalPlannerOfflineSnapshotV2';

export const LEGACY_OFFLINE_KEYS = ['festivalPlannerOfflineSnapshotV1'];

export const OFFLINE_SYNC_KEY = 'festivalPlannerPendingProfileSyncV1';

export const MAX_IMPORT_TEXT_LENGTH = 200000;

/**
 * Live Location tuning shared by web + mobile publishers. OFF by default; these
 * only apply once a user opts in per-session. Conservative on purpose: festival
 * phones have poor signal + limited battery.
 *   UPDATE_INTERVAL_MS — min time between published fixes (~10s).
 *   MIN_MOVE_METERS    — publish early if moved more than this since last send.
 *   FRESH_MS           — a peer newer than this reads as "live" (pulsing avatar);
 *                        between FRESH_MS and STALE_MS the marker desaturates and
 *                        shows a "last seen N ago" chip before it's swept.
 *   STALE_MS           — a peer older than this is swept from the map (matches
 *                        the server's 120s TTL; client sweep is defense in depth).
 *   MAX_SESSION_MS     — default hard cap (60 min): forgotten sharing auto-stops
 *                        when no explicit duration was chosen (e.g. web).
 */
export const LIVE_LOCATION = {
  UPDATE_INTERVAL_MS: 10_000,
  MIN_MOVE_METERS: 15,
  FRESH_MS: 30_000,
  STALE_MS: 120_000,
  MAX_SESSION_MS: 3_600_000,
} as const;

/**
 * Time-boxed live-location sharing (the mobile opt-in sheet). Sharing is already
 * foreground-only and auto-stops on background; on top of that the user picks an
 * explicit bound up-front (default ~2h, Find My-style) after which the publisher
 * auto-expires — no silent indefinite sharing. `ms: null` = "until the festival
 * ends", which is clamped to LIVE_SHARE_MAX_MS so a forgotten session can never
 * run unbounded even if the device stays foregrounded.
 */
export const LIVE_SHARE_MAX_MS = 12 * 3_600_000;

export interface LiveShareDuration {
  id: string;
  label: string;
  /** Bound in ms, or null for "until the festival ends" (clamped to LIVE_SHARE_MAX_MS). */
  ms: number | null;
}

export const LIVE_SHARE_DURATIONS: readonly LiveShareDuration[] = [
  { id: '1h', label: '1 hour', ms: 3_600_000 },
  { id: '2h', label: '2 hours', ms: 7_200_000 },
  { id: '4h', label: '4 hours', ms: 14_400_000 },
  { id: 'festival', label: 'Until the festival ends', ms: null },
];

export const LIVE_SHARE_DEFAULT_DURATION_ID = '2h';

/** Resolve a preset's effective bound in ms (null → the festival ceiling). */
export function resolveLiveShareMs(d: LiveShareDuration): number {
  return d.ms == null ? LIVE_SHARE_MAX_MS : Math.min(d.ms, LIVE_SHARE_MAX_MS);
}

export const SOCKET_RECONNECTION_CONFIG = {
  reconnection: true,
  reconnectionDelay: 1000,
  randomizationFactor: 0.5,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
};
