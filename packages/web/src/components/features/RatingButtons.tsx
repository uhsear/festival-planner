import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared/services';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import { RATING_META, RATING_SCALE } from '../../lib/ratingIcon';
import { cn } from '../../lib/utils';

const RATINGS = RATING_SCALE.map((n) => ({ n, ...RATING_META[n]! }));

interface Rating {
  setId: string;
  rating: number;
  note?: string | null;
}

interface Props {
  setId: string;
  festivalId: string;
  /** Compact (smaller buttons) for use inside set cards; default full-size. */
  compact?: boolean;
}

export default function RatingButtons({ setId, festivalId, compact = false }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { select } = useHaptics();
  const [busy, setBusy] = useState(false);

  const { data: ratings = [] } = useQuery<Rating[]>({
    queryKey: ['ratings', festivalId],
    queryFn: async () => {
      const res = await api.get<{ ratings: Rating[] }>(`/ratings/festival/${festivalId}`);
      return Array.isArray(res) ? res : res?.ratings || [];
    },
    enabled: !!festivalId,
    staleTime: 60_000,
  });

  const current = ratings.find((r) => r.setId === setId)?.rating ?? null;

  // Offline-aware rate + remove. If navigator.onLine === false AND the
  // AppShell's offline queue bridge is ready, enqueue with a deterministic
  // clientId so toggling the same rating several times offline collapses to
  // one replayed call. TanStack Query's optimistic cache update still
  // applies instantly either way.
  const rate = useMutation({
    mutationFn: async ({ rating, note }: { rating: number; note?: string }) => {
      const body = { rating, ...(note !== undefined ? { note } : {}) };
      const bridge = window.__festieQueue;
      if (!navigator.onLine && bridge?.queueMutation) {
        return bridge.queueMutation({
          type: 'api',
          clientId: `rate-${setId}`,
          url: `/ratings/${setId}`,
          method: 'POST',
          body,
        });
      }
      return api.post(`/ratings/${setId}`, body);
    },
    onMutate: async ({ rating }) => {
      // Optimistic: update the ratings query cache so the UI responds instantly.
      await qc.cancelQueries({ queryKey: ['ratings', festivalId] });
      const prev = qc.getQueryData<Rating[]>(['ratings', festivalId]) || [];
      const next = [...prev.filter((r) => r.setId !== setId), { setId, rating, note: null }];
      qc.setQueryData(['ratings', festivalId], next);
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['ratings', festivalId], ctx.prev);
      toast(e instanceof Error ? e.message : "Couldn't save your rating. Try again.", 'error');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', festivalId] }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const bridge = window.__festieQueue;
      if (!navigator.onLine && bridge?.queueMutation) {
        return bridge.queueMutation({
          type: 'api',
          clientId: `rate-${setId}`,
          url: `/ratings/${setId}`,
          method: 'DELETE',
        });
      }
      return api.delete(`/ratings/${setId}`);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['ratings', festivalId] });
      const prev = qc.getQueryData<Rating[]>(['ratings', festivalId]) || [];
      qc.setQueryData(
        ['ratings', festivalId],
        prev.filter((r) => r.setId !== setId),
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['ratings', festivalId], ctx.prev);
      toast(e instanceof Error ? e.message : "Couldn't remove your rating. Try again.", 'error');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratings', festivalId] }),
  });

  const handleClick = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      select();
      if (current === n) {
        await remove.mutateAsync();
      } else {
        await rate.mutateAsync({ rating: n });
      }
    } finally {
      setBusy(false);
    }
  };

  const iconSize = compact ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div
      className={cn('flex items-center justify-center gap-1', compact && 'scale-90 origin-left')}
      role="radiogroup"
      aria-label="Rate this set"
    >
      {RATINGS.map((r) => {
        const active = current === r.n;
        return (
          <button
            key={r.n}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${r.label} (${r.n}/5)`}
            title={r.label}
            disabled={busy}
            onClick={() => handleClick(r.n)}
            className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center transition-[background-color,box-shadow,transform]',
              active
                ? 'bg-accent-amber/25 scale-110 shadow-[0_0_12px_theme(colors.accent-amber/40)] ring-2 ring-accent-amber/60 text-accent-amber'
                : 'bg-bg-card/60 border border-border hover:border-border-light text-text-secondary',
            )}
          >
            <r.Icon className={iconSize} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
