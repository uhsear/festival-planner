import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import type { Festival } from '@festie/shared/types';
import ScreenHeader from '../../components/ScreenHeader';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin home — the hub of the mobile admin console
 * (packages/web/src/components/admin). Surfaces dashboard stats, a System
 * Health card (uptime / memory / connections / DB pool, straight from the
 * dashboard.health object), the recent activity feed, the audit log, and the
 * festival list. This screen itself stays read-only; every destructive write
 * lives behind a dedicated, ConfirmDialog-gated sub-screen reached from the
 * "Admin actions" section or the per-festival row actions below.
 *
 * Navigation (router.push, exact route strings — the screens exist so
 * expo-router typed routes resolve):
 *   /admin/users          — manage users
 *   /admin/crews          — manage crews
 *   /admin/analytics      — analytics
 *   /admin/audit          — full audit log
 *   /admin/festival-edit  — create (no id) or edit (?id=) a festival
 *   /admin/lineup-import?id=  — CSV lineup import for a festival
 *
 * Gated on useAuthStore isAdmin; a non-admin sees an "Admins only" EmptyState.
 * Pull-to-refresh re-runs the three GETs. Endpoints resolve under /api/v1:
 *   GET /admin/dashboard → { stats, health, recentActivity (enriched) }
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
interface HealthData {
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  connections: number;
  onlineRooms: number;
  database?: { totalCount: number; idleCount: number; waitingCount: number } | null;
}
interface DashboardResponse {
  stats: DashboardStats;
  health?: HealthData;
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

// Uptime formatter — mirrors the web admin console's formatUptime so the
// System Health card reads identically.
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const mn = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${hr}h ${mn}m`;
  if (hr > 0) return `${hr}h ${mn}m`;
  return `${mn}m`;
}

export default function AdminScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
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
      setHealth(dashboard?.health ?? null);
      setActivity(Array.isArray(dashboard?.recentActivity) ? dashboard.recentActivity : []);
      setAudit(Array.isArray(auditRows) ? auditRows : []);
      setFestivals(Array.isArray(festivalList) ? festivalList : []);
    } catch {
      setError(true);
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

  // System Health rows — mirrors the web console's System Health card, built
  // from the dashboard.health object (uptime / memory / connections / DB pool).
  const healthRows: { label: string; value: string }[] = health
    ? [
        { label: 'Uptime', value: formatUptime(health.uptime) },
        { label: 'Memory (RSS)', value: `${health.memory.rss} MB` },
        { label: 'Heap usage', value: `${health.memory.heapUsed} / ${health.memory.heapTotal} MB` },
        { label: 'WebSocket connections', value: String(health.connections) },
        { label: 'Online rooms', value: String(health.onlineRooms) },
        ...(health.database
          ? [
              {
                label: 'DB pool (A / I / W)',
                value: `${health.database.totalCount - health.database.idleCount}A / ${health.database.idleCount}I / ${health.database.waitingCount}W`,
              },
            ]
          : []),
      ]
    : [];

  // Admin actions — read-only home links into the destructive sub-screens.
  // Each sub-screen exists under app/admin/, so AuthGate (seg[0]==='admin')
  // already guards them and expo-router typed routes resolve.
  const adminActions: { label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
    { label: 'Manage users', icon: 'people-outline', route: '/admin/users' },
    { label: 'Manage crews', icon: 'people-circle-outline', route: '/admin/crews' },
    { label: 'Analytics', icon: 'bar-chart-outline', route: '/admin/analytics' },
    { label: 'Audit log', icon: 'document-text-outline', route: '/admin/audit' },
  ];

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

          {/* System Health — uptime / memory / connections / DB pool, from
              the dashboard.health object (read-only). */}
          {healthRows.length > 0 ? (
            <>
              <SectionLabel>System health</SectionLabel>
              <View style={styles.card}>
                {healthRows.map((row, i) => (
                  <View
                    key={row.label}
                    style={[styles.row, i < healthRows.length - 1 && styles.rowDivider]}
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
                ))}
              </View>
            </>
          ) : null}

          {/* Admin actions — navigation into the destructive sub-screens. */}
          <SectionLabel>Admin actions</SectionLabel>
          <View style={styles.card}>
            {adminActions.map((act, i) => (
              <TouchableOpacity
                key={act.route}
                style={[styles.row, i < adminActions.length - 1 && styles.rowDivider]}
                activeOpacity={0.7}
                onPress={() => router.push(act.route)}
                accessibilityRole="button"
                accessibilityLabel={act.label}
              >
                <Ionicons name={act.icon} size={t.iconSize.md} color={t.colors.accent.aqua} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{act.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push('/admin/festival-edit')}
              accessibilityRole="button"
              accessibilityLabel="New festival"
            >
              <Ionicons name="add-circle-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>New festival</Text>
              </View>
              <Ionicons name="chevron-forward" size={t.iconSize.sm} color={t.colors.text.secondary} />
            </TouchableOpacity>
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

          {/* Festivals — each row links to edit + lineup import. */}
          <SectionLabel>Festivals</SectionLabel>
          <View style={styles.card}>
            {festivals.length > 0 ? (
              festivals.map((f, i) => (
                <View
                  key={f.id}
                  style={[styles.row, i < festivals.length - 1 && styles.rowDivider]}
                  accessibilityLabel={`Festival: ${f.name}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {f.name}
                    </Text>
                  </View>
                  <View style={styles.rowActions}>
                    <TouchableOpacity
                      style={styles.iconBtn}
                      activeOpacity={0.7}
                      onPress={() => router.push(`/admin/festival-edit?id=${f.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${f.name}`}
                    >
                      <Ionicons name="create-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconBtn}
                      activeOpacity={0.7}
                      onPress={() => router.push(`/admin/lineup-import?id=${f.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Import lineup for ${f.name}`}
                    >
                      <Ionicons name="cloud-upload-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
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
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
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
