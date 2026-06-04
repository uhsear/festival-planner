import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps {
  variant?: 'must' | 'want' | 'maybe' | 'online' | 'offline' | 'count' | 'outline';
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function Badge({ variant = 'count', children, className, style }: BadgeProps) {
  // Mobile tint-ring pills: borderless coral/aqua/amber tints. Status variants
  // adopt the `micro` caps role; `count` stays slightly larger; `outline` keeps
  // its hairline border for low-contrast contexts.
  // The caps tracking on micro text crowds the pill, so status variants get
  // slightly roomier padding than the tighter count/outline pills.
  const statusType = 'uppercase tracking-[0.08em] font-semibold px-2.5 py-1.5';
  const variantStyles = {
    must: cn('bg-accent-coral/20 text-accent-coral', statusType),
    want: cn('bg-accent-aqua/20 text-accent-aqua', statusType),
    maybe: cn('bg-accent-amber/20 text-accent-amber', statusType),
    online: cn('bg-accent-green/20 text-accent-green', statusType),
    offline: cn('bg-text-muted/20 text-text-muted', statusType),
    count: 'bg-accent-coral/20 text-accent-coral px-2 py-1',
    outline: 'bg-transparent text-text-secondary border border-border px-2 py-1',
  };

  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center gap-1 rounded-full text-xs font-medium',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
