import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { timeAgo } from '@festie/shared/utils';
import { CREW_ACTIVITY_LABELS } from '@festie/shared/constants';
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

export default function ActivityTab({ crewId }: Props) {
  const {
    data: items = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<ActivityItem[]>({
    queryKey: ['crew-activity', crewId],
    queryFn: async () => {
      const res = await api.get<ActivityItem[]>(`/crews/${crewId}/activity`);
      return Array.isArray(res) ? res : [];
    },
    enabled: !!crewId,
    refetchInterval: 30_000, // Poll once every 30s so new events appear without socket wiring
  });

  if (isLoading) {
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="text" />
        <Skeleton variant="text" />
        <Skeleton variant="text" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<Activity className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load activity"
          description="Something went wrong loading crew activity."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<Activity className="w-12 h-12" aria-hidden="true" />}
          title="No activity yet"
          description="Crew events will appear here as they happen."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4">
      {items.map((it, idx) => {
        const verb = CREW_ACTIVITY_LABELS[it.type] || it.type.replace(/-/g, ' ');
        return (
          <div
            key={it.id}
            className="crew-activity-rail stagger-item p-3 rounded-lg bg-bg-card border border-border flex items-start gap-3 animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
            style={{ '--i': Math.min(idx, 20) } as React.CSSProperties}
          >
            <Avatar name={it.username || 'User'} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary">
                <span className="font-semibold">{it.username}</span> <span className="text-text-secondary">{verb}</span>
                {it.detail && <span className="text-text-secondary">: {it.detail}</span>}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{timeAgo(new Date(it.created_at).getTime())}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
