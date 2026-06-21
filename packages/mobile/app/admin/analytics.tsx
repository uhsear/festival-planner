import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import {
  normalizeAnalytics,
  ANALYTICS_DEFAULTS,
  type AnalyticsData,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';

/**
 * Admin Analytics — mobile mirror of the web AdminAnalytics dashboard.
 *
 * Renders:
 *   1. Pick distribution totals (must / want / maybe) as a token-bar + counts
 *   2. Engagement metrics (avg picks/user, avg crew size, crew participation %)
 *   3. Top Sets table (artist, pick count with must/want/maybe breakdown)
 *   4. Festival Stats (profile count, unique sets picked, total picks)
 *   5. Most Active Users (username, profiles, total picks, last active)
 *   6. Crews (name, member count, created date)
 *
 * Data flows through normalizeAnalytics() from @festie/shared/utils, which
 * coerces raw SQL strings to numbers — same normalizer the web console uses
 * (extracted to shared so both platforms stay in sync).
 *
 * Gated on isAdmin; the AuthGate on the admin segment also enforces this.
 * Pull-to-refresh re-runs GET /admin/analytics.
 */

/** Compact "time ago" from an ISO date string (used for lastActive). */
function timeAgoStr(dateStr: string): string {
  if (!dateStr) return '—';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (!Number.isFinite(diff) || diff < 0) return '—';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(s: string): string {
  if (!s) return '—';
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Simple inline bar: three segments sized by proportion. */
function PickBar({
  must,
  want,
  maybe,
}: {
  must: number;
  want: number;
  maybe: number;
}) {
  const t = useTokens();
  const total = must + want + maybe;
  if (total === 0) return null;
  const mustW = must / total;
  const wantW = want / total;
  const maybeW = maybe / total;
  return (
    <View
      style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: t.spacing[2] }}
      accessibilityLabel={`Pick distribution: must ${Math.round(mustW * 100)}%, want ${Math.round(wantW * 100)}%, maybe ${Math.round(maybeW * 100)}%`}
      accessibilityRole="image"
    >
      {mustW > 0 ? (
        <View style={{ flex: mustW, backgroundColor: t.colors.accent.coralStrong }} />
      ) : null}
      {wantW > 0 ? (
        <View style={{ flex: wantW, backgroundColor: t.colors.accent.aqua }} />
      ) : null}
      {maybeW > 0 ? (
        <View style={{ flex: maybeW, backgroundColor: t.colors.text.muted }} />
      ) : null}
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setError(false);
    try {
      const raw = await api.get<unknown>('/admin/analytics');
      setData(normalizeAnalytics(raw));
    } catch {
      setError(true);
      setData(ANALYTICS_DEFAULTS);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAnalytics().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, fetchAnalytics]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchAnalytics().finally(() => setRefreshing(false));
  }, [fetchAnalytics]);

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  // Derived metrics (match web AdminAnalytics exactly)
  const totals = data
    ? data.topSets.reduce(
        (acc, s) => ({
          must: acc.must + s.mustCount,
          want: acc.want + s.wantCount,
          maybe: acc.maybe + s.maybeCount,
        }),
        { must: 0, want: 0, maybe: 0 },
      )
    : { must: 0, want: 0, maybe: 0 };

  const totalUsers = data?.activeUsers.length ?? 0;
  const picksSum = data?.activeUsers.reduce((s, u) => s + u.totalPicks, 0) ?? 0;
  const avgPicksPerUser = totalUsers > 0 ? picksSum / totalUsers : 0;
  const crewMembers = data?.crews.reduce((s, c) => s + c.memberCount, 0) ?? 0;
  const avgCrewSize = (data?.crews.length ?? 0) > 0 ? crewMembers / (data?.crews.length ?? 1) : 0;
  const crewParticipation = totalUsers > 0 ? Math.min(1, crewMembers / totalUsers) : 0;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + t.spacing[4] }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={t.iconSize.md} color={t.colors.accent.aqua} />
        </TouchableOpacity>
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
        >
          Analytics
        </Text>
        {!loading && !error ? (
          <TouchableOpacity
            onPress={onRefresh}
            style={styles.refreshBtn}
            accessibilityRole="button"
            accessibilityLabel="Refresh analytics"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="refresh-outline" size={t.iconSize.md} color={t.colors.text.secondary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.refreshBtn} />
        )}
      </View>

      {loading ? (
        <LoadingState label="Loading analytics" />
      ) : error && !data ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load analytics"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: onRefresh }}
        />
      ) : data ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
        >
          {/* ── Pick distribution ─────────────────────────────── */}
          <SectionLabel>Pick distribution</SectionLabel>
          <View style={styles.card}>
            <View style={styles.section}>
              <PickBar must={totals.must} want={totals.want} maybe={totals.maybe} />
              <View style={styles.legendRow}>
                <LegendDot color={t.colors.accent.coralStrong} label={`Must (${totals.must})`} />
                <LegendDot color={t.colors.accent.aqua} label={`Want (${totals.want})`} />
                <LegendDot color={t.colors.text.muted} label={`Maybe (${totals.maybe})`} />
              </View>
            </View>
          </View>

          {/* ── Engagement metrics ────────────────────────────── */}
          <SectionLabel>Engagement</SectionLabel>
          <View style={styles.card}>
            {(
              [
                { label: 'Avg picks / user', value: avgPicksPerUser.toFixed(1) },
                { label: 'Avg crew size', value: avgCrewSize.toFixed(1) },
                { label: 'Crew participation', value: formatPct(crewParticipation) },
              ] as { label: string; value: string }[]
            ).map((m, i, arr) => (
              <View
                key={m.label}
                style={[styles.row, i < arr.length - 1 && styles.rowDivider]}
                accessibilityRole="text"
                accessibilityLabel={`${m.label}: ${m.value}`}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{m.label}</Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{m.value}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ── Top sets ──────────────────────────────────────── */}
          {data.topSets.length > 0 ? (
            <>
              <SectionLabel>Top sets</SectionLabel>
              <View style={styles.card}>
                {data.topSets.slice(0, 15).map((s, i) => (
                  <View
                    key={`${s.artist}-${s.festivalId}-${i}`}
                    style={[styles.row, i < Math.min(data.topSets.length, 15) - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${s.artist}: ${s.pickCount} picks`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {s.artist}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {s.mustCount}M · {s.wantCount}W · {s.maybeCount}Mb
                      </Text>
                    </View>
                    <View style={styles.pill}>
                      <Text style={styles.pillText}>{s.pickCount}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* ── Festival stats ────────────────────────────────── */}
          {data.festivalStats.length > 0 ? (
            <>
              <SectionLabel>Festival stats</SectionLabel>
              <View style={styles.card}>
                {data.festivalStats.map((f, i) => (
                  <View
                    key={f.id}
                    style={[styles.row, i < data.festivalStats.length - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${f.name}: ${f.profileCount} profiles, ${f.totalPicks} picks`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {f.profileCount} profiles · {f.uniqueSetsPicked} sets · {f.totalPicks} picks
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* ── Most active users ─────────────────────────────── */}
          {data.activeUsers.length > 0 ? (
            <>
              <SectionLabel>Most active users</SectionLabel>
              <View style={styles.card}>
                {data.activeUsers.slice(0, 15).map((u, i) => (
                  <View
                    key={u.id}
                    style={[styles.row, i < Math.min(data.activeUsers.length, 15) - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${u.username}: ${u.totalPicks} picks, last active ${timeAgoStr(u.lastActive)}`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {u.username}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {u.profileCount} profile{u.profileCount !== 1 ? 's' : ''} · {u.totalPicks} picks · {timeAgoStr(u.lastActive)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* ── Crews ─────────────────────────────────────────── */}
          {data.crews.length > 0 ? (
            <>
              <SectionLabel>Crews</SectionLabel>
              <View style={styles.card}>
                {data.crews.map((c, i) => (
                  <View
                    key={c.id}
                    style={[styles.row, i < data.crews.length - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${c.name}: ${c.memberCount} members`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {c.memberCount} member{c.memberCount !== 1 ? 's' : ''} · created {formatDate(c.createdAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {data.generatedAt ? (
            <Text style={styles.generatedAt}>
              Generated {new Date(data.generatedAt).toLocaleString()}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  const styles = useLegendStyles();
  return (
    <View style={styles.item} accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useLegendStyles = makeStyles((t) => ({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    ...typeStyle('heading'),
    lineHeight: undefined,
    color: t.colors.text.primary,
    flex: 1,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  section: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[3],
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[3],
    marginTop: t.spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  pill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    minWidth: 48,
    alignItems: 'center',
  },
  pillText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  generatedAt: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'right',
    marginTop: t.spacing[2],
  },
}));
