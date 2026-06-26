import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { Skeleton } from './Skeleton';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { formatDateSpan } from '../lib/accountFormat';

// Server shape from GET /ratings/lifetime (M3 cross-festival YoY history).
interface LifetimeTotals {
  totalRated: number;
  avgRating: number | null;
  festivalsAttended: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface FestivalRow {
  festivalId: string;
  festivalName: string | null;
  startDate: string | null;
  endDate: string | null;
  totalRated: number;
  avgRating: number | null;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface TopArtist {
  artist: string;
  timesRated: number;
  bestRating: number;
  avgRating: number | null;
}
interface LifetimeResponse {
  totals: LifetimeTotals;
  byFestival: FestivalRow[];
  topArtists: TopArtist[];
}

interface AccountHistorySectionProps {
  /** Bumping this (from the screen's pull-to-refresh) re-fetches the history. */
  refreshSignal?: number;
}

/** Medal tint for the top-three all-time artists (gold / silver / bronze). */
const MEDAL = ['#ffd24a', '#c8c8d6', '#cd8c5a'] as const;

/**
 * History surface for the mobile Account screen (M3). Fetches GET
 * /ratings/lifetime and renders lifetime totals, a per-festival timeline, and
 * all-time top artists. Mirrors the web HistorySection; reuses the wrap
 * stat-card styling. Empty (zero ratings) renders a clean empty state.
 */
export default function AccountHistorySection({ refreshSignal = 0 }: AccountHistorySectionProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  // Auth gate: /ratings/lifetime 401s for guests (section can be mounted
  // eagerly by NativeTabs even when the user never opens Account).
  const user = useAuthStore((s) => s.user);

  const [data, setData] = useState<LifetimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: flip loading on before the async GET /ratings/lifetime; loading tracks the in-flight request, not render inputs.
    setLoading(true);
    setError(null);
    api
      .get<LifetimeResponse>('/ratings/lifetime')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, reload, refreshSignal]);

  if (!user) return null;

  // First-load only: show the skeleton while there is nothing to show yet. A
  // background refresh (pull-to-refresh bumps refreshSignal) keeps loading=true
  // but data is already populated, so we must NOT flash the loaded card back to
  // a skeleton — render the stale data until the fresh fetch resolves.
  if (loading && !data) {
    // Skeleton mirrors the loaded layout (stat grid + timeline) so the card
    // doesn't pop in height when the data lands — calmer than a bare spinner.
    return (
      <View style={styles.wrap}>
        <View style={styles.statGrid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.stat}>
              <Skeleton width={48} height={10} radius={t.radii.xs} />
              <Skeleton width={36} height={20} radius={t.radii.xs} />
            </View>
          ))}
        </View>
        <View style={styles.card}>
          <Skeleton width={140} height={12} radius={t.radii.xs} />
          <View style={{ height: t.spacing[2] }} />
          <Skeleton width="100%" height={14} radius={t.radii.xs} />
          <View style={{ height: t.spacing[2] }} />
          <Skeleton width="80%" height={12} radius={t.radii.xs} />
        </View>
      </View>
    );
  }

  // Same rule as the skeleton: only let an error replace the card when there is
  // no prior data. A failed background refresh keeps the stale (still-useful)
  // history visible rather than swapping it for an error panel.
  if (error && !data) {
    return (
      <View style={[styles.card, styles.centered]}>
        <Ionicons name="cloud-offline-outline" size={28} color={t.colors.text.secondary} />
        <Text style={styles.emptyText}>{error}</Text>
        <TouchableOpacity
          onPress={() => setReload((n) => n + 1)}
          accessibilityRole="button"
          accessibilityLabel="Retry loading history"
          activeOpacity={0.8}
          style={styles.retry}
        >
          <Ionicons name="refresh" size={14} color={t.colors.accent.aqua} style={styles.retryIcon} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totals = data?.totals;
  const byFestival = data?.byFestival ?? [];
  const topArtists = data?.topArtists ?? [];

  if (!totals || totals.totalRated === 0) {
    return (
      <View style={[styles.card, styles.centered]}>
        <View style={styles.emptyIcon}>
          <Ionicons name="time-outline" size={26} color={t.colors.accent.aqua} />
        </View>
        <Text style={styles.emptyTitle}>No history yet</Text>
        <Text style={styles.emptyText}>Rate sets at a festival and your year-over-year timeline builds here.</Text>
      </View>
    );
  }

  const Wrapper = reduceMotion ? View : Animated.View;
  const avg = totals.avgRating != null ? totals.avgRating.toFixed(1) : '—';

  return (
    <Wrapper entering={reduceMotion ? undefined : FadeIn.duration(220)} style={styles.wrap}>
      {/* Lifetime totals */}
      <View style={styles.statGrid}>
        <Stat icon="musical-notes-outline" label="Festivals" value={String(totals.festivalsAttended)} />
        <Stat icon="star-outline" label="Sets rated" value={String(totals.totalRated)} />
        <Stat icon="star" label="Avg rating" value={avg} accent />
        <Stat icon="time-outline" label="Hours" value={(totals.totalHours ?? 0).toFixed(1)} />
      </View>

      {/* Per-festival timeline */}
      {byFestival.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name="calendar-outline" size={14} color={t.colors.text.secondary} style={styles.cardHeadIcon} />
            <Text style={styles.cardLabel}>Your festival timeline</Text>
          </View>
          {byFestival.map((f, i) => {
            const span = formatDateSpan(f.startDate, f.endDate);
            return (
              <View key={f.festivalId} style={[styles.festRow, i === byFestival.length - 1 && styles.lastRow]}>
                <View style={styles.festHead}>
                  <Text style={styles.festName} numberOfLines={1}>
                    {f.festivalName || f.festivalId}
                  </Text>
                  {span ? <Text style={styles.festDate}>{span}</Text> : null}
                </View>
                <View style={styles.festChips}>
                  <MetaChip icon="star" text={`${f.totalRated} rated`} />
                  {f.avgRating != null ? <MetaChip icon="star-half" text={`${f.avgRating.toFixed(1)} avg`} /> : null}
                  <MetaChip icon="location-outline" text={`${f.stagesVisited} ${f.stagesVisited === 1 ? 'stage' : 'stages'}`} />
                  <MetaChip icon="sunny-outline" text={`${f.daysAttended} ${f.daysAttended === 1 ? 'day' : 'days'}`} />
                  <MetaChip icon="time-outline" text={`${(f.totalHours ?? 0).toFixed(1)}h`} />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* All-time top artists */}
      {topArtists.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name="trophy-outline" size={14} color={t.colors.text.secondary} style={styles.cardHeadIcon} />
            <Text style={styles.cardLabel}>Your all-time top artists</Text>
          </View>
          {topArtists.map((a, i) => (
            <View key={a.artist} style={[styles.artistRow, i === topArtists.length - 1 && styles.lastRow]}>
              <View style={[styles.rank, i < 3 && { borderColor: MEDAL[i] }]}>
                <Text style={[styles.rankText, i < 3 && { color: MEDAL[i] }]}>{i + 1}</Text>
              </View>
              <Text style={styles.artistName} numberOfLines={1}>
                {a.artist}
              </Text>
              <View style={styles.artistMetaWrap}>
                <Ionicons name="star" size={11} color={t.colors.accent.amber} />
                <Text style={styles.artistMeta}>
                  {a.bestRating} · {a.timesRated}×
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Wrapper>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent?: boolean;
}) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Ionicons
          name={icon}
          size={12}
          color={accent ? t.colors.accent.aqua : t.colors.text.secondary}
          style={styles.statIcon}
        />
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
    </View>
  );
}

function MetaChip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={11} color={t.colors.text.secondary} style={styles.metaChipIcon} />
      <Text style={styles.metaChipText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[3],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: t.spacing[1],
  },
  cardHeadIcon: {
    marginRight: t.spacing[2],
  },
  cardLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  stat: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[3],
    gap: t.spacing[1],
  },
  statHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statIcon: {
    marginRight: t.spacing[1],
  },
  statLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  statValue: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  statValueAccent: {
    color: t.colors.accent.aqua,
  },
  festRow: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
    paddingBottom: t.spacing[3],
    paddingTop: t.spacing[1],
    gap: t.spacing[2],
  },
  lastRow: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  festHead: {
    flexDirection: 'column',
    gap: 2,
  },
  festName: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  festDate: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  festChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[1],
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.sm,
    paddingHorizontal: t.spacing[2],
    paddingVertical: 3,
  },
  metaChipIcon: {
    marginRight: 4,
  },
  metaChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
    paddingVertical: t.spacing[2],
  },
  rank: {
    width: 24,
    height: 24,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  artistName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  artistMetaWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  artistMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.aquaAlpha[10],
    marginBottom: t.spacing[1],
  },
  emptyTitle: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  emptyText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[40],
    marginTop: t.spacing[1],
  },
  retryIcon: {
    marginRight: t.spacing[1],
  },
  retryText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
