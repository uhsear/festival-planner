import { m, useReducedMotion } from 'motion/react';
import { SetStatus } from '@/hooks/useSetStatus';
import { cn } from '@/lib/utils';

interface LiveBadgeProps {
  status: SetStatus;
  label: string;
  className?: string;
}

export default function LiveBadge({ status, label, className }: LiveBadgeProps) {
  const prefersReducedMotion = useReducedMotion();

  // Live: Pulsing coral dot + "LIVE" text. Highest-contrast badge in the set
  // (solid coral fill, white label) so the NOW moment reads at a glance.
  if (status === 'live') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1 rounded-full',
          'bg-accent-coral ring-1 ring-accent-coral/60 shadow-[0_0_10px_rgba(var(--accent-coral-rgb),0.45)]',
          className,
        )}
        aria-label="Live"
      >
        {prefersReducedMotion ? (
          <div className="w-2 h-2 rounded-full bg-white" aria-hidden="true" />
        ) : (
          <m.div
            className="w-2 h-2 rounded-full bg-white"
            aria-hidden="true"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
        <span className="text-xs font-extrabold uppercase tracking-[0.06em] text-white">{label}</span>
      </div>
    );
  }

  // Soon: Amber animated dot + "In Xm" text
  if (status === 'soon') {
    return (
      <div className={cn('inline-flex items-center gap-2 px-3 py-1 rounded-full', 'bg-accent-amber/20', className)} aria-label="Starting soon">
        {prefersReducedMotion ? (
          <div className="w-2 h-2 rounded-full bg-accent-amber" aria-hidden="true" />
        ) : (
          <m.div
            className="w-2 h-2 rounded-full bg-accent-amber"
            aria-hidden="true"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        <span className="text-xs font-semibold text-accent-amber">{label}</span>
      </div>
    );
  }

  // Upcoming: Aqua text, no dot, just the time label
  if (status === 'upcoming') {
    return (
      <div className={cn('inline-flex items-center px-3 py-1 rounded-full', 'bg-accent-aqua/10', className)}>
        <span className="text-xs font-semibold text-accent-aqua">{label}</span>
      </div>
    );
  }

  // Past: Muted text "Ended", slightly dimmed
  if (status === 'past') {
    return (
      <div
        className={cn(
          'inline-flex items-center px-3 py-1 rounded-full',
          'bg-text-muted/10 opacity-60',
          className
        )}
      >
        <span className="text-xs font-medium text-text-muted">{label}</span>
      </div>
    );
  }

  // TBA: Muted text "TBA"
  if (status === 'tba') {
    return (
      <div className={cn('inline-flex items-center px-3 py-1 rounded-full', 'bg-text-muted/10', className)}>
        <span className="text-xs font-medium text-text-muted">{label}</span>
      </div>
    );
  }

  // Later: Grey/neutral appearance
  return (
    <div className={cn('inline-flex items-center px-3 py-1 rounded-full', 'bg-text-muted/10', className)}>
      <span className="text-xs font-medium text-text-secondary">{label}</span>
    </div>
  );
}
