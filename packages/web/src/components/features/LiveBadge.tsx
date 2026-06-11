import { m, useReducedMotion } from 'motion/react';
import { SetStatus } from '@/hooks/useSetStatus';
import { cn } from '@/lib/utils';

// R6: shared pill geometry — 9999px radius, 3px/10px padding, 11px Space Grotesk
// 500, 0.04em uppercase tracking. `rounded-full` = Tailwind's 9999px.
const PILL_BASE =
  'inline-flex items-center rounded-full py-[3px] px-[10px] text-[11px] font-medium uppercase tracking-[0.04em]';

interface LiveBadgeProps {
  status: SetStatus;
  label: string;
  className?: string;
}

export default function LiveBadge({ status, label, className }: LiveBadgeProps) {
  const prefersReducedMotion = useReducedMotion();

  // Live: coral exception — deliberate danger-accent read (AA: coralStrong
  // #c01d3a fill + dark-ink #080810 text, ~6.04:1). The pulsing dot signals
  // the NOW moment at a glance. This is the sole coral-fill exception per the
  // accent rule (live = time-critical alert, not a CTA).
  if (status === 'live') {
    return (
      <div
        className={cn(
          PILL_BASE,
          'gap-1.5 bg-[#c01d3a] text-[#080810] ring-1 ring-accent-coral/60 shadow-[0_0_10px_rgba(var(--accent-coral-rgb),0.45)]',
          className,
        )}
        aria-label="Live"
      >
        {prefersReducedMotion ? (
          <div className="w-1.5 h-1.5 rounded-full bg-[#080810]" aria-hidden="true" />
        ) : (
          <m.div
            className="w-1.5 h-1.5 rounded-full bg-[#080810]"
            aria-hidden="true"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
        <span>{label}</span>
      </div>
    );
  }

  // R6 NOW PLAYING (soon): aqua fill + dark ink (#0a0a0a). Highest contrast (AA).
  if (status === 'soon') {
    return (
      <div className={cn(PILL_BASE, 'gap-1.5 bg-accent-aqua text-[#0a0a0a]', className)} aria-label="Starting soon">
        {prefersReducedMotion ? (
          <div className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" aria-hidden="true" />
        ) : (
          <m.div
            className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]"
            aria-hidden="true"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        <span>{label}</span>
      </div>
    );
  }

  // R6 UP NEXT (upcoming): transparent bg, 1px aqua outline at 40% opacity, aqua text.
  if (status === 'upcoming') {
    return (
      <div className={cn(PILL_BASE, 'border border-[rgba(0,232,208,0.4)] text-accent-aqua', className)}>{label}</div>
    );
  }

  // R6 PAST: neutral surface #3a3a3a, muted text #686868.
  if (status === 'past') {
    return <div className={cn(PILL_BASE, 'bg-[#3a3a3a] text-[#686868]', className)}>{label}</div>;
  }

  // R6 TBA / Later: same neutral treatment as PAST.
  if (status === 'tba') {
    return <div className={cn(PILL_BASE, 'bg-[#3a3a3a] text-[#686868]', className)}>{label}</div>;
  }

  return <div className={cn(PILL_BASE, 'bg-[#3a3a3a] text-[#686868]', className)}>{label}</div>;
}
