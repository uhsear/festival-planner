import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import EmptyState from '../ui/EmptyState';
import Avatar from '../ui/Avatar';
import Skeleton from '../ui/Skeleton';
import { Activity } from 'lucide-react';

// Server shape: rows from crew_activity joined with users. The `type` column is
// a free-form string written by the emitter when events happen — examples seen
// in the codebase: 'member-joined', 'member-left', 'poll-created', 'poll-voted',
// 'pick-set', 'expense-added', 'home-base-updated', 'meeting-point-added'.
interface ActivityItem {
  id: string;
  crew_id: string;
  user_id: string;
  username: string;
  type: string;
  detail: string | null;
  created_at: string;
}

interface Props {
  crewId: string;
}

const TYPE_LABELS: Record<string, string> = {
  'member-joined':       'joined the crew',
  'member-left':         'left the crew',
  'member-kicked':       'was removed',
  'poll-created':        'created a poll',
  'poll-voted':          'voted on a poll',
  'expense-added':       'added an expense',
  'expense-deleted':     'removed an expense',
  'expense-settled':     'settled up',
  'home-base-updated':   'updated the home base',
  'meeting-point-added': 'dropped a meeting point',
  'meeting-point-removed': 'removed a meeting point',
  'crew-updated':        'updated the crew',
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function ActivityTab({ crewId }: Props) {
  const { data: items = [], isLoading, isError } = useQuery<ActivityItem[]>({
    queryKey: ['crew-activity', crewId],
    queryFn: async () => {
      const res = await api.get<ActivityItem[]>(`/crews/${crewId}/activity`);
      return Array.isArray(res) ? res : [];
    },
    enabled: !!crewId,
    refetchInterval: 30_000, // Poll once every 30s so new events appear without socket wiring
  });

  if (isLoading) {
    return <div className="px-4 space-y-2"><Skeleton variant="text" /><Skeleton variant="text" /><Skeleton variant="text" /></div>;
  }
  if (isError) {
    return <div className="px-4"><EmptyState icon={<Activity className="w-12 h-12" />} title="Couldn't load activity" description="Try again later." /></div>;
  }
  if (items.length === 0) {
    return <div className="px-4"><EmptyState icon={<Activity className="w-12 h-12" />} title="No activity yet" description="Crew events will appear here as they happen." /></div>;
  }

  return (
    <div className="space-y-2 px-4">
      {items.map((it) => {
        const verb = TYPE_LABELS[it.type] || it.type.replace(/-/g, ' ');
        return (
          <div key={it.id} className="crew-activity-item crew-list-enter p-3 rounded-lg bg-bg-card border border-border flex items-start gap-3">
            <Avatar name={it.username || 'User'} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary">
                <span className="font-semibold">{it.username}</span>{' '}
                <span className="text-text-secondary">{verb}</span>
                {it.detail && <span className="text-text-secondary">: {it.detail}</span>}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{timeAgo(it.created_at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
