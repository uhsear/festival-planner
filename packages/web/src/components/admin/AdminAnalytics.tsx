import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import {
  type AnalyticsData,
  normalize,
  ANALYTICS_DEFAULTS,
  formatDate,
  timeAgo,
} from './analyticsTypes';
import PickDistribution from './PickDistribution';
import EngagementMetrics from './EngagementMetrics';
import TopSets from './TopSets';
import FestivalStats from './FestivalStats';

/**
 * Analytics dashboard with charts and metrics.
 */
export default function AdminAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadAnalytics();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const raw = await api.get<unknown>('/admin/analytics');
      setData(normalize(raw));
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to load analytics', 'error');
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

  // Derive pick distribution totals
  const totals = data.topSets.reduce(
    (acc, s) => ({
      must: acc.must + s.mustCount,
      want: acc.want + s.wantCount,
      maybe: acc.maybe + s.maybeCount,
    }),
    { must: 0, want: 0, maybe: 0 },
  );

  // Engagement metrics
  const totalUsers = data.activeUsers.length;
  const picksSum = data.activeUsers.reduce((s, u) => s + u.totalPicks, 0);
  const avgPicksPerUser = totalUsers > 0 ? picksSum / totalUsers : 0;
  const crewMembers = data.crews.reduce((s, c) => s + c.memberCount, 0);
  const avgCrewSize = data.crews.length > 0 ? crewMembers / data.crews.length : 0;
  const crewParticipation = totalUsers > 0 ? Math.min(1, crewMembers / totalUsers) : 0;

  return (
    <div className="space-y-8">
      <PickDistribution must={totals.must} want={totals.want} maybe={totals.maybe} />

      <EngagementMetrics
        avgPicksPerUser={avgPicksPerUser}
        avgCrewSize={avgCrewSize}
        crewParticipation={crewParticipation}
      />

      <TopSets sets={data.topSets} />

      <FestivalStats stats={data.festivalStats} />

      {/* Active Users */}
      {data.activeUsers.length > 0 && (
        <div>
          <h2 className="type-heading text-text-primary mb-4">Most Active Users</h2>
          <div role="region" tabIndex={0} aria-label="Most active users table" className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua">
            <table className="w-full text-sm">
              <caption className="sr-only">Most active users</caption>
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
          <h2 className="type-heading text-text-primary mb-4">Crews</h2>
          <div role="region" tabIndex={0} aria-label="Crews table" className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua">
            <table className="w-full text-sm">
              <caption className="sr-only">Crews overview</caption>
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
