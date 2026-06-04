import { create } from 'zustand';
import { api } from '../services/api';
import { mapErrorToUserMessage } from '../services/errors';
import { useFestivalDataStore } from './festivalDataStore';
import type { Priority } from '../types';

/**
 * Spotify user-OAuth store (M4) — WEB consumption for now.
 *
 * Mirrors the backend spotify-auth routes (Authorization Code + PKCE):
 *   GET  /spotify/auth/start            → { authorizeUrl, state }
 *   GET  /spotify/auth/callback         → server redirect target (not called here)
 *   GET  /spotify/status                → { configured, connected, spotifyUserId, connectedAt }
 *   GET  /spotify/suggestions/:festivalId → { suggestions, unmatchedFallback, total }
 *   POST /spotify/playlist/:festivalId  → { playlistId, playlistUrl, trackCount, artistCount }
 *   POST /spotify/disconnect            → { connected: false }
 *
 * Tokens NEVER touch the client: connect() kicks off the server-driven OAuth by
 * redirecting the browser to Spotify's authorize URL; the server stores the
 * encrypted refresh token and redirects back into the SPA. confirmPicks() flows
 * accepted suggestions through the EXISTING offline-native pick path
 * (festivalDataStore.savePick) so picks survive the write-queue + read-cache.
 *
 * DORMANT-aware: when the backend reports `configured: false` (redirect URI not
 * yet registered) the UI shows "Spotify not configured" instead of a connect CTA.
 * A 503 from any endpoint is mapped to the same dormant state, never an error.
 */

// ── API response shapes (post-envelope-unwrap) ────────────────────────────────

/** GET /spotify/status — connection status. NEVER carries a token. */
export interface SpotifyStatus {
  /** Backend feature gate: false until SPOTIFY_REDIRECT_URI/client id are set. */
  configured: boolean;
  /** Whether THIS user has an encrypted refresh token stored. */
  connected: boolean;
  spotifyUserId: string | null;
  /** ISO timestamp the account was connected, or null. */
  connectedAt: string | null;
}

/** GET /spotify/auth/start — server hands back the authorize URL to redirect to. */
interface SpotifyAuthStart {
  authorizeUrl: string;
  state: string;
}

/** One matched lineup set from GET /spotify/suggestions/:festivalId. */
export interface SpotifySuggestion {
  setId: string;
  artistName: string | null;
  spotifyArtistId: string;
  /** Why this set was suggested — sources that contributed (e.g. top_short, followed). */
  reasons: string[];
  /** Server's default suggested priority. NOTE: backend uses 'want', domain uses 'want-to-see'. */
  suggestedPriority: 'must' | 'want' | 'maybe';
}

/** GET /spotify/suggestions/:festivalId envelope. */
export interface SpotifySuggestionsResult {
  suggestions: SpotifySuggestion[];
  /** True when lineup artists lack a stored Spotify ID (name-only fallback possible). */
  unmatchedFallback: boolean;
  total: number;
}

/** POST /spotify/playlist/:festivalId result. */
export interface SpotifyPlaylistResult {
  playlistId: string;
  playlistUrl: string | null;
  trackCount: number;
  artistCount: number;
}

// ── Priority mapping ──────────────────────────────────────────────────────────
// The suggestion API returns 'want' (Spotify-side label); the domain Priority is
// 'want-to-see'. Map at the store boundary so the rest of the app only ever sees
// the canonical domain Priority.
const SERVER_PRIORITY_TO_DOMAIN: Record<SpotifySuggestion['suggestedPriority'], Priority> = {
  must: 'must',
  want: 'want-to-see',
  maybe: 'maybe',
};

export function suggestedToDomainPriority(p: SpotifySuggestion['suggestedPriority']): Priority {
  return SERVER_PRIORITY_TO_DOMAIN[p];
}

/** True when an error is the backend's "not configured" 503 (dormant gate). */
function isNotConfigured(err: unknown): boolean {
  const e = err as { status?: number };
  return e?.status === 503;
}

/** True when an error is the backend's "not connected" 409 (re-connect needed). */
function isNotConnected(err: unknown): boolean {
  const e = err as { status?: number };
  return e?.status === 409;
}

interface SpotifyState {
  /** Last-loaded connection status, or null before the first load. */
  connectionStatus: SpotifyStatus | null;
  /** Last-loaded suggestion result for the active festival, or null. */
  suggestions: SpotifySuggestionsResult | null;
  /** Result of the most recent playlist build, surfaced as a success link. */
  playlist: SpotifyPlaylistResult | null;
  statusLoading: boolean;
  suggestionsLoading: boolean;
  /** True while a playlist build POST is in flight. */
  playlistBuilding: boolean;
  /** True while confirmPicks is saving accepted suggestions. */
  confirming: boolean;
  error: string | null;
}

interface SpotifyActions {
  /**
   * Kick off the server-driven OAuth: ask the backend for the authorize URL and
   * redirect the browser to it. The server stores the PKCE verifier + state and,
   * on callback, the encrypted refresh token — no token ever touches the client.
   * Returns the authorizeUrl (also navigated to) so a test/caller can assert it.
   * On the dormant 503 it sets connectionStatus.configured=false and returns null.
   */
  connect: () => Promise<string | null>;
  /** GET /spotify/status; tolerant of the dormant 503 (treated as not-configured). */
  loadStatus: () => Promise<void>;
  /** GET /spotify/suggestions/:festivalId; 503 → not-configured, 409 → not-connected. */
  loadSuggestions: (festivalId: string) => Promise<void>;
  /**
   * Save the user's accepted suggestions into picks. `picks` maps setId →
   * chosen domain Priority (or null to skip/clear). Each accepted artist flows
   * through festivalDataStore.savePick — the SAME offline-native path the manual
   * star uses — so it queues + caches exactly like a hand pick. Resolves after
   * every write settles (best-effort: one failing write doesn't abort the rest).
   */
  confirmPicks: (picks: Record<string, Priority | null>) => Promise<void>;
  /**
   * POST /spotify/playlist/:festivalId — build a playlist from the user's saved
   * picks. Stores the result (playlistUrl) for the success UI.
   */
  createPlaylist: (festivalId: string) => Promise<SpotifyPlaylistResult | null>;
  /** POST /spotify/disconnect — forget the connection. */
  disconnect: () => Promise<void>;
  /** Clear the last playlist-build result (e.g. after the user dismisses it). */
  clearPlaylist: () => void;
  setError: (error: string | null) => void;
}

export type SpotifyStore = SpotifyState & SpotifyActions;

export const useSpotifyStore = create<SpotifyStore>((set) => ({
  connectionStatus: null,
  suggestions: null,
  playlist: null,
  statusLoading: false,
  suggestionsLoading: false,
  playlistBuilding: false,
  confirming: false,
  error: null,

  connect: async () => {
    set({ error: null });
    try {
      const { authorizeUrl } = await api.get<SpotifyAuthStart>('/spotify/auth/start');
      // Full-page redirect into Spotify's consent screen. The server round-trips
      // the code → refresh token and redirects back to /spotify/connected.
      if (typeof window !== 'undefined' && authorizeUrl) {
        window.location.assign(authorizeUrl);
      }
      return authorizeUrl ?? null;
    } catch (err) {
      if (isNotConfigured(err)) {
        // Dormant: surface the not-configured state, no error toast.
        set((s) => ({
          connectionStatus: {
            connected: false,
            spotifyUserId: null,
            connectedAt: null,
            ...(s.connectionStatus ?? {}),
            configured: false,
          },
        }));
        return null;
      }
      set({ error: mapErrorToUserMessage(err, 'Could not start Spotify connect') });
      throw err;
    }
  },

  loadStatus: async () => {
    set({ statusLoading: true, error: null });
    try {
      const status = await api.get<SpotifyStatus>('/spotify/status');
      set({ connectionStatus: status, statusLoading: false });
    } catch (err) {
      // /spotify/status itself never 503s (it reports configured), but be tolerant:
      // a dormant deploy or a transient failure shouldn't hard-error the page.
      if (isNotConfigured(err)) {
        set({
          connectionStatus: { configured: false, connected: false, spotifyUserId: null, connectedAt: null },
          statusLoading: false,
        });
        return;
      }
      set({ error: mapErrorToUserMessage(err, 'Could not read Spotify status'), statusLoading: false });
    }
  },

  loadSuggestions: async (festivalId: string) => {
    set({ suggestionsLoading: true, error: null });
    try {
      const result = await api.get<SpotifySuggestionsResult>(`/spotify/suggestions/${festivalId}`);
      set({ suggestions: result, suggestionsLoading: false });
    } catch (err) {
      if (isNotConfigured(err)) {
        set((s) => ({
          suggestions: null,
          suggestionsLoading: false,
          connectionStatus: {
            ...(s.connectionStatus ?? { connected: false, spotifyUserId: null, connectedAt: null }),
            configured: false,
          } as SpotifyStatus,
        }));
        return;
      }
      if (isNotConnected(err)) {
        // The refresh token is gone/expired server-side — reflect disconnected.
        set((s) => ({
          suggestions: null,
          suggestionsLoading: false,
          connectionStatus: s.connectionStatus
            ? { ...s.connectionStatus, connected: false }
            : { configured: true, connected: false, spotifyUserId: null, connectedAt: null },
        }));
        return;
      }
      set({ error: mapErrorToUserMessage(err, 'Could not load Spotify suggestions'), suggestionsLoading: false });
      throw err;
    }
  },

  confirmPicks: async (picks: Record<string, Priority | null>) => {
    set({ confirming: true, error: null });
    const dataState = useFestivalDataStore.getState();
    const savePick = dataState.savePick;
    // savePick keys off the active profile (currentProfile) for the write; the
    // festivalId in the request is for the type contract / online revalidation.
    const festivalId = dataState.currentFestivalId ?? dataState.currentProfile?.festivalId ?? '';
    const entries = Object.entries(picks).filter(([, priority]) => priority != null) as Array<[string, Priority]>;
    let firstError: unknown = null;
    // Sequential so each savePick's optimistic merge sees the prior write's
    // picks map (savePick merges onto currentProfile.picks). Best-effort: keep
    // going on a single failure so one bad write can't drop the rest.
    for (const [setId, priority] of entries) {
      try {
        await savePick({ festivalId, setId, priority });
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
    if (firstError) {
      set({ confirming: false, error: mapErrorToUserMessage(firstError, 'Some picks could not be saved') });
      return;
    }
    set({ confirming: false });
  },

  createPlaylist: async (festivalId: string) => {
    set({ playlistBuilding: true, error: null });
    try {
      const result = await api.post<SpotifyPlaylistResult>(`/spotify/playlist/${festivalId}`);
      set({ playlist: result, playlistBuilding: false });
      return result;
    } catch (err) {
      if (isNotConfigured(err)) {
        set((s) => ({
          playlistBuilding: false,
          connectionStatus: {
            ...(s.connectionStatus ?? { connected: false, spotifyUserId: null, connectedAt: null }),
            configured: false,
          } as SpotifyStatus,
        }));
        return null;
      }
      set({ error: mapErrorToUserMessage(err, 'Could not build the playlist'), playlistBuilding: false });
      throw err;
    }
  },

  disconnect: async () => {
    set({ error: null });
    try {
      await api.post('/spotify/disconnect');
      set((s) => ({
        connectionStatus: s.connectionStatus
          ? { ...s.connectionStatus, connected: false, spotifyUserId: null, connectedAt: null }
          : { configured: true, connected: false, spotifyUserId: null, connectedAt: null },
        suggestions: null,
        playlist: null,
      }));
    } catch (err) {
      set({ error: mapErrorToUserMessage(err, 'Could not disconnect Spotify') });
      throw err;
    }
  },

  clearPlaylist: () => set({ playlist: null }),

  setError: (error: string | null) => set({ error }),
}));
