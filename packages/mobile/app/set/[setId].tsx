import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Linking,
  ActivityIndicator,
  Share,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFestivalDataStore, useAuthStore } from '@festie/shared/stores';
import { usePicks, useFestival, useCrew } from '@festie/shared/hooks';
import { api } from '@festie/shared/services';
import {
  formatTime,
  artistDisplayName,
  artistSubtitle,
  getSetLinks,
  detectConflicts,
  hasSetStarted,
} from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import { safeStageColor } from '../../lib/stageColor';
import { useHaptics } from '../../hooks/useHaptics';
import EmptyState from '../../components/EmptyState';
import RatingButtons from '../../components/RatingButtons';
import ClashPrompt from '../../components/ClashPrompt';

/**
 * Spotify preview payload returned by GET /spotify/preview/:setId. The server
 * returns artistName/trackName (NOT a `label` field) — we derive the display
 * label from trackName||artistName.
 */
interface SpotifyPreview {
  embedUrl: string;
  embedType: 'artist' | 'track' | null;
  artistName?: string;
  trackName?: string;
}

/** Priority button definitions, mirroring SetCardMobile. */
const PRIORITIES: readonly {
  value: Priority;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { value: 'must', icon: 'star', label: 'Must See' },
  { value: 'want-to-see', icon: 'heart', label: 'Want to See' },
  { value: 'maybe', icon: 'ellipse', label: 'Maybe' },
];

/** Reminder lead-time options (minutes) — must match the server's allowed set. */
const REMINDER_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 5, label: '5m' },
  { value: 10, label: '10m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
];

/** Maps a priority to its accent token (matches SetCardMobile). */
function priorityColor(t: ReturnType<typeof useTokens>, p: Priority): string {
  if (p === 'must') return t.colors.priority.must;
  if (p === 'want-to-see') return t.colors.priority.want;
  return t.colors.priority.maybe;
}

/**
 * The mobile set-detail screen — an expo-router modal mirroring the web
 * DetailPanel. Looks the set up by id from the shared data store so it is
 * reload-safe (only the setId travels in the URL). Recomputes everything the
 * panel needs (pick, conflicts, crew, notes) from shared hooks/stores.
 */
export default function SetDetailScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Headerless modal: anchor the top affordances to the status-bar inset so the
  // drag handle / close / share clear the notch on Android and any full-screen
  // presentation, while staying compact on iOS card modals.
  const topInset = Math.max(t.spacing[3], insets.top);
  const { setId } = useLocalSearchParams<{ setId: string }>();

  const sets = useFestivalDataStore((s) => s.sets);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);
  const currentProfile = useFestivalDataStore((s) => s.currentProfile);
  const allProfiles = useFestivalDataStore((s) => s.allProfiles);
  const loadProfiles = useFestivalDataStore((s) => s.loadProfiles);
  const days = useFestivalDataStore((s) => s.days);

  const { getMyPick, savePick, saveNote, getOtherPicks, saveReminder, getMyReminder } = usePicks();
  const { getStageColor, getStageName } = useFestival();
  const { getCrewScopedOtherPicks } = useCrew();
  const haptics = useHaptics();

  const set = useMemo(() => sets.find((x) => x.id === setId), [sets, setId]);

  // Cold deep-link (festie.us/set/<id> or festie://set/<id>): the set isn't in
  // the store yet because its festival isn't loaded. Resolve which festival the
  // set belongs to, load it, and the set then appears. Runs once; on failure we
  // fall through to the "not found" state below.
  const [resolveFailed, setResolveFailed] = useState(false);
  const resolveTried = useRef(false);
  useEffect(() => {
    if (set || resolveTried.current || !setId) return;
    resolveTried.current = true;
    (async () => {
      try {
        const { festivalId } = await api.get<{ festivalId: string }>(`/festivals/locate-set/${setId}`);
        if (festivalId && festivalId !== currentFestivalId) {
          await selectFestival(festivalId);
        }
        if (!useFestivalDataStore.getState().sets.some((x) => x.id === setId)) {
          setResolveFailed(true);
        }
      } catch {
        setResolveFailed(true);
      }
    })();
  }, [set, setId, currentFestivalId, selectFestival]);

  const b2bSeparator = currentFestival?.b2bSeparator;

  // ---- Derived display data (only computed when the set exists). ----------
  const artistName = set ? artistDisplayName(set, b2bSeparator) : '';
  const artistPhoto = set?.artists?.find((a) => a.photo)?.photo;

  // Share the public universal link to this set (mirrors web's /set/$setId
  // route). festie.us is the registered universal-link host (app.json) and the
  // festie:// scheme also resolves set/<id>, so the link deep-links into the app
  // when installed and falls back to the web page otherwise.
  const shareUrl = useMemo(() => (set ? `https://festie.us/set/${set.id}` : ''), [set]);
  const handleShare = useCallback(async () => {
    if (!set) return;
    try {
      await Share.share({
        message: `${artistName} at ${currentFestival?.name ?? 'the festival'} — ${shareUrl}`,
        url: shareUrl,
        title: artistName,
      });
    } catch {
      // User dismissed the share sheet — not an error worth surfacing.
    }
  }, [set, artistName, currentFestival?.name, shareUrl]);
  const subtitle = set ? artistSubtitle(set, b2bSeparator) : '';
  const stageName = set ? getStageName(set.stageId) || 'Unknown' : 'Unknown';
  const stageColor = safeStageColor(set ? getStageColor(set.stageId) : undefined, t.colors.text.muted);
  const timeLabel =
    set && set.startTime && set.endTime ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}` : 'TBA';
  const myPick = set ? getMyPick(set.id) : undefined;
  const myReminder = set ? getMyReminder(set.id) : undefined;

  const allGenres = useMemo(() => [...new Set((set?.artists || []).flatMap((a) => a.genres || []))].slice(0, 6), [set]);

  const artistLinks = useMemo(() => (set ? getSetLinks(set) : []), [set]);

  // Conflicts: other picked sets whose times overlap this one (web parity).
  const conflicts = useMemo(() => {
    if (!set || !currentProfile) return [];
    const detected = detectConflicts(sets, (id: string) => {
      const val = currentProfile.picks?.[id];
      return (val as Priority) || null;
    });
    return detected
      .filter((c) => c.setA.id === set.id || c.setB.id === set.id)
      .map((c) => (c.setA.id === set.id ? c.setB : c.setA));
  }, [sets, currentProfile, set]);

  // Crew / who's going.
  const others = useMemo(() => {
    if (!set || !currentProfile) return [];
    const raw = getCrewScopedOtherPicks(set.id);
    const scoped = raw.length > 0 ? raw : getOtherPicks(set.id);
    return scoped.map((o) => {
      const profile = allProfiles.find((p) => p.id === o.profileId);
      return {
        profileId: o.profileId,
        priority: o.priority,
        name: profile?.name || 'Unknown',
      };
    });
  }, [set, currentProfile, getCrewScopedOtherPicks, getOtherPicks, allProfiles]);

  const whoTitle = others.length > 0 ? `Who's Going (${others.length})` : 'Nobody else going yet';

  const crewNotes = useMemo(() => {
    if (!set) return [];
    return allProfiles
      .filter((p) => p.id !== currentProfile?.id && p.notes?.['crew:' + set.id])
      .map((p) => ({
        name: p.name || 'Unknown',
        note: p.notes['crew:' + set.id]!,
      }));
  }, [allProfiles, currentProfile?.id, set]);

  // ---- Notes (debounced save, mirroring the web 500ms debounce). ----------
  const [personalNote, setPersonalNote] = useState('');
  const [crewNote, setCrewNote] = useState('');
  const personalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!set) return;
    setPersonalNote(currentProfile?.notes?.[set.id] || '');
    setCrewNote(currentProfile?.notes?.['crew:' + set.id] || '');
  }, [set, currentProfile]);

  const handlePersonalNoteChange = useCallback(
    (value: string) => {
      setPersonalNote(value);
      if (!set || !currentFestival) return;
      if (personalTimer.current) clearTimeout(personalTimer.current);
      personalTimer.current = setTimeout(() => {
        saveNote(currentFestival.id, set.id, value).catch(() => {});
      }, 500);
    },
    [set, currentFestival, saveNote],
  );

  const handleCrewNoteChange = useCallback(
    (value: string) => {
      setCrewNote(value);
      if (!set || !currentFestival) return;
      if (crewTimer.current) clearTimeout(crewTimer.current);
      crewTimer.current = setTimeout(() => {
        saveNote(currentFestival.id, 'crew:' + set.id, value).catch(() => {});
      }, 500);
    },
    [set, currentFestival, saveNote],
  );

  useEffect(() => {
    return () => {
      if (personalTimer.current) clearTimeout(personalTimer.current);
      if (crewTimer.current) clearTimeout(crewTimer.current);
    };
  }, []);

  // ---- Spotify preview (fetched on mount, rendered inline via WebView). ----
  const [spotify, setSpotify] = useState<SpotifyPreview | null>(null);
  const [spotifyOpen, setSpotifyOpen] = useState(false);

  // Server returns artistName/trackName (no `label`); derive a display label.
  const spotifyLabel = spotify?.trackName || spotify?.artistName || 'Play on Spotify';

  useEffect(() => {
    if (!set) return;
    let cancelled = false;
    (async () => {
      try {
        const preview = await api.get<SpotifyPreview>(`/spotify/preview/${set.id}`);
        if (!cancelled && preview?.embedType) setSpotify(preview);
      } catch {
        /* No Spotify preview available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [set]);

  // ---- Actions. ------------------------------------------------------------
  const handlePriority = useCallback(
    (priority: Priority | null) => {
      if (!set || !currentFestival) return;
      savePick(currentFestival.id, set.id, priority).catch(() => {});
    },
    [set, currentFestival, savePick],
  );

  const handleReminder = useCallback(
    (minutes: number | null) => {
      if (!set || !currentFestival) return;
      haptics.select();
      saveReminder(currentFestival.id, set.id, minutes).catch(() => {});
    },
    [set, currentFestival, saveReminder, haptics],
  );

  const handleConflictSwitch = useCallback(
    (conflictSetId: string) => {
      if (!set || !currentFestival) return;
      const priority = (getMyPick(set.id) as Priority | null) || 'must';
      savePick(currentFestival.id, set.id, null).catch(() => {});
      savePick(currentFestival.id, conflictSetId, priority).catch(() => {});
    },
    [set, currentFestival, savePick, getMyPick],
  );

  // Clash-prompt clear — demote one side of a clash to null. savePick is
  // offline-queued, so resolving a clash works on dead signal.
  const handleClashClear = useCallback(
    (clearSetId: string) => {
      if (!currentFestival) return;
      haptics.select();
      savePick(currentFestival.id, clearSetId, null).catch(() => {});
    },
    [currentFestival, savePick, haptics],
  );

  const user = useAuthStore((s) => s.user);
  const [joinBusy, setJoinBusy] = useState(false);
  const handleJoin = useCallback(async () => {
    if (!currentFestival) return;
    // A guest has no account yet — send them to sign in first. After auth they
    // land back on the tabs and can re-open the set to join.
    if (!user) {
      router.push('/(auth)/login');
      return;
    }
    setJoinBusy(true);
    try {
      await api.post('/profiles', { festivalId: currentFestival.id });
      await loadProfiles(currentFestival.id);
    } catch {
      /* Join failed — store surfaces error */
    } finally {
      setJoinBusy(false);
    }
  }, [currentFestival, user, router, loadProfiles]);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  // ---- Reload-safe guard: the set isn't in the store (cold open / deep link).
  if (!set) {
    // Still resolving the deep link's festival — show a spinner, not "not found".
    if (!resolveFailed) {
      return (
        <View style={[styles.container, styles.loadingContainer]}>
          <CloseButton onPress={() => router.back()} top={topInset} />
          <ActivityIndicator size="large" color={t.colors.accent.aqua} />
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CloseButton onPress={() => router.back()} top={topInset} />
        <EmptyState
          icon="alert-circle-outline"
          title="Set not found"
          message="This set isn't loaded. Go back to the schedule and open it again."
          action={{ label: 'Back to schedule', onPress: () => router.back() }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Faux drag handle removed — the native formSheet (SDK 56) renders a real
          grabber (sheetGrabberVisible). */}
      <TouchableOpacity
        style={[styles.shareButton, { top: topInset }]}
        onPress={handleShare}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Share set"
        hitSlop={8}
      >
        <Ionicons name="share-outline" size={20} color={t.colors.text.secondary} />
      </TouchableOpacity>
      <CloseButton onPress={() => router.back()} top={topInset} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Artist photo (from Spotify backfill) */}
        {artistPhoto ? (
          <Image
            source={{ uri: artistPhoto }}
            style={styles.artistPhoto}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}

        {/* Stage pill */}
        <View style={[styles.stagePill, { backgroundColor: stageColor + '25' }]}>
          <Text style={[styles.stageText, { color: stageColor }]} numberOfLines={1}>
            {stageName}
          </Text>
        </View>

        {/* Artist header */}
        <Text style={styles.artist} accessibilityRole="header">
          {artistName}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <Text style={styles.time}>{timeLabel}</Text>

        {/* Genres */}
        {allGenres.length > 0 ? (
          <View style={styles.chipRow}>
            {allGenres.map((g) => (
              <View key={g} style={styles.chip}>
                <Text style={styles.chipText}>{g}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Artist links */}
        {artistLinks.length > 0 ? (
          <View style={styles.linkRow}>
            {artistLinks.flatMap((entry) =>
              Object.entries(entry.links).map(([key, url]) => (
                <TouchableOpacity
                  key={`${entry.name}-${key}`}
                  style={styles.linkButton}
                  onPress={() => openLink(url)}
                  activeOpacity={0.7}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${entry.name} on ${key}`}
                >
                  <Ionicons name="open-outline" size={14} color={t.colors.accent.aqua} />
                  <Text style={styles.linkText}>{key}</Text>
                </TouchableOpacity>
              )),
            )}
          </View>
        ) : null}

        {/* Spotify preview — inline WebView embed behind a show/hide toggle.
            The embedUrl already carries theme=0 (dark). The section renders
            nothing when no preview is available (guarded on embedType). */}
        {spotify && spotify.embedUrl ? (
          <View style={styles.spotifySection}>
            <TouchableOpacity
              style={styles.spotifyButton}
              onPress={() => setSpotifyOpen((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ expanded: spotifyOpen }}
              accessibilityLabel={spotifyOpen ? `Hide preview: ${spotifyLabel}` : `Play preview: ${spotifyLabel}`}
            >
              <Ionicons name="musical-note" size={16} color={t.colors.spotify.brand} />
              <Text style={styles.spotifyText} numberOfLines={1}>
                {spotifyLabel}
              </Text>
              <Ionicons name={spotifyOpen ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.text.secondary} />
            </TouchableOpacity>
            {spotifyOpen ? (
              <View style={[styles.spotifyEmbed, { height: spotify.embedType === 'track' ? 152 : 352 }]}>
                <WebView
                  source={{ uri: spotify.embedUrl }}
                  style={styles.spotifyWebView}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  originWhitelist={['https://open.spotify.com', 'https://*.spotify.com']}
                  onShouldStartLoadWithRequest={(req) => {
                    // Default-DENY: only the embed itself + in-frame Spotify
                    // resource loads stay in the WebView. User clicks (Spotify
                    // or not) open externally; any other origin is blocked so a
                    // hijacked iframe can't navigate the WebView off-Spotify.
                    if (req.url === spotify.embedUrl) return true;
                    let host = '';
                    try {
                      host = new URL(req.url).hostname;
                    } catch {
                      return false;
                    }
                    const isSpotify = /(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com)$/.test(host);
                    if (req.navigationType === 'click') {
                      // Top-level user navigation → hand off to the OS.
                      openLink(req.url);
                      return false;
                    }
                    // Non-click (iframe/resource): allow only Spotify hosts.
                    return isSpotify;
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Inline clash prompt — actionable "keep one" nudge (M1). The passive
            conflict box below stays as the ambient marker. */}
        {currentProfile && conflicts.length > 0 ? (
          <ClashPrompt
            currentSet={set}
            conflicts={conflicts}
            b2bSeparator={b2bSeparator}
            getPriority={getMyPick}
            onClear={handleClashClear}
          />
        ) : null}

        {/* Conflict warning */}
        {currentProfile && conflicts.length > 0 ? (
          <View style={styles.conflictBox}>
            <View style={styles.conflictHeader}>
              <Ionicons name="warning" size={16} color={t.colors.accent.coral} />
              <Text style={styles.conflictTitle}>
                {conflicts.length === 1 ? '1 scheduling conflict' : `${conflicts.length} scheduling conflicts`}
              </Text>
            </View>
            {conflicts.map((c) => (
              <View key={c.id} style={styles.conflictItem}>
                <View style={styles.conflictInfo}>
                  <Text style={styles.conflictArtist} numberOfLines={1}>
                    {artistDisplayName(c, b2bSeparator)}
                  </Text>
                  <Text style={styles.conflictMeta} numberOfLines={1}>
                    {getStageName(c.stageId) || 'Unknown'}
                    {c.startTime ? ` · ${formatTime(c.startTime)}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.switchButton}
                  onPress={() => handleConflictSwitch(c.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch pick to ${artistDisplayName(c, b2bSeparator)}`}
                >
                  <Text style={styles.switchText}>Switch</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {/* Priority picker / Join CTA */}
        {currentProfile ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Your pick</Text>
              <View style={styles.priorityRow}>
                {PRIORITIES.map((option) => {
                  const active = myPick === option.value;
                  const accent = priorityColor(t, option.value);
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.priorityButton, active && { backgroundColor: accent, borderColor: accent }]}
                      onPress={() => handlePriority(active ? null : option.value)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={active ? `${option.label} (selected)` : option.label}
                    >
                      <Ionicons
                        name={option.icon}
                        size={16}
                        color={active ? t.colors.text.onLightAccent : t.colors.text.muted}
                      />
                      <Text style={[styles.priorityText, active && { color: t.colors.text.onLightAccent }]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Remind me before it starts</Text>
              <View style={styles.reminderRow}>
                {REMINDER_OPTIONS.map((opt) => {
                  const active = myReminder === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.reminderChip,
                        active && {
                          backgroundColor: t.colors.accent.aqua,
                          borderColor: t.colors.accent.aqua,
                        },
                      ]}
                      onPress={() => handleReminder(active ? null : opt.value)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={
                        active ? `Reminder set ${opt.label} before, tap to clear` : `Remind me ${opt.label} before`
                      }
                    >
                      <Text style={[styles.priorityText, active && { color: t.colors.text.onLightAccent }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        ) : (
          <View style={styles.joinBox}>
            <Text style={styles.joinCopy}>
              {user
                ? 'Join this festival to save picks, keep private notes, and compare crew overlap.'
                : 'Sign in to save picks, keep private notes, and compare crew overlap.'}
            </Text>
            <TouchableOpacity
              style={[styles.joinButton, joinBusy && styles.joinButtonBusy]}
              onPress={handleJoin}
              disabled={joinBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={user ? 'Join festival' : 'Sign in to join'}
            >
              {joinBusy ? (
                <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
              ) : (
                <Text style={styles.joinButtonText}>{user ? 'Join Festival' : 'Sign in to join'}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Ratings — only once the set has started (web parity). */}
        {currentProfile && currentFestival && hasSetStarted(set, currentFestival, days) ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Rate this set</Text>
            <RatingButtons setId={set.id} festivalId={currentFestival.id} />
          </View>
        ) : null}

        {/* Who's going */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{whoTitle}</Text>
          {others.map((o) => (
            <View key={o.profileId} style={styles.crewRow}>
              <View style={[styles.crewDot, { backgroundColor: priorityColor(t, o.priority) }]} />
              <Text style={styles.crewName} numberOfLines={1}>
                {o.name}
              </Text>
            </View>
          ))}
          {crewNotes.map((n, i) => (
            <View key={`note-${i}`} style={styles.crewNoteRow}>
              <Text style={styles.crewNoteName}>{n.name}</Text>
              <Text style={styles.crewNoteText}>{n.note}</Text>
            </View>
          ))}
        </View>

        {/* Notes */}
        {currentProfile ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your note</Text>
            <TextInput
              style={styles.noteInput}
              value={personalNote}
              onChangeText={handlePersonalNoteChange}
              placeholder="Private note for yourself"
              placeholderTextColor={t.colors.text.placeholder}
              multiline
              accessibilityLabel="Personal note"
            />
            <Text style={styles.sectionLabel}>Crew note</Text>
            <TextInput
              style={styles.noteInput}
              value={crewNote}
              onChangeText={handleCrewNoteChange}
              placeholder="Shared note for your crew"
              placeholderTextColor={t.colors.text.placeholder}
              multiline
              accessibilityLabel="Crew note"
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Close affordance for the modal header. */
function CloseButton({ onPress, top }: { onPress: () => void; top: number }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.closeButton, { top }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Close detail"
      hitSlop={8}
    >
      <Ionicons name="close" size={22} color={t.colors.text.secondary} />
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: t.spacing[3],
    right: t.spacing[4],
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.card,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  shareButton: {
    position: 'absolute',
    top: t.spacing[3],
    left: t.spacing[4],
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.card,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  content: {
    padding: t.spacing[5],
    paddingTop: t.spacing[5],
    paddingBottom: t.spacing[6],
    gap: t.spacing[3],
  },
  artistPhoto: {
    width: '100%',
    height: 200,
    borderRadius: t.radii.default,
    marginBottom: t.spacing[3],
    backgroundColor: t.colors.bg.secondary,
  },
  stagePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
  },
  stageText: {
    ...typeStyle('micro'),
  },
  artist: {
    ...typeStyle('display-lg'),
    color: t.colors.text.primary,
  },
  subtitle: {
    ...typeStyle('body'),
    color: t.colors.text.muted,
  },
  time: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  chipText: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
  },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  linkText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    textTransform: 'capitalize',
  },
  spotifySection: {
    gap: t.spacing[2],
  },
  spotifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
  },
  spotifyText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  spotifyEmbed: {
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  spotifyWebView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  conflictBox: {
    gap: t.spacing[2],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  conflictTitle: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
  },
  conflictItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  conflictInfo: {
    flex: 1,
  },
  conflictArtist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  conflictMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  switchButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  switchText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  section: {
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  sectionLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  // Reminder chips: wrap to a second line instead of cramming all five across
  // one cramped row. Each chip sizes to its label (no flex:1) and keeps a 44pt
  // touch target.
  reminderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  reminderChip: {
    minWidth: 56,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  priorityButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    // WCAG 2.5.5 / 2.5.8 minimum 44pt touch target.
    minHeight: 44,
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  priorityText: {
    // Bumped from the 10px micro role to 12px (caption) for legibility — the
    // 10px picker labels were too small to read comfortably.
    ...typeStyle('caption'),
    fontWeight: '500',
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  joinBox: {
    gap: t.spacing[3],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.overlay[2],
  },
  joinCopy: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  joinButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.aqua,
  },
  joinButtonBusy: {
    opacity: 0.7,
  },
  joinButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  crewDot: {
    width: 8,
    height: 8,
    borderRadius: t.radii.pill,
  },
  crewName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  crewNoteRow: {
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  crewNoteName: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  crewNoteText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  noteInput: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    minHeight: 64,
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
    textAlignVertical: 'top',
  },
}));
