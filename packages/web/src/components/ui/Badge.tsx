import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps {
  variant?: 'must' | 'want' | 'maybe' | 'online' | 'offline' | 'count' | 'outline';
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export default function Badge({
  variant = 'count',
  children,
  className,
  style,
}: BadgeProps) {
  const variantStyles = {
    must: 'badge-must',
    want: 'badge-want',
    maybe: 'badge-maybe',
    online: 'bg-accent-green bg-opacity-20 text-accent-green border border-accent-green border-opacity-30',
    offline: 'bg-text-muted bg-opacity-20 text-text-muted border border-text-muted border-opacity-30',
    count: 'bg-accent-coral bg-opacity-20 text-accent-coral border border-accent-coral border-opacity-30',
    outline: 'bg-transparent text-text-secondary border border-border',
  };

  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
