import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSpotifyStore, suggestedToDomainPriority } from '@festie/shared/stores/spotifyStore';
import { useFestivalStore } from '@festie/shared/stores';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import type { Priority, FestivalSet } from '@festie/shared/types';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { useToast } from '../../lib/toastContext';
import { Music, Check, ListMusic, ExternalLink, X } from 'lucide-react';

/**
 * SpotifyConnect (M4, WEB) — connect-to-Spotify CTA + connected state +
 * suggestions review sheet + "build playlist from my picks".
 *
 * Tokens never touch the client: `connect()` redirects the browser to the
 * server-issued authorize URL; the server stores the encrypted refresh token
 * and redirects back to /spotify/connected (handled by SpotifyCallback).
 *
 * Dormant-aware: when the backend reports `configured: false` (redirect URI not
 * registered yet) we render a quiet "Spotify not configured" note instead of a
 * connect button. Accepted suggestions flow through the offline-native pick path
 * (festivalDataStore.savePick via the store's confirmPicks).
 */

// The three pick buckets, in display order, mapped to the domain Priority.
const PRIORITY_CHOICES: ReadonlyArray<{ value: Priority; label: string; accent: string }> = [
  { value: 'must', label: 'Must', accent: 'var(--color-priority-must)' },
  { value: 'want-to-see', label: 'Want', accent: 'var(--color-priority-want)' },
  { value: 'maybe', label: 'Maybe', accent: 'var(--color-priority-maybe)' },
];

interface SpotifyConnectProps {
  festivalId: string;
}

export default function SpotifyConnect({ festivalId }: SpotifyConnectProps) {
  const status = useSpotifyStore((s) => s.connectionStatus);
  const suggestions = useSpotifyStore((s) => s.suggestions);
  const playlist = useSpotifyStore((s) => s.playlist);
  const statusLoading = useSpotifyStore((s) => s.statusLoading);
  const suggestionsLoading = useSpotifyStore((s) => s.suggestionsLoading);
  const playlistBuilding = useSpotifyStore((s) => s.playlistBuilding);
  const confirming = useSpotifyStore((s) => s.confirming);

  const connect = useSpotifyStore((s) => s.connect);
  const loadStatus = useSpotifyStore((s) => s.loadStatus);
  const loadSuggestions = useSpotifyStore((s) => s.loadSuggestions);
  const confirmPicks = useSpotifyStore((s) => s.confirmPicks);
  const createPlaylist = useSpotifyStore((s) => s.createPlaylist);
  const clearPlaylist = useSpotifyStore((s) => s.clearPlaylist);
  const disconnect = useSpotifyStore((s) => s.disconnect);

  const { toast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Load the connection status once on mount so we know whether to show connect
  // vs connected (and whether Spotify is configured at all).
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const configured = status?.configured ?? true; // assume configured until told otherwise
  const connected = status?.connected ?? false;

  const handleConnect = useCallback(async () => {
    try {
      const url = await connect();
      if (!url) {
        // Dormant (503) — connect() set configured=false; nothing to redirect to.
        toast('Spotify is not available right now', 'error');
      }
      // On success the browser is already navigating away.
    } catch {
      toast('Could not start Spotify connect', 'error');
    }
  }, [connect, toast]);

  const handleOpenSuggestions = useCallback(async () => {
    setSheetOpen(true);
    try {
      await loadSuggestions(festivalId);
    } catch {
      toast('Could not load suggestions', 'error');
    }
  }, [loadSuggestions, festivalId, toast]);

  const handleBuildPlaylist = useCallback(async () => {
    try {
      const result = await createPlaylist(festivalId);
      if (result) {
        toast(`Playlist built · ${result.trackCount} tracks`, 'success');
      } else {
        toast('Spotify is not available right now', 'error');
      }
    } catch {
      toast('Could not build the playlist', 'error');
    }
  }, [createPlaylist, festivalId, toast]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      toast('Spotify disconnected', 'success');
    } catch {
      toast('Could not disconnect Spotify', 'error');
    }
  }, [disconnect, toast]);

  // ── Dormant: backend says not configured ───────────────────────────────────
  if (!configured) {
    return (
      <div
        className="rounded-xl border border-border bg-bg-card p-4 flex items-center gap-3"
        role="status"
        aria-label="Spotify not configured"
      >
        <Music className="w-5 h-5 text-text-muted" aria-hidden="true" />
        <div className="text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">Spotify not configured</span>
          <span className="block text-xs text-text-muted">
            Connecting Spotify isn&apos;t available yet — check back soon.
          </span>
        </div>
      </div>
    );
  }

  // ── Not connected: connect CTA ──────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <Music className="w-5 h-5 text-[#1DB954]" aria-hidden="true" />
          <div className="text-sm">
            <span className="font-semibold text-text-primary">Connect Spotify</span>
            <span className="block text-xs text-text-muted">
              Auto-suggest picks from your top &amp; followed artists on this lineup.
            </span>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={handleConnect}
          isLoading={statusLoading}
          aria-label="Connect Spotify"
        >
          <Music className="w-4 h-4" aria-hidden="true" />
          Connect Spotify
        </Button>
      </div>
    );
  }

  // ── Connected: suggestions + playlist actions ───────────────────────────────
  return (
    <>
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Check className="w-4 h-4 text-[#1DB954]" aria-hidden="true" />
          <span className="text-sm font-semibold text-text-primary">Spotify connected</span>
          {status?.spotifyUserId && <span className="text-xs text-text-muted truncate">· {status.spotifyUserId}</span>}
          <button
            type="button"
            onClick={handleDisconnect}
            className="ml-auto text-xs text-text-muted hover:text-text-secondary"
            aria-label="Disconnect Spotify"
          >
            Disconnect
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={handleOpenSuggestions}
            aria-label="Review Spotify pick suggestions"
          >
            <Music className="w-4 h-4" aria-hidden="true" />
            Suggest picks
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={handleBuildPlaylist}
            isLoading={playlistBuilding}
            aria-label="Build a playlist from my picks"
          >
            <ListMusic className="w-4 h-4" aria-hidden="true" />
            Build playlist from my picks
          </Button>
        </div>

        {playlist && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#1DB954]/40 bg-[#1DB954]/10 px-3 py-2 text-sm">
            <Check className="w-4 h-4 text-[#1DB954]" aria-hidden="true" />
            <span className="text-text-secondary">
              {playlist.trackCount} tracks from {playlist.artistCount} artists
            </span>
            {playlist.playlistUrl && (
              <a
                href={playlist.playlistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[#1DB954] font-semibold hover:underline"
              >
                Open <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              onClick={clearPlaylist}
              className="text-text-muted hover:text-text-secondary"
              aria-label="Dismiss playlist result"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {sheetOpen && (
        <SuggestionsSheet
          loading={suggestionsLoading}
          confirming={confirming}
          suggestions={suggestions}
          onConfirm={async (picks) => {
            await confirmPicks(picks);
            const n = Object.values(picks).filter((p) => p != null).length;
            toast(
              n > 0 ? `Added ${n} pick${n === 1 ? '' : 's'} from Spotify` : 'No picks added',
              n > 0 ? 'success' : 'error',
            );
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Suggestions review sheet — must/want/maybe chips per matched set + bulk
// "Add all" (reusing the M2 bulk-add intent), then confirm into picks.
// ════════════════════════════════════════════════════════════════════════════

interface SuggestionsSheetProps {
  loading: boolean;
  confirming: boolean;
  suggestions: ReturnType<typeof useSpotifyStore.getState>['suggestions'];
  onConfirm: (picks: Record<string, Priority | null>) => Promise<void>;
  onClose: () => void;
}

function SuggestionsSheet({ loading, confirming, suggestions, onConfirm, onClose }: SuggestionsSheetProps) {
  const sets = useFestivalStore((s) => s.sets);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const setsById = useMemo(() => {
    const m = new Map<string, FestivalSet>();
    for (const s of sets) m.set(s.id, s);
    return m;
  }, [sets]);

  // Per-set chosen priority (or null = skip). Seeded from the server's
  // suggestedPriority once the suggestions arrive.
  const [choices, setChoices] = useState<Record<string, Priority | null>>({});
  useEffect(() => {
    if (!suggestions) return;
    const seed: Record<string, Priority | null> = {};
    for (const s of suggestions.suggestions) {
      seed[s.setId] = suggestedToDomainPriority(s.suggestedPriority);
    }
    setChoices(seed);
  }, [suggestions]);

  const items = useMemo(() => suggestions?.suggestions ?? [], [suggestions]);
  const acceptedCount = Object.values(choices).filter((p) => p != null).length;

  const setChoice = useCallback((setId: string, value: Priority | null) => {
    setChoices((prev) => ({ ...prev, [setId]: prev[setId] === value ? null : value }));
  }, []);

  // M2-style bulk "add all" — apply ONE priority to every matched set at once.
  const addAll = useCallback(
    (value: Priority) => {
      setChoices(() => {
        const next: Record<string, Priority | null> = {};
        for (const s of items) next[s.setId] = value;
        return next;
      });
    },
    [items],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Spotify pick suggestions"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-bg-secondary border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-bg-secondary">
          <h2 className="text-sm font-bold text-text-primary">Suggested from your Spotify</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary p-1" aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted" aria-busy="true">
            Matching your top artists to the lineup…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No matches between your Spotify artists and this lineup yet.
          </div>
        ) : (
          <>
            {/* Bulk "add all" — reuses the M2 add-all intent across the matched set. */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-muted">Add all as</span>
              {PRIORITY_CHOICES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => addAll(p.value)}
                  className="text-xs px-2.5 py-1 rounded-full border border-border text-text-secondary hover:bg-bg-card-hover"
                  aria-label={`Add all matched sets as ${p.label}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <ul className="divide-y divide-border">
              {items.map((s) => {
                const set = setsById.get(s.setId);
                const name = set ? artistDisplayName(set, currentFestival?.b2bSeparator) : s.artistName || 'Unknown';
                const time = set?.startTime ? formatTime(set.startTime) : '';
                const chosen = choices[s.setId] ?? null;
                return (
                  <li key={s.setId} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text-primary truncate">{name}</p>
                        <p className="text-xs text-text-muted truncate">
                          {time && <span className="tabular-nums">{time} · </span>}
                          {s.reasons.map(reasonLabel).join(', ')}
                        </p>
                      </div>
                      {chosen && (
                        <Badge variant={chosen === 'must' ? 'must' : chosen === 'want-to-see' ? 'want' : 'maybe'}>
                          {chosen === 'want-to-see' ? 'Want' : chosen === 'must' ? 'Must' : 'Maybe'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2" role="radiogroup" aria-label={`Priority for ${name}`}>
                      {PRIORITY_CHOICES.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          role="radio"
                          aria-checked={chosen === p.value}
                          onClick={() => setChoice(s.setId, p.value)}
                          className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
                            chosen === p.value
                              ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover'
                              : 'border-border text-text-secondary hover:bg-bg-card-hover'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setChoice(s.setId, null)}
                        className={`ml-auto text-xs px-2 py-1 rounded-full ${
                          chosen === null ? 'text-accent-aqua' : 'text-text-muted hover:text-text-secondary'
                        }`}
                        aria-label={`Skip ${name}`}
                        aria-pressed={chosen === null}
                      >
                        Skip
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border sticky bottom-0 bg-bg-secondary">
              <button
                onClick={onClose}
                className="text-xs font-medium px-3 py-2 rounded text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={() => void onConfirm(choices)}
                isLoading={confirming}
                disabled={acceptedCount === 0}
                aria-label={`Add ${acceptedCount} picks`}
              >
                Add {acceptedCount} pick{acceptedCount === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Humanize a suggestion reason source for display. */
function reasonLabel(reason: string): string {
  switch (reason) {
    case 'top_short':
      return 'Top recently';
    case 'top_medium':
      return 'Top this year';
    case 'top_long':
      return 'All-time favorite';
    case 'followed':
      return 'You follow';
    default:
      return reason;
  }
}
