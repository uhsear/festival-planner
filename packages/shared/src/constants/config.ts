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
 *   STALE_MS           — a peer older than this is swept from the map (matches
 *                        the server's 120s TTL; client sweep is defense in depth).
 *   MAX_SESSION_MS     — hard cap (60 min): forgotten sharing auto-stops.
 */
export const LIVE_LOCATION = {
  UPDATE_INTERVAL_MS: 10_000,
  MIN_MOVE_METERS: 15,
  STALE_MS: 120_000,
  MAX_SESSION_MS: 3_600_000,
} as const;

export const SOCKET_RECONNECTION_CONFIG = {
  reconnection: true,
  reconnectionDelay: 1000,
  randomizationFactor: 0.5,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
};
