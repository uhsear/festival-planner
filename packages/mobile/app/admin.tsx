import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import type { Festival } from '@festie/shared/types';
import ScreenHeader from '../components/ScreenHeader';
import SectionLabel from '../components/SectionLabel';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Admin — a read-mostly mobile mirror of the web admin console
 * (packages/web/src/components/admin). Surfaces the same dashboard stats,
 * recent activity feed, and festival list, but intentionally omits every
 * destructive affordance the web console carries (user/crew deletion, role
 * edits, bulk archive, lineup/Spotify backfill). The mobile surface is a
 * glanceable, read-only window — write operations stay on the desktop console.
 *
 * Gated on useAuthStore isAdmin; a non-admin sees an "Admins only" EmptyState.
 * Pull-to-refresh re-runs the three GETs. Endpoints resolve under /api/v1:
 *   GET /admin/dashboard → { stats, recentActivity (enriched) }
 *   GET /admin/audit     → recent audit entries (array; wrapper strips meta)
 *   GET /festivals       → Festival[]
 */

interface DashboardStats {
  users: number;
  festivals: number;
  profiles: number;
  picks: number;
}
interface ActivityEntry {
  id: string;
  action: string;
  friendlyAction?: string;
  actorUsername?: string;
  createdAt: string;
}
interface DashboardResponse {
  stats: DashboardStats;
  recentActivity: ActivityEntry[];
}
interface AuditEntry {
  id: string;
  action: string;
  friendlyAction?: string;
  actorUsername?: string;
  createdAt: string;
}

// Relative "time ago" formatter — mirrors the web admin console's helper so the
// mobile feed reads identically.
function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AdminScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [dashboard, auditRows, festivalList] = await Promise.all([
        api.get<DashboardResponse>('/admin/dashboard'),
        api.get<AuditEntry[]>('/admin/audit'),
        api.get<Festival[]>('/festivals'),
      ]);
      setStats(dashboard?.stats ?? null);
      setActivity(Array.isArray(dashboard?.recentActivity) ? dashboard.recentActivity : []);
      setAudit(Array.isArray(auditRows) ? auditRows : []);
      setFestivals(Array.isArray(festivalList) ? festivalList : []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear loading when there's nothing to fetch
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  // Non-admins never see the data — bounce them with a clear empty state.
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Admin" subtitle="Dashboard & activity" icon="shield-checkmark-outline" />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  const statRows: { label: string; value: number }[] = stats
    ? [
        { label: 'Users', value: stats.users },
        { label: 'Festivals', value: stats.festivals },
        { label: 'Profiles', value: stats.profiles },
        { label: 'Picks', value: stats.picks },
      ]
    : [];

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Admin" subtitle="Dashboard & activity" icon="shield-checkmark-outline" />

      {loading ? (
        <LoadingState label="Loading admin data" />
      ) : error ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load admin data"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void onRefresh() }}
        />
      ) : (
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
          {/* Dashboard stats */}
          <SectionLabel>Dashboard</SectionLabel>
          <View style={styles.card}>
            {statRows.length > 0 ? (
              statRows.map((row, i) => (
                <View
                  key={row.label}
                  style={[styles.row, i < statRows.length - 1 && styles.rowDivider]}
                  accessibilityRole="text"
                  accessibilityLabel={`${row.label}: ${row.value}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{row.label}</Text>
                  </View>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>{row.value}</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowHint}>No stats available</Text>
              </View>
            )}
          </View>

          {/* Recent activity */}
          <SectionLabel>Recent activity</SectionLabel>
          <View style={styles.card}>
            {activity.length > 0 ? (
              activity.slice(0, 15).map((a, i) => (
                <View
                  key={a.id ?? i}
                  style={[styles.row, i < Math.min(activity.length, 15) - 1 && styles.rowDivider]}
                  accessibilityRole="text"
                  accessibilityLabel={`${a.friendlyAction ?? a.action} by ${a.actorUsername ?? 'system'}, ${timeAgo(a.createdAt)}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {a.friendlyAction ?? a.action}
                    </Text>
                    <Text style={styles.rowHint} numberOfLines={1}>
                      {a.actorUsername ?? 'system'} · {timeAgo(a.createdAt)}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowHint}>No recent activity</Text>
              </View>
            )}
          </View>

          {/* Audit log — most recent entries, read-only */}
          {audit.length > 0 ? (
            <>
              <SectionLabel>Audit log</SectionLabel>
              <View style={styles.card}>
                {audit.slice(0, 15).map((a, i) => (
                  <View
                    key={a.id ?? i}
                    style={[styles.row, i < Math.min(audit.length, 15) - 1 && styles.rowDivider]}
                    accessibilityRole="text"
                    accessibilityLabel={`${a.friendlyAction ?? a.action} by ${a.actorUsername ?? 'system'}, ${timeAgo(a.createdAt)}`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {a.friendlyAction ?? a.action}
                      </Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {a.actorUsername ?? 'system'} · {timeAgo(a.createdAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* Festivals — read-only listing (no edit) */}
          <SectionLabel>Festivals</SectionLabel>
          <View style={styles.card}>
            {festivals.length > 0 ? (
              festivals.map((f, i) => (
                <View
                  key={f.id}
                  style={[styles.row, i < festivals.length - 1 && styles.rowDivider]}
                  accessibilityRole="text"
                  accessibilityLabel={`Festival: ${f.name}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {f.name}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowHint}>No festivals</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}

      <Stack.Screen options={{ headerShown: false }} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
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
  statusPill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    minWidth: 48,
    alignItems: 'center',
  },
  statusText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
