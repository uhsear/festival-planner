import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

/**
 * Shape of GET /admin/analytics. Server returns numeric aggregates as strings
 * (raw SQL), so we coerce via the toNum helper rather than a schema runtime.
 */
interface TopSet {
  artist: string;
  stageId: string | null;
  dayIndex: number | null;
  festivalId: string;
  startTime: string | null;
  endTime: string | null;
  pickCount: number;
  mustCount: number;
  wantCount: number;
  maybeCount: number;
}

interface ActiveUser {
  id: string;
  username: string;
  profileCount: number;
  totalPicks: number;
  lastActive: string;
}

interface CrewSummary {
  id: string;
  name: string;
  festivalId: string;
  memberCount: number;
  createdAt: string;
}

interface FestivalStat {
  id: string;
  name: string;
  profileCount: number;
  uniqueSetsPicked: number;
  totalPicks: number;
}

interface AnalyticsData {
  topSets: TopSet[];
  activeUsers: ActiveUser[];
  crews: CrewSummary[];
  festivalStats: FestivalStat[];
  generatedAt: string | null;
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalize(raw: any): AnalyticsData {
  const r = raw || {};
  const topSets = Array.isArray(r.topSets) ? r.topSets : [];
  const activeUsers = Array.isArray(r.activeUsers) ? r.activeUsers : [];
  const crews = Array.isArray(r.crews) ? r.crews : [];
  const festivalStats = Array.isArray(r.festivalStats) ? r.festivalStats : [];
  return {
    topSets: topSets.map((s: any) => ({
      artist: toStr(s?.artist),
      stageId: typeof s?.stageId === 'string' ? s.stageId : null,
      dayIndex: typeof s?.dayIndex === 'number' ? s.dayIndex : null,
      festivalId: toStr(s?.festivalId),
      startTime: typeof s?.startTime === 'string' ? s.startTime : null,
      endTime: typeof s?.endTime === 'string' ? s.endTime : null,
      pickCount: toNum(s?.pickCount),
      mustCount: toNum(s?.mustCount),
      wantCount: toNum(s?.wantCount),
      maybeCount: toNum(s?.maybeCount),
    })),
    activeUsers: activeUsers.map((u: any) => ({
      id: toStr(u?.id),
      username: toStr(u?.username),
      profileCount: toNum(u?.profileCount),
      totalPicks: toNum(u?.totalPicks),
      lastActive: toStr(u?.lastActive),
    })),
    crews: crews.map((c: any) => ({
      id: toStr(c?.id),
      name: toStr(c?.name),
      festivalId: toStr(c?.festivalId),
      memberCount: toNum(c?.memberCount),
      createdAt: toStr(c?.createdAt),
    })),
    festivalStats: festivalStats.map((f: any) => ({
      id: toStr(f?.id),
      name: toStr(f?.name),
      profileCount: toNum(f?.profileCount),
      uniqueSetsPicked: toNum(f?.uniqueSetsPicked),
      totalPicks: toNum(f?.totalPicks),
    })),
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
  };
}

const ANALYTICS_DEFAULTS: AnalyticsData = {
  topSets: [],
  activeUsers: [],
  crews: [],
  festivalStats: [],
  generatedAt: null,
};

function formatDate(s: string): string {
  if (!s) return '—';
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

function timeAgo(s: string): string {
  if (!s) return '—';
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return s;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Analytics dashboard with charts and metrics.
 */
export default function AdminAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const raw = await api.get<unknown>('/admin/analytics');
      setData(normalize(raw));
    } catch (err: any) {
      toast(err.message || 'Failed to load analytics', 'error');
      setData(ANALYTICS_DEFAULTS);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading analytics...</div>;
  }

  if (!data) {
    return <div className="text-center py-12 text-text-muted">Analytics data unavailable</div>;
  }

  // Derive pick distribution by summing counts across topSets
  const totals = data.topSets.reduce(
    (acc, s) => ({
      must: acc.must + s.mustCount,
      want: acc.want + s.wantCount,
      maybe: acc.maybe + s.maybeCount,
    }),
    { must: 0, want: 0, maybe: 0 },
  );
  const totalPicks = totals.must + totals.want + totals.maybe;
  const mustPercent = totalPicks > 0 ? (totals.must / totalPicks) * 100 : 0;
  const wantPercent = totalPicks > 0 ? (totals.want / totalPicks) * 100 : 0;
  const maybePercent = totalPicks > 0 ? (totals.maybe / totalPicks) * 100 : 0;

  // Engagement metrics derived from available aggregates
  const totalUsers = data.activeUsers.length;
  const picksSum = data.activeUsers.reduce((s, u) => s + u.totalPicks, 0);
  const avgPicksPerUser = totalUsers > 0 ? picksSum / totalUsers : 0;
  const crewMembers = data.crews.reduce((s, c) => s + c.memberCount, 0);
  const avgCrewSize = data.crews.length > 0 ? crewMembers / data.crews.length : 0;
  const crewParticipation = totalUsers > 0 ? Math.min(1, crewMembers / totalUsers) : 0;

  const maxArtistPicks = data.topSets.reduce((m, s) => Math.max(m, s.pickCount), 1);

  return (
    <div className="space-y-8">
      {/* Pick Distribution */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Pick Distribution</h2>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <div className="text-sm text-text-muted mb-2">Must See</div>
              <div className="text-3xl font-bold text-accent-coral">{totals.must}</div>
              <div className="text-xs text-text-muted mt-1">{mustPercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-sm text-text-muted mb-2">Want to See</div>
              <div className="text-3xl font-bold text-accent-aqua">{totals.want}</div>
              <div className="text-xs text-text-muted mt-1">{wantPercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-sm text-text-muted mb-2">Maybe</div>
              <div className="text-3xl font-bold text-accent-amber">{totals.maybe}</div>
              <div className="text-xs text-text-muted mt-1">{maybePercent.toFixed(1)}%</div>
            </div>
          </div>
          {/* Bar chart */}
          <div className="flex gap-1 h-8 rounded-lg overflow-hidden bg-bg-primary/20">
            {mustPercent > 0 && (
              <div
                style={{ flex: mustPercent }}
                className="bg-accent-coral transition-all"
                title={`Must: ${mustPercent.toFixed(1)}%`}
              />
            )}
            {wantPercent > 0 && (
              <div
                style={{ flex: wantPercent }}
                className="bg-accent-aqua transition-all"
                title={`Want: ${wantPercent.toFixed(1)}%`}
              />
            )}
            {maybePercent > 0 && (
              <div
                style={{ flex: maybePercent }}
                className="bg-accent-amber transition-all"
                title={`Maybe: ${maybePercent.toFixed(1)}%`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Engagement Metrics */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Engagement Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="text-sm text-text-muted mb-1">Avg Picks per User</div>
            <div className="text-2xl font-bold text-text-primary">{avgPicksPerUser.toFixed(1)}</div>
          </div>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="text-sm text-text-muted mb-1">Avg Crew Size</div>
            <div className="text-2xl font-bold text-text-primary">{avgCrewSize.toFixed(1)}</div>
          </div>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="text-sm text-text-muted mb-1">Crew Participation</div>
            <div className="text-2xl font-bold text-text-primary">{(crewParticipation * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Top Sets */}
      {data.topSets.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Top Picked Sets</h2>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
            {data.topSets.slice(0, 15).map((s, i) => (
              <div key={`${s.artist}-${i}`} className="flex items-center gap-3">
                <div className="text-sm font-bold text-text-muted min-w-6">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary mb-1 truncate">{s.artist}</div>
                  <div className="h-2 rounded-full bg-bg-primary/30 overflow-hidden">
                    <div
                      style={{ width: `${(s.pickCount / maxArtistPicks) * 100}%` }}
                      className="h-full bg-gradient-to-r from-accent-aqua to-accent-coral transition-all"
                    />
                  </div>
                </div>
                <div className="text-sm font-medium text-text-muted min-w-12 text-right">{s.pickCount}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Festival Stats */}
      {data.festivalStats.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Festival Stats</h2>
          <div role="region" tabIndex={0} aria-label="Festival stats table" className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-glass-border">
                  <th className="px-4 py-2">Festival</th>
                  <th className="px-4 py-2 text-right">Profiles</th>
                  <th className="px-4 py-2 text-right">Unique Sets Picked</th>
                  <th className="px-4 py-2 text-right">Total Picks</th>
                </tr>
              </thead>
              <tbody>
                {data.festivalStats.map((f) => (
                  <tr key={f.id} className="border-b border-glass-border last:border-0">
                    <td className="px-4 py-2 text-text-primary">{f.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.profileCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.uniqueSetsPicked}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.totalPicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Users */}
      {data.activeUsers.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Most Active Users</h2>
          <div role="region" tabIndex={0} aria-label="Most active users table" className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-glass-border">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2 text-right">Profiles</th>
                  <th className="px-4 py-2 text-right">Total Picks</th>
                  <th className="px-4 py-2 text-right">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {data.activeUsers.slice(0, 15).map((u) => (
                  <tr key={u.id} className="border-b border-glass-border last:border-0">
                    <td className="px-4 py-2 text-text-primary">{u.username}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.profileCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.totalPicks}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{timeAgo(u.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Crews */}
      {data.crews.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Crews</h2>
          <div role="region" tabIndex={0} aria-label="Crews table" className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-glass-border">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2 text-right">Members</th>
                  <th className="px-4 py-2 text-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.crews.map((c) => (
                  <tr key={c.id} className="border-b border-glass-border last:border-0">
                    <td className="px-4 py-2 text-text-primary">{c.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.memberCount}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.generatedAt && (
        <div className="text-xs text-text-muted text-right">
          Generated at {new Date(data.generatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
