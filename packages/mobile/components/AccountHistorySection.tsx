import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

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

function dateSpan(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${start} → ${end}`;
  return start || end;
}

/**
 * History surface for the mobile Account screen (M3). Fetches GET
 * /ratings/lifetime and renders lifetime totals, a per-festival timeline, and
 * all-time top artists. Mirrors the web HistorySection; reuses the wrap
 * stat-card styling. Empty (zero ratings) renders a clean empty state.
 */
export default function AccountHistorySection() {
  const t = useTokens();
  const styles = useStyles();
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
  }, [user, reload]);

  if (!user) return null;

  if (loading) {
    return (
      <View style={[styles.card, styles.centered]}>
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.card, styles.centered]}>
        <Text style={styles.emptyText}>{error}</Text>
        <TouchableOpacity
          onPress={() => setReload((n) => n + 1)}
          accessibilityRole="button"
          accessibilityLabel="Retry loading history"
          style={styles.retry}
        >
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
        <Ionicons name="time-outline" size={28} color={t.colors.text.secondary} />
        <Text style={styles.emptyText}>No festival history yet. Rate sets and your timeline builds here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Lifetime totals */}
      <View style={styles.statGrid}>
        <Stat label="Festivals" value={String(totals.festivalsAttended)} />
        <Stat label="Sets rated" value={String(totals.totalRated)} />
        <Stat label="Stages" value={String(totals.stagesVisited)} />
        <Stat label="Hours" value={(totals.totalHours ?? 0).toFixed(1)} />
      </View>

      {/* Per-festival timeline */}
      {byFestival.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your festival timeline</Text>
          {byFestival.map((f, i) => {
            const span = dateSpan(f.startDate, f.endDate);
            return (
              <View key={f.festivalId} style={[styles.festRow, i === byFestival.length - 1 && styles.lastRow]}>
                <View style={styles.festHead}>
                  <Text style={styles.festName} numberOfLines={1}>
                    {f.festivalName || f.festivalId}
                  </Text>
                  {span ? <Text style={styles.festDate}>{span}</Text> : null}
                </View>
                <Text style={styles.festMeta}>
                  {f.totalRated} rated
                  {f.avgRating != null ? ` · ${f.avgRating.toFixed(1)}★` : ''}
                  {` · ${f.stagesVisited} ${f.stagesVisited === 1 ? 'stage' : 'stages'} · ${f.daysAttended} ${f.daysAttended === 1 ? 'day' : 'days'} · ${(f.totalHours ?? 0).toFixed(1)}h`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* All-time top artists */}
      {topArtists.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your all-time top artists</Text>
          {topArtists.map((a, i) => (
            <View key={a.artist} style={[styles.artistRow, i === topArtists.length - 1 && styles.lastRow]}>
              <Text style={styles.artistName} numberOfLines={1}>
                {a.artist}
              </Text>
              <Text style={styles.artistMeta}>
                {a.bestRating}★ · {a.timesRated}×
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
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
  cardLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
    marginBottom: t.spacing[1],
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
  statLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textTransform: 'uppercase',
  },
  statValue: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  festRow: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
    paddingBottom: t.spacing[2],
    gap: t.spacing[1],
  },
  lastRow: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  festHead: {
    flexDirection: 'column',
    gap: t.spacing[1],
  },
  festName: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  festDate: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  festMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
    paddingVertical: t.spacing[1],
  },
  artistName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  artistMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  emptyText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  retry: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  retryText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
