import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { Users, Tent, ClipboardList, Music } from 'lucide-react';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

interface DashboardData {
  stats: {
    users: number;
    festivals: number;
    profiles: number;
    picks: number;
  };
  health: {
    uptime: number;
    memory: { rss: number; heapUsed: number; heapTotal: number };
    connections: number;
    onlineRooms: number;
    database?: { totalCount: number; idleCount: number; waitingCount: number };
  };
  recentActivity: Array<{
    id: string;
    action: string;
    actorUsername?: string;
    details?: { targetUsername?: string };
    count?: number;
    createdAt: string;
  }>;
}

/**
 * Admin dashboard overview with stats, health, and recent activity
 */
export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const result = await api.get<DashboardData>('/admin/dashboard');
      setData(result);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't load the dashboard. Try again.", 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-bg-card/30 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted">Dashboard data unavailable</p>
        <button
          onClick={loadDashboard}
          className="mt-4 px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  const { stats, health, recentActivity } = data;

  const formatUptime = (seconds: number): string => {
    const d = Math.floor(seconds / 86400);
    const hr = Math.floor((seconds % 86400) / 3600);
    const mn = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${hr}h ${mn}m`;
    if (hr > 0) return `${hr}h ${mn}m`;
    return `${mn}m`;
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div>
        <h2 className="type-heading text-text-primary mb-4">Statistics</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Users', value: stats.users, icon: <Users />, color: 'text-accent-aqua' },
            { label: 'Festivals', value: stats.festivals, icon: <Tent />, color: 'text-accent-coral' },
            { label: 'Profiles', value: stats.profiles, icon: <ClipboardList />, color: 'text-accent-amber' },
            { label: 'Total Picks', value: stats.picks, icon: <Music />, color: 'text-accent-green' },
          ].map((card) => (
            <div key={card.label} className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
              <div className={cn('mb-2 [&_svg]:w-6 [&_svg]:h-6', card.color)} aria-hidden="true">
                {card.icon}
              </div>
              <div className="text-3xl font-bold text-text-primary">{card.value}</div>
              <div className="text-xs text-text-muted mt-1">{card.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* System Health */}
      <div>
        <h2 className="type-heading text-text-primary mb-4">System Health</h2>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Uptime</div>
              <div className="text-2xl font-bold text-text-primary">{formatUptime(health.uptime)}</div>
            </div>

            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Memory (RSS)</div>
              <div className="text-2xl font-bold text-text-primary">{health.memory.rss} MB</div>
            </div>

            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Heap Usage</div>
              <div className="text-2xl font-bold text-text-primary">
                {health.memory.heapUsed} / {health.memory.heapTotal} MB
              </div>
            </div>

            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">WebSocket Connections</div>
              <div className="text-2xl font-bold text-text-primary">{health.connections}</div>
            </div>

            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Online Rooms</div>
              <div className="text-2xl font-bold text-text-primary">{health.onlineRooms}</div>
            </div>

            {health.database && (
              <div>
                <div className="text-xs text-text-muted uppercase tracking-wide mb-1">DB Pool</div>
                <div className="text-sm text-text-primary font-mono">
                  {health.database.totalCount - health.database.idleCount}A /{health.database.idleCount}I /
                  {health.database.waitingCount}W
                </div>
                <div className="text-xs text-text-muted mt-1">Active / Idle / Waiting</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="type-heading text-text-primary mb-4">Recent Activity</h2>
        {recentActivity.length === 0 ? (
          <p className="text-text-muted text-sm">No recent activity</p>
        ) : (
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
            <div className="divide-y divide-glass-border">
              {recentActivity.slice(0, 15).map((activity, idx) => (
                <div
                  key={idx}
                  className="px-6 py-4 flex items-center justify-between hover:bg-bg-primary/20 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-accent-aqua" />
                    <div>
                      <div className="text-sm font-medium text-text-primary">
                        {activity.action.replace(/[_:]/g, ' ')}
                        {activity.count && activity.count > 1 && (
                          <span className="text-accent-amber ml-2">× {activity.count}</span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-1">
                        {activity.actorUsername || activity.details?.targetUsername || 'system'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-text-muted whitespace-nowrap">{formatTimeAgo(activity.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Refresh button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={loadDashboard}
          className="px-6 py-2 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium border border-accent-aqua/30"
        >
          Refresh Dashboard
        </button>
      </div>
    </div>
  );
}
