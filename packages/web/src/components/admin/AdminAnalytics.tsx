import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

interface AnalyticsData {
  picks: {
    must: number;
    want: number;
    maybe: number;
  };
  activeUsers: Array<{ date: string; count: number }>;
  topArtists: Array<{ name: string; pickCount: number }>;
  registration: Array<{ date: string; count: number }>;
  engagement: {
    avgPicksPerUser: number;
    avgCrewSize: number;
    crewParticipation: number;
  };
}

/**
 * Analytics dashboard with charts and metrics
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
      const result = await api.get<AnalyticsData>('/admin/analytics');
      setData(result);
    } catch (err: any) {
      toast(err.message || 'Failed to load analytics', 'error');
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

  const picks = data.picks || { must: 0, want: 0, maybe: 0 };
  const engagement = data.engagement || { avgPicksPerUser: 0, avgCrewSize: 0, crewParticipation: 0 };
  const totalPicks = (picks.must || 0) + (picks.want || 0) + (picks.maybe || 0);
  const mustPercent = totalPicks > 0 ? ((picks.must || 0) / totalPicks) * 100 : 0;
  const wantPercent = totalPicks > 0 ? ((picks.want || 0) / totalPicks) * 100 : 0;
  const maybePercent = totalPicks > 0 ? ((picks.maybe || 0) / totalPicks) * 100 : 0;

  const maxRegistrations = Math.max(...(data.registration || []).map((r) => r.count), 1);
  const maxActive = Math.max(...(data.activeUsers || []).map((a) => a.count), 1);
  const maxArtistPicks = Math.max(...(data.topArtists || []).map((a) => a.pickCount), 1);

  return (
    <div className="space-y-8">
      {/* Pick Distribution */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-4">Pick Distribution</h3>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <div className="text-sm text-text-muted mb-2">Must See</div>
              <div className="text-3xl font-bold text-accent-coral">{picks.must || 0}</div>
              <div className="text-xs text-text-muted mt-1">{mustPercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-sm text-text-muted mb-2">Want to See</div>
              <div className="text-3xl font-bold text-accent-aqua">{picks.want || 0}</div>
              <div className="text-xs text-text-muted mt-1">{wantPercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-sm text-text-muted mb-2">Maybe</div>
              <div className="text-3xl font-bold text-accent-amber">{picks.maybe || 0}</div>
              <div className="text-xs text-text-muted mt-1">{maybePercent.toFixed(1)}%</div>
            </div>
          </div>

          {/* Bar chart */}
          <div className="flex gap-1 h-8 rounded-lg overflow-hidden bg-bg-primary/20">
            {mustPercent > 0 && (
              <div style={{ flex: mustPercent }} className="bg-accent-coral transition-all" title={`Must: ${mustPercent.toFixed(1)}%`} />
            )}
            {wantPercent > 0 && (
              <div style={{ flex: wantPercent }} className="bg-accent-aqua transition-all" title={`Want: ${wantPercent.toFixed(1)}%`} />
            )}
            {maybePercent > 0 && (
              <div style={{ flex: maybePercent }} className="bg-accent-amber transition-all" title={`Maybe: ${maybePercent.toFixed(1)}%`} />
            )}
          </div>
        </div>
      </div>

      {/* Engagement Metrics */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-4">Engagement Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="text-sm text-text-muted mb-1">Avg Picks per User</div>
            <div className="text-2xl font-bold text-text-primary">{(engagement.avgPicksPerUser || 0).toFixed(1)}</div>
          </div>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="text-sm text-text-muted mb-1">Avg Crew Size</div>
            <div className="text-2xl font-bold text-text-primary">{(engagement.avgCrewSize || 0).toFixed(1)}</div>
          </div>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="text-sm text-text-muted mb-1">Crew Participation</div>
            <div className="text-2xl font-bold text-text-primary">{((engagement.crewParticipation || 0) * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Top Artists */}
      {(data.topArtists || []).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Top 10 Most Picked Artists</h3>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
            {(data.topArtists || []).slice(0, 10).map((artist, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="text-sm font-bold text-text-muted min-w-6">{i + 1}</div>
                <div className="flex-1">
                  <div className="text-sm text-text-primary mb-1">{artist.name}</div>
                  <div className="h-2 rounded-full bg-bg-primary/30 overflow-hidden">
                    <div
                      style={{ width: `${(artist.pickCount / maxArtistPicks) * 100}%` }}
                      className="h-full bg-gradient-to-r from-accent-aqua to-accent-coral transition-all"
                    />
                  </div>
                </div>
                <div className="text-sm font-medium text-text-muted min-w-12 text-right">{artist.pickCount}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Registration Trend */}
      {(data.registration || []).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Registration Trend</h3>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="flex gap-1 h-32 items-end">
              {(data.registration || []).slice(-30).map((entry, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-accent-aqua to-accent-aqua/30 rounded-t-sm transition-all hover:opacity-80 cursor-pointer"
                  style={{ height: `${(entry.count / maxRegistrations) * 100}%` }}
                  title={`${entry.date}: ${entry.count} registrations`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-text-muted mt-2">
              <span>30 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Users Trend */}
      {(data.activeUsers || []).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Active Users Trend</h3>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="flex gap-1 h-32 items-end">
              {(data.activeUsers || []).slice(-30).map((entry, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-accent-green to-accent-green/30 rounded-t-sm transition-all hover:opacity-80 cursor-pointer"
                  style={{ height: `${(entry.count / maxActive) * 100}%` }}
                  title={`${entry.date}: ${entry.count} active users`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-text-muted mt-2">
              <span>30 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
