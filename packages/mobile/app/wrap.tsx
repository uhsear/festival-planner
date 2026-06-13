import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useFestivalDataStore, useCrewStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { isFestivalOver } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useSharedValue, withTiming, Easing, useDerivedValue, runOnJS } from 'react-native-reanimated';
import EmptyState from '../components/EmptyState';
import SectionLabel from '../components/SectionLabel';
import { Skeleton } from '../components/Skeleton';
import WrapPoster from '../components/WrapPoster';
import CrewWrapPoster, { type CrewWrapData } from '../components/CrewWrapPoster';

interface WrapStats {
  totalRated: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface WrapSet {
  setId: string;
  rating: number;
  artist?: string;
  note?: string | null;
  stageId?: string | null;
  stageName?: string | null;
}
interface WrapResponse {
  stats: WrapStats;
  topSets: WrapSet[];
  allRatings: WrapSet[];
}

const EMOJI: Record<number, string> = { 5: '🔥', 4: '😊', 3: '👍', 2: '🤔', 1: '👎' };

/**
 * Festival Wrap — post-festival year-in-review stats + top-rated sets, a mobile
 * mirror of the web /wrap route. Gated on isFestivalOver. The web "share as
 * 1080×1920 PNG poster" is replaced here by a plain text share (RN Share), as
 * native image capture would need an extra dependency.
 */
export default function WrapScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const { getStageName } = useFestival();

  const over = isFestivalOver(currentFestival, days);

  const [tab, setTab] = useState<'me' | 'crew'>('me');
  const [data, setData] = useState<WrapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Bumped by the error-state "Try again" action to re-run the fetch (F40).
  const [reloadKey, setReloadKey] = useState(0);
  const posterRef = useRef<View>(null);

  useEffect(() => {
    if (!currentFestival?.id || !over) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: flip loading on before the async GET. Not derivable — loading tracks the in-flight request, not render inputs.
    setLoading(true);
    setError(false);
    api
      .get<WrapResponse>(`/ratings/wrap/${currentFestival.id}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFestival?.id, over, reloadKey]);

  const allSorted = useMemo(
    () => (data?.allRatings || []).slice().sort((a, b) => b.rating - a.rating),
    [data?.allRatings],
  );

  const stageLabel = (s: WrapSet): string => s.stageName || (s.stageId ? getStageName(s.stageId) || 'Stage' : 'Stage');

  // Poster-shaped top sets (resolve stage names) — mirrors web's posterTopSets.
  const posterTopSets = useMemo(
    () =>
      (data?.topSets || []).slice(0, 5).map((s) => ({
        rating: s.rating,
        artist: s.artist || s.setId,
        stageName: s.stageName || (s.stageId ? getStageName(s.stageId) : null),
      })),
    [data?.topSets, getStageName],
  );

  const shareText = async () => {
    if (!data || !currentFestival) return;
    const { stats, topSets } = data;
    const lines = [
      `My ${currentFestival.name} wrap 🎪`,
      `${stats.totalRated} sets rated · ${stats.stagesVisited} stages · ${(stats.totalHours ?? 0).toFixed(1)}h of music`,
      ...topSets.slice(0, 5).map((s, i) => `${i + 1}. ${EMOJI[s.rating] ?? ''} ${s.artist || s.setId}`),
      'festie.us',
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User dismissed the share sheet.
    }
  };

  // Capture the off-screen 1080×1920 poster to a PNG and share it; fall back to
  // the plain-text share if capture or the share sheet is unavailable.
  const handleShare = async () => {
    if (!data || !currentFestival || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your Festie wrap',
        });
      } else {
        await shareText();
      }
    } catch {
      // Capture failed (or sheet dismissed) — degrade to a text share.
      await shareText();
    } finally {
      setSharing(false);
    }
  };

  const body = () => {
    if (!currentFestival) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Select a festival first"
          message="Your wrap appears here once a festival ends."
        />
      );
    }
    if (!over) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Festival wrap coming soon"
          message="We'll put together your highlights the day after the festival ends."
        />
      );
    }
    if (loading) {
      return <WrapSkeleton />;
    }
    if (error) {
      return (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your wrap"
          message="Something went wrong loading your festival wrap."
          action={{ label: 'Try again', onPress: () => setReloadKey((k) => k + 1) }}
        />
      );
    }

    const stats = data?.stats || {
      totalRated: 0,
      stagesVisited: 0,
      daysAttended: 0,
      totalHours: 0,
    };
    const topSets = data?.topSets || [];
    const totalHours = stats.totalHours ?? 0;

    return (
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) },
        ]}
      >
        <View style={styles.headerBlock}>
          <View style={styles.kicker}>
            <Ionicons name="sparkles" size={14} color={t.colors.accent.aqua} />
            <Text style={styles.kickerText}>Your Festival Wrap</Text>
          </View>
          <Text style={styles.festivalName}>{currentFestival.name}</Text>
        </View>

        {/* R16: Bento layout — featured full-width top cell + two-column second row */}
        <View style={styles.bentoGrid}>
          <View style={styles.bentoFeatured}>
            <Stat label="Sets rated" value={String(stats.totalRated)} featured />
          </View>
          <View style={[styles.bentoRow, { gap: 1 }]}>
            <View style={[styles.bentoCell, styles.bentoCellDivider]}>
              <Stat label="Stages" value={String(stats.stagesVisited)} />
            </View>
            <View style={styles.bentoCell}>
              <Stat label="Days" value={String(stats.daysAttended)} />
            </View>
          </View>
          <View style={{ height: 1, backgroundColor: 'rgba(0,232,208,0.08)' }} />
          <View style={styles.bentoCell}>
            <Stat label="Hours of music" value={totalHours.toFixed(1)} />
          </View>
        </View>

        {topSets.length > 0 ? (
          <View>
            <SectionLabel>Your top picks</SectionLabel>
            {topSets.map((s, i) => (
              <View key={s.setId} style={styles.topRow}>
                <Text style={styles.topEmoji}>{EMOJI[s.rating] ?? '⭐'}</Text>
                <View style={styles.topInfo}>
                  <Text style={styles.topMeta}>
                    #{i + 1} · {stageLabel(s)}
                  </Text>
                  <Text style={styles.topArtist} numberOfLines={1}>
                    {s.artist || s.setId}
                  </Text>
                  {s.note ? (
                    <Text style={styles.topNote} numberOfLines={1}>
                      "{s.note}"
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="trophy-outline"
            title="No 4 or 5-star ratings yet"
            message="Rate sets from the set detail screen to build your wrap."
          />
        )}

        {allSorted.length > 0 ? (
          <View>
            <SectionLabel>Everything you rated</SectionLabel>
            {allSorted.map((s) => (
              <View key={s.setId} style={styles.allRow}>
                <Text style={styles.allEmoji}>{EMOJI[s.rating] ?? '⭐'}</Text>
                <Text style={styles.allArtist} numberOfLines={1}>
                  {s.artist || s.setId}
                </Text>
                <Text style={styles.allStage} numberOfLines={1}>
                  {stageLabel(s)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {stats.totalRated > 0 ? (
          <TouchableOpacity
            style={[styles.shareButton, sharing && styles.shareButtonBusy]}
            onPress={() => void handleShare()}
            disabled={sharing}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Share your wrap"
          >
            {sharing ? (
              <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
            ) : (
              <Ionicons name="share-social-outline" size={16} color={t.colors.text.onLightAccent} />
            )}
            <Text style={styles.shareButtonText}>{sharing ? 'Preparing…' : 'Share your wrap'}</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footer}>festie.us</Text>
      </ScrollView>
    );
  };

  // Tab bar — Personal vs Crew wrap. Only shown once the festival is over (the
  // not-over / no-festival empty states render the same regardless of tab).
  const showTabs = !!currentFestival && over;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Festival Wrap', headerShown: true }} />
      {showTabs ? (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'me' && styles.tabActive]}
            onPress={() => setTab('me')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'me' }}
          >
            <Text style={[styles.tabText, tab === 'me' && styles.tabTextActive]}>You</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'crew' && styles.tabActive]}
            onPress={() => setTab('crew')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'crew' }}
          >
            <Text style={[styles.tabText, tab === 'crew' && styles.tabTextActive]}>Crew wrap</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showTabs && tab === 'crew' ? (
        <CrewWrapTab
          crewId={activeCrew?.id ?? null}
          crewName={activeCrew?.name ?? 'Your crew'}
          festivalId={currentFestival!.id}
          festivalName={currentFestival!.name}
        />
      ) : (
        body()
      )}
      {/* Off-screen 1080×1920 poster, captured to PNG on share. collapsable=false
          keeps the View in the native tree so react-native-view-shot can grab it
          on Android. */}
      {tab === 'me' && data && data.stats.totalRated > 0 ? (
        <View
          ref={posterRef}
          collapsable={false}
          style={{ position: 'absolute', left: -99999, top: 0, width: 1080, height: 1920 }}
          pointerEvents="none"
        >
          <WrapPoster
            festivalName={currentFestival?.name ?? 'Festival'}
            topSets={posterTopSets}
            stats={{
              totalRated: data.stats.totalRated,
              stagesVisited: data.stats.stagesVisited,
              daysAttended: data.stats.daysAttended,
              totalHours: data.stats.totalHours ?? 0,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Cold-load placeholder for the wrap — a header line, the 4-up stat grid, and a
 * couple of list rows, matching the real layout so it doesn't jump on arrival.
 */
function WrapSkeleton() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.skeletonWrap} accessibilityRole="progressbar" accessibilityLabel="Loading your wrap">
      <View style={styles.skeletonHeader}>
        <Skeleton width={140} height={12} radius={t.radii.xs} />
        <Skeleton width={200} height={24} radius={t.radii.xs} />
      </View>
      {/* Bento-shaped skeleton — 1 full-width featured + 2 side-by-side */}
      <View style={styles.bentoGrid}>
        <View style={[styles.bentoFeatured, { padding: t.spacing[4], gap: t.spacing[1] }]}>
          <Skeleton width="50%" height={10} radius={t.radii.xs} />
          <Skeleton width="35%" height={28} radius={t.radii.xs} />
        </View>
        <View style={[styles.bentoRow, { gap: 1 }]}>
          <View style={[styles.bentoCell, styles.bentoCellDivider, { padding: t.spacing[4], gap: t.spacing[1] }]}>
            <Skeleton width="60%" height={10} radius={t.radii.xs} />
            <Skeleton width="40%" height={20} radius={t.radii.xs} />
          </View>
          <View style={[styles.bentoCell, { padding: t.spacing[4], gap: t.spacing[1] }]}>
            <Skeleton width="60%" height={10} radius={t.radii.xs} />
            <Skeleton width="40%" height={20} radius={t.radii.xs} />
          </View>
        </View>
      </View>
      <Skeleton width="45%" height={12} radius={t.radii.xs} />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={64} radius={t.radii.default} />
      ))}
    </View>
  );
}

// R10: count-up hook for mobile using Reanimated withTiming.
// Drives a SharedValue from 0 → numericTarget over `duration` ms with an
// ease-out cubic. A setState callback (runOnJS) on each frame keeps a
// React state string in sync so a plain <Text> can render it — avoiding
// AnimatedText dependency issues and keeping the pattern setState-throttled
// as the spec permits.
// Respects OS reduce-motion: when true, jumps straight to the final value.
function useCountUpMobile(target: string, duration = 800): string {
  const numericTarget = parseFloat(target);
  const hasDecimal = target.includes('.');
  const reduceMotion = useReduceMotion();
  const sv = useSharedValue(0);
  const [displayed, setDisplayed] = useState(() =>
    reduceMotion || isNaN(numericTarget) ? target : hasDecimal ? '0.0' : '0',
  );

  const fmt = useCallback(
    (v: number) => {
      setDisplayed(hasDecimal ? v.toFixed(1) : String(Math.round(v)));
    },
    [hasDecimal],
  );

  useDerivedValue(() => {
    runOnJS(fmt)(sv.value);
  });

  useEffect(() => {
    if (isNaN(numericTarget)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- non-numeric target shows verbatim once; not derivable as render state because the animated frames also drive `displayed` via runOnJS
      setDisplayed(target);
      return;
    }
    if (reduceMotion) {
      // eslint-disable-next-line react-hooks/immutability -- imperative Reanimated shared-value write; the count-up animation has no declarative/derived equivalent
      sv.value = numericTarget;
      setDisplayed(target);
      return;
    }
    sv.value = 0;
    sv.value = withTiming(numericTarget, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    // sv is a useSharedValue (stable ref); numericTarget is derived from target.
  }, [target, numericTarget, reduceMotion, duration, sv]);

  return displayed;
}

// R10 + R16: Stat renders the count-up animated value on mount.
// `featured` uses larger Syncopate-scale display type for the headline stat.
function Stat({ label, value, featured = false }: { label: string; value: string; featured?: boolean }) {
  const styles = useStyles();
  const animated = useCountUpMobile(value, 800);
  return (
    <View style={styles.statContent}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={featured ? styles.statValueFeatured : styles.statValue} accessibilityLabel={value}>
        {animated}
      </Text>
    </View>
  );
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

interface CrewWrapResponse {
  wrap: CrewWrapData;
}

/**
 * Crew wrap tab — fetches GET /ratings/crew-wrap/:crewId/:festivalId and renders
 * the shared recap, mirroring the web crew tab. Shares the off-screen poster +
 * react-native-view-shot capture pipeline used by the personal wrap.
 */
function CrewWrapTab({
  crewId,
  crewName,
  festivalId,
  festivalName,
}: {
  crewId: string | null;
  crewName: string;
  festivalId: string;
  festivalName: string;
}) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [wrap, setWrap] = useState<CrewWrapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Bumped by the error-state "Try again" action to re-run the fetch (F40).
  const [reloadKey, setReloadKey] = useState(0);
  const posterRef = useRef<View>(null);

  useEffect(() => {
    if (!crewId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: flip loading on before the async GET. Not derivable — loading tracks the in-flight request, not render inputs.
    setLoading(true);
    setError(false);
    api
      .get<CrewWrapResponse>(`/ratings/crew-wrap/${crewId}/${festivalId}`)
      .then((res) => {
        if (!cancelled) setWrap(res.wrap);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [crewId, festivalId, reloadKey]);

  const hasData =
    !!wrap &&
    wrap.memberCount > 0 &&
    (wrap.topOverlap !== null || wrap.setsSeenTogether.length > 0 || wrap.totalSplit > 0);

  const handleShare = async () => {
    if (!wrap || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Share your crew wrap',
        });
      } else {
        await Share.share({
          message: `Our ${festivalName} crew wrap 🎪\n${crewName} · ${wrap.memberCount} in the crew\nfestie.us`,
        });
      }
    } catch {
      // Capture failed or sheet dismissed.
    } finally {
      setSharing(false);
    }
  };

  if (!crewId) {
    return (
      <EmptyState
        icon="people-outline"
        title="No active crew"
        message="Join or select a crew to see your shared festival recap."
      />
    );
  }
  if (loading) {
    return <WrapSkeleton />;
  }
  if (error || !wrap) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load your crew wrap"
        message="Something went wrong loading the shared recap."
        action={{ label: 'Try again', onPress: () => setReloadKey((k) => k + 1) }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(t.spacing[4], insets.bottom + t.spacing[2]) },
        ]}
      >
        <View style={styles.headerBlock}>
          <View style={styles.kicker}>
            <Ionicons name="people" size={14} color={t.colors.accent.aqua} />
            <Text style={styles.kickerText}>Crew Wrap</Text>
          </View>
          <Text style={styles.festivalName}>{crewName}</Text>
          <Text style={styles.crewFestival}>{festivalName}</Text>
        </View>

        {/* R16: 3-cell horizontal bento with aqua hairline dividers */}
        <View style={styles.bentoCrew}>
          <View style={[styles.bentoCell, styles.bentoCellDivider]}>
            <Stat label="Crew" value={String(wrap.memberCount)} />
          </View>
          <View style={[styles.bentoCell, styles.bentoCellDivider]}>
            <Stat label="Seen together" value={String(wrap.setsSeenTogether.length)} />
          </View>
          <View style={styles.bentoCell}>
            <Stat label="Split" value={money(wrap.totalSplit)} />
          </View>
        </View>

        <View style={styles.superlative}>
          <Text style={styles.superLabel}>Most-overlapping taste</Text>
          <Text style={styles.superValue} numberOfLines={1}>
            {wrap.topOverlap ? `${wrap.topOverlap.aName} + ${wrap.topOverlap.bName}` : 'Rate more sets together'}
          </Text>
          {wrap.topOverlap ? (
            <Text style={styles.superSub}>
              {wrap.topOverlap.shared} shared favourite{wrap.topOverlap.shared === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>

        <View style={styles.superlative}>
          <Text style={styles.superLabel}>Biggest spender</Text>
          <Text style={styles.superValue} numberOfLines={1}>
            {wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          </Text>
          {wrap.biggestSpender ? (
            <Text style={styles.superSub}>fronted {money(wrap.biggestSpender.amount)}</Text>
          ) : null}
        </View>

        {wrap.setsSeenTogether.length > 0 ? (
          <View>
            <SectionLabel>Sets you saw together</SectionLabel>
            {wrap.setsSeenTogether.slice(0, 10).map((set) => (
              <View key={set.setId} style={styles.allRow}>
                <Text style={styles.allArtist} numberOfLines={1}>
                  {set.artist || set.setId}
                </Text>
                <Text style={styles.seenCount}>{set.count} loved it</Text>
              </View>
            ))}
          </View>
        ) : null}

        {wrap.perMember.some((m) => m.topSets.length > 0) ? (
          <View>
            <SectionLabel>Everyone&apos;s top picks</SectionLabel>
            {wrap.perMember.map((m) => (
              <View key={m.userId} style={styles.memberCard}>
                <Text style={styles.memberName}>{m.name}</Text>
                {m.topSets.length > 0 ? (
                  <Text style={styles.memberPicks} numberOfLines={2}>
                    {m.topSets.map((set) => `${EMOJI[set.rating] ?? '⭐'} ${set.artist || set.setId}`).join('   ')}
                  </Text>
                ) : (
                  <Text style={styles.memberEmpty}>No 4★+ sets yet</Text>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {hasData ? (
          <TouchableOpacity
            style={[styles.shareButton, sharing && styles.shareButtonBusy]}
            onPress={() => void handleShare()}
            disabled={sharing}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Share crew wrap"
          >
            {sharing ? (
              <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
            ) : (
              <Ionicons name="share-social-outline" size={16} color={t.colors.text.onLightAccent} />
            )}
            <Text style={styles.shareButtonText}>{sharing ? 'Preparing…' : 'Share crew wrap'}</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footer}>festie.us</Text>
      </ScrollView>

      {/* Off-screen poster for capture. */}
      {hasData ? (
        <View
          ref={posterRef}
          collapsable={false}
          style={{ position: 'absolute', left: -99999, top: 0, width: 1080, height: 1920 }}
          pointerEvents="none"
        >
          <CrewWrapPoster crewName={crewName} festivalName={festivalName} wrap={wrap} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  skeletonWrap: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[4],
  },
  skeletonHeader: {
    alignItems: 'center',
    gap: t.spacing[2],
  },
  content: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[4],
  },
  headerBlock: {
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kickerText: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.accent.aqua,
  },
  festivalName: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  // R16: Bento grid — aqua hairline gap via backgroundColor on the grid
  // container; each cell has a white bg so the gap shows through.
  bentoGrid: {
    borderRadius: t.radii.default,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,232,208,0.08)',
    gap: 1,
  },
  bentoFeatured: {
    backgroundColor: t.colors.bg.secondary,
  },
  bentoRow: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
  },
  bentoCell: {
    flex: 1,
    backgroundColor: t.colors.bg.secondary,
  },
  bentoCellDivider: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,232,208,0.12)',
  },
  bentoDividerH: {
    height: 1,
    backgroundColor: 'rgba(0,232,208,0.08)',
  },
  // R16: crew 3-cell horizontal bento
  bentoCrew: {
    flexDirection: 'row',
    borderRadius: t.radii.default,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,232,208,0.08)',
    gap: 1,
  },
  // Content inside a bento cell (no outer border — the grid handles it)
  statContent: {
    padding: t.spacing[4],
    gap: t.spacing[1],
  },
  statLabel: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.text.muted,
  },
  statValue: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  // Featured stat: larger Syncopate-scale display number
  statValueFeatured: {
    fontFamily: 'Syncopate_700Bold',
    fontSize: 36,
    lineHeight: 44,
    color: t.colors.text.primary,
    // No negative tracking on iOS — UIKit kerns after the last glyph and
    // clips the trailing character. 0 reads fine at this display size.
    letterSpacing: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    marginBottom: t.spacing[2],
  },
  topEmoji: {
    fontSize: 28,
  },
  topInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  topMeta: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  topArtist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  topNote: {
    ...typeStyle('caption'),
    fontStyle: 'italic',
    color: t.colors.text.secondary,
  },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  allEmoji: {
    fontSize: 18,
  },
  allArtist: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
  },
  allStage: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    // Accent rule (F13): aqua = primary action with dark ink; coral is danger-only.
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
  },
  shareButtonBusy: {
    opacity: 0.7,
  },
  shareButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
  footer: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textAlign: 'center',
    paddingTop: t.spacing[2],
  },
  tabBar: {
    flexDirection: 'row',
    gap: t.spacing[1],
    margin: t.spacing[4],
    marginBottom: 0,
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.sm,
  },
  tabActive: {
    // Aqua selection (F13) to match the SegmentedControl/plan-share active tab.
    backgroundColor: t.colors.accent.aqua,
  },
  tabText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  tabTextActive: {
    color: t.colors.text.onLightAccent,
  },
  crewFestival: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  superlative: {
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
  },
  superLabel: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.text.muted,
  },
  superValue: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  superSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  seenCount: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
  },
  memberCard: {
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    marginBottom: t.spacing[2],
    gap: t.spacing[1],
  },
  memberName: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  memberPicks: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  memberEmpty: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
}));
