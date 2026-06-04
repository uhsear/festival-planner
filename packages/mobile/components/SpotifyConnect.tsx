import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Linking, Modal, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useSpotifyStore, suggestedToDomainPriority, useFestivalDataStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import type { Priority, FestivalSet } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';

/**
 * SpotifyConnect (M4, MOBILE) — connect/disconnect, suggestions review, and
 * "build playlist from my picks". Mirrors the web component but runs OAuth via
 * expo-auth-session (managed PKCE) instead of a full-page browser redirect.
 *
 * Token safety: the CLIENT SECRET never lives on-device. The app runs only the
 * PUBLIC PKCE leg — it builds the authorize URL with a code challenge, opens the
 * system browser, captures the redirect to `festie://spotify-callback`, then
 * hands the authorization code + verifier to the backend
 * (POST /spotify/auth/exchange), which performs the token exchange and encrypts
 * the refresh token at rest. No Spotify token ever touches the client.
 *
 * Dormant-aware: the connect leg needs a public client id
 * (EXPO_PUBLIC_SPOTIFY_CLIENT_ID). When it's unset — or the backend reports
 * `configured: false` (redirect URI not registered yet) — we render a quiet
 * "Spotify not configured" note instead of a connect CTA. Accepted suggestions
 * flow through the offline-native pick path (festivalDataStore.savePick via the
 * shared store's confirmPicks).
 */

// Ensure the in-app browser auth session can complete (no-op on native cold start).
WebBrowser.maybeCompleteAuthSession();

// Spotify authorization endpoint (Authorization Code + PKCE). The TOKEN endpoint
// is intentionally omitted: the device only opens the consent screen and captures
// the code — the backend (POST /spotify/auth/exchange) does the token exchange.
const SPOTIFY_DISCOVERY: AuthSession.AuthDiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
};

// Same single-consent scope set the backend requests (lib/spotify-oauth.ts).
const SPOTIFY_SCOPES = ['user-top-read', 'user-follow-read', 'playlist-modify-public', 'playlist-modify-private'];

// PUBLIC client id (the Spotify app's client id is NOT a secret). Unset → dormant.
const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

// The three pick buckets, in display order, mapped to the domain Priority.
const PRIORITY_CHOICES: readonly { value: Priority; label: string; color: string }[] = [
  { value: 'must', label: 'Must', color: '#ff3366' },
  { value: 'want-to-see', label: 'Want', color: '#00e8d0' },
  { value: 'maybe', label: 'Maybe', color: '#ffb020' },
];

/** Mobile exchange response shape from POST /spotify/auth/exchange. */
interface SpotifyExchangeResult {
  connected: boolean;
  spotifyUserId: string | null;
}

interface SpotifyConnectProps {
  festivalId: string;
}

export default function SpotifyConnect({ festivalId }: SpotifyConnectProps) {
  const t = useTokens();
  const styles = useStyles();

  const status = useSpotifyStore((s) => s.connectionStatus);
  const suggestions = useSpotifyStore((s) => s.suggestions);
  const playlist = useSpotifyStore((s) => s.playlist);
  const statusLoading = useSpotifyStore((s) => s.statusLoading);
  const suggestionsLoading = useSpotifyStore((s) => s.suggestionsLoading);
  const playlistBuilding = useSpotifyStore((s) => s.playlistBuilding);
  const confirming = useSpotifyStore((s) => s.confirming);

  const loadStatus = useSpotifyStore((s) => s.loadStatus);
  const loadSuggestions = useSpotifyStore((s) => s.loadSuggestions);
  const confirmPicks = useSpotifyStore((s) => s.confirmPicks);
  const createPlaylist = useSpotifyStore((s) => s.createPlaylist);
  const clearPlaylist = useSpotifyStore((s) => s.clearPlaylist);
  const disconnect = useSpotifyStore((s) => s.disconnect);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // Local copy of the redirect-uri-less / client-id-less dormant state. When the
  // public client id is missing we can't even start OAuth, so treat as dormant.
  const clientConfigured = SPOTIFY_CLIENT_ID.length > 0;

  // Load the connection status once on mount so we know whether to show connect
  // vs connected (and whether Spotify is configured at all).
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const backendConfigured = status?.configured ?? true; // assume configured until told otherwise
  const configured = clientConfigured && backendConfigured;
  const connected = status?.connected ?? false;

  // ── Mobile OAuth (managed PKCE) ────────────────────────────────────────────
  // The app generates the PKCE verifier + challenge, opens Spotify's consent in
  // the system browser, and on the festie://spotify-callback redirect posts the
  // code + verifier to the server, which completes the (secret-bearing-free)
  // exchange and stores the encrypted refresh token. The secret stays server-side.
  const handleConnect = useCallback(async () => {
    if (!clientConfigured) return;
    setConnecting(true);
    try {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'festie', path: 'spotify-callback' });
      const request = new AuthSession.AuthRequest({
        clientId: SPOTIFY_CLIENT_ID,
        scopes: SPOTIFY_SCOPES,
        redirectUri,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
      });

      const result = await request.promptAsync(SPOTIFY_DISCOVERY);
      if (result.type !== 'success' || !result.params?.code || !request.codeVerifier) {
        // cancel / dismiss / error — surface nothing noisy; user can retry.
        return;
      }

      await api.post<SpotifyExchangeResult>('/spotify/auth/exchange', {
        code: result.params.code,
        codeVerifier: request.codeVerifier,
        redirectUri,
      });
      // Re-read status so the UI flips to "connected".
      await loadStatus();
    } catch {
      // Swallow: loadStatus keeps the prior (disconnected) state; the user can
      // retry. The shared store surfaces granular errors for the API legs.
    } finally {
      setConnecting(false);
    }
  }, [clientConfigured, loadStatus]);

  const handleOpenSuggestions = useCallback(async () => {
    setSheetOpen(true);
    try {
      await loadSuggestions(festivalId);
    } catch {
      /* store already set its error state */
    }
  }, [loadSuggestions, festivalId]);

  const handleBuildPlaylist = useCallback(async () => {
    try {
      await createPlaylist(festivalId);
    } catch {
      /* store already set its error state */
    }
  }, [createPlaylist, festivalId]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
    } catch {
      /* store already set its error state */
    }
  }, [disconnect]);

  const handleConfirm = useCallback(
    async (picks: Record<string, Priority | null>) => {
      await confirmPicks(picks);
      setSheetOpen(false);
    },
    [confirmPicks],
  );

  // ── Dormant: client id missing or backend says not configured ───────────────
  if (!configured) {
    return (
      <View style={styles.card} accessibilityRole="summary" accessibilityLabel="Spotify not configured">
        <View style={styles.headerRow}>
          <Ionicons name="musical-notes" size={18} color={t.colors.text.muted} />
          <Text style={styles.titleMuted}>Spotify not configured</Text>
        </View>
        <Text style={styles.subtle}>Connecting Spotify isn&apos;t available yet — check back soon.</Text>
      </View>
    );
  }

  // ── Not connected: connect CTA ──────────────────────────────────────────────
  if (!connected) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="musical-notes" size={18} color={t.colors.spotify.brand} />
          <Text style={styles.title}>Connect Spotify</Text>
        </View>
        <Text style={styles.subtle}>Auto-suggest picks from your top &amp; followed artists on this lineup.</Text>
        <TouchableOpacity
          style={[styles.primaryBtn, (connecting || statusLoading) && styles.btnDisabled]}
          onPress={handleConnect}
          disabled={connecting || statusLoading}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Connect Spotify"
        >
          {connecting ? (
            <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
          ) : (
            <Ionicons name="musical-notes" size={16} color={t.colors.text.onLightAccent} />
          )}
          <Text style={styles.primaryBtnText}>Connect Spotify</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Connected: suggestions + playlist actions ───────────────────────────────
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="checkmark-circle" size={18} color={t.colors.spotify.brand} />
        <Text style={styles.title}>Spotify connected</Text>
        {status?.spotifyUserId ? (
          <Text style={styles.handle} numberOfLines={1}>
            · {status.spotifyUserId}
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.disconnectBtn}
          onPress={handleDisconnect}
          accessibilityRole="button"
          accessibilityLabel="Disconnect Spotify"
        >
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleOpenSuggestions}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Review Spotify pick suggestions"
        >
          <Ionicons name="sparkles-outline" size={15} color={t.colors.text.primary} />
          <Text style={styles.secondaryBtnText}>Suggest picks</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, playlistBuilding && styles.btnDisabled]}
          onPress={handleBuildPlaylist}
          disabled={playlistBuilding}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Build a playlist from my picks"
        >
          {playlistBuilding ? (
            <ActivityIndicator size="small" color={t.colors.text.primary} />
          ) : (
            <Ionicons name="list-outline" size={15} color={t.colors.text.primary} />
          )}
          <Text style={styles.secondaryBtnText}>Build playlist from my picks</Text>
        </TouchableOpacity>
      </View>

      {playlist ? (
        <View style={styles.playlistResult}>
          <Ionicons name="checkmark-circle" size={16} color={t.colors.spotify.brand} />
          <Text style={styles.playlistText}>
            {playlist.trackCount} tracks from {playlist.artistCount} artists
          </Text>
          {playlist.playlistUrl ? (
            <TouchableOpacity
              onPress={() => playlist.playlistUrl && Linking.openURL(playlist.playlistUrl)}
              accessibilityRole="link"
              accessibilityLabel="Open playlist in Spotify"
            >
              <Text style={styles.playlistOpen}>Open</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={clearPlaylist}
            accessibilityRole="button"
            accessibilityLabel="Dismiss playlist result"
          >
            <Ionicons name="close" size={16} color={t.colors.text.muted} />
          </TouchableOpacity>
        </View>
      ) : null}

      <SuggestionsSheet
        visible={sheetOpen}
        loading={suggestionsLoading}
        confirming={confirming}
        suggestions={suggestions}
        onConfirm={handleConfirm}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Suggestions review sheet — must/want/maybe chips per matched set + bulk
// "Add all" (reusing the M2 bulk-add intent), then confirm into picks via the
// offline-native savePick path.
// ════════════════════════════════════════════════════════════════════════════

interface SuggestionsSheetProps {
  visible: boolean;
  loading: boolean;
  confirming: boolean;
  suggestions: ReturnType<typeof useSpotifyStore.getState>['suggestions'];
  onConfirm: (picks: Record<string, Priority | null>) => Promise<void>;
  onClose: () => void;
}

function SuggestionsSheet({ visible, loading, confirming, suggestions, onConfirm, onClose }: SuggestionsSheetProps) {
  const t = useTokens();
  const styles = useStyles();

  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close suggestions">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Suggested from your Spotify</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.sheetEmpty}>
              <ActivityIndicator size="small" color={t.colors.accent.aqua} />
              <Text style={styles.sheetEmptyText}>Matching your top artists to the lineup…</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.sheetEmpty}>
              <Text style={styles.sheetEmptyText}>No matches between your Spotify artists and this lineup yet.</Text>
            </View>
          ) : (
            <>
              {/* Bulk "add all" — reuses the M2 add-all intent across the matched set. */}
              <View style={styles.bulkRow}>
                <Text style={styles.bulkLabel}>Add all as</Text>
                {PRIORITY_CHOICES.map((p) => (
                  <TouchableOpacity
                    key={p.value}
                    style={styles.bulkChip}
                    onPress={() => addAll(p.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add all matched sets as ${p.label}`}
                  >
                    <Text style={styles.bulkChipText}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {items.map((s) => {
                  const set = setsById.get(s.setId);
                  const name = set ? artistDisplayName(set, currentFestival?.b2bSeparator) : s.artistName || 'Unknown';
                  const time = set?.startTime ? formatTime(set.startTime) : '';
                  const chosen = choices[s.setId] ?? null;
                  return (
                    <View key={s.setId} style={styles.item}>
                      <View style={styles.itemTop}>
                        <View style={styles.itemMeta}>
                          <Text style={styles.itemName} numberOfLines={1}>
                            {name}
                          </Text>
                          <Text style={styles.itemReason} numberOfLines={1}>
                            {time ? `${time} · ` : ''}
                            {s.reasons.map(reasonLabel).join(', ')}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={styles.choiceRow}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={`Priority for ${name}`}
                      >
                        {PRIORITY_CHOICES.map((p) => {
                          const active = chosen === p.value;
                          return (
                            <TouchableOpacity
                              key={p.value}
                              style={[styles.choiceChip, active && { borderColor: p.color }]}
                              onPress={() => setChoice(s.setId, p.value)}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: active }}
                              accessibilityLabel={`${p.label} for ${name}`}
                            >
                              <Text style={[styles.choiceText, active && { color: p.color }]}>{p.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                        <TouchableOpacity
                          style={styles.skipBtn}
                          onPress={() => setChoice(s.setId, null)}
                          accessibilityRole="button"
                          accessibilityLabel={`Skip ${name}`}
                          accessibilityState={{ selected: chosen === null }}
                        >
                          <Text style={[styles.skipText, chosen === null && styles.skipTextActive]}>Skip</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.sheetFooter}>
                <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, (acceptedCount === 0 || confirming) && styles.btnDisabled]}
                  onPress={() => void onConfirm(choices)}
                  disabled={acceptedCount === 0 || confirming}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${acceptedCount} picks`}
                >
                  {confirming ? (
                    <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
                  ) : (
                    <Text style={styles.confirmText}>
                      Add {acceptedCount} pick{acceptedCount === 1 ? '' : 's'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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

const useStyles = makeStyles((t) => ({
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  title: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  titleMuted: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
  },
  handle: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  subtle: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    backgroundColor: t.colors.spotify.brand,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    alignSelf: 'flex-start',
  },
  primaryBtnText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  disconnectBtn: {
    marginLeft: 'auto',
  },
  disconnectText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
  },
  secondaryBtnText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    fontWeight: '600',
  },
  playlistResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.spotify.brand,
    backgroundColor: t.colors.bg.primary,
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
  },
  playlistText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  playlistOpen: {
    ...typeStyle('caption'),
    color: t.colors.spotify.brand,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  // ── Suggestions sheet ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.colors.bg.secondary,
    borderTopLeftRadius: t.radii.lg,
    borderTopRightRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    maxHeight: '85%',
    paddingBottom: t.spacing[4],
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  sheetTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  sheetEmpty: {
    paddingVertical: t.spacing[8],
    paddingHorizontal: t.spacing[4],
    alignItems: 'center',
    gap: t.spacing[2],
  },
  sheetEmptyText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  bulkLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  bulkChip: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.pill,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
  },
  bulkChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: t.spacing[2],
  },
  item: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
    gap: t.spacing[2],
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemMeta: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    fontWeight: '600',
  },
  itemReason: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  choiceChip: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.pill,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
  },
  choiceText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  skipBtn: {
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  skipText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  skipTextActive: {
    color: t.colors.accent.aqua,
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  cancelText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
