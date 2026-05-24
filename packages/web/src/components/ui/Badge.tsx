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
    must: 'bg-accent-coral/20 text-accent-coral border border-accent-coral/30',
    want: 'bg-accent-aqua/20 text-accent-aqua border border-accent-aqua/30',
    maybe: 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30',
    online: 'bg-accent-green/20 text-accent-green border border-accent-green/30',
    offline: 'bg-text-muted/20 text-text-muted border border-text-muted/30',
    count: 'bg-accent-coral/20 text-accent-coral border border-accent-coral/30',
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
