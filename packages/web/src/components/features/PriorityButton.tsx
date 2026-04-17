import React from 'react';
import { Priority } from '@festie/shared/types';
import { cn } from '@/lib/utils';

interface PriorityButtonProps {
  priority: Priority | null;
  onChange: (priority: Priority | null) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

const PRIORITY_CONFIG: Record<Priority | 'none', { icon: string; label: string; color: string }> = {
  must: { icon: '★', label: 'Must See', color: 'text-accent-coral' },
  'want-to-see': { icon: '◆', label: 'Want to See', color: 'text-accent-aqua' },
  maybe: { icon: '●', label: 'Maybe', color: 'text-accent-amber' },
  none: { icon: '✕', label: 'Clear', color: 'text-text-muted' },
};

export default function PriorityButton({ priority, onChange, size = 'md', disabled = false }: PriorityButtonProps) {
  const options: (Priority | null)[] = ['must', 'want-to-see', 'maybe', null];
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs gap-1',
    md: 'px-3 py-2 text-sm gap-2',
    lg: 'px-4 py-3 text-base gap-3',
  };
  const iconSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl',
  };

  return (
    <div className="flex gap-2">
      {options.map((opt) => {
        const config = PRIORITY_CONFIG[opt ?? 'none'];
        const isActive = priority === opt;

        return (
          <button
            key={opt ?? 'none'}
            onClick={() => onChange(isActive ? null : opt)}
            disabled={disabled}
            className={cn(
              'flex items-center gap-1 rounded-lg font-semibold transition-all',
              sizeClasses[size],
              isActive
                ? 'bg-glass border border-border-light ' + config.color
                : 'bg-bg-card border border-border text-text-secondary hover:border-border-light disabled:opacity-50',
            )}
            aria-pressed={isActive}
            title={config.label}
          >
            <span className={iconSizes[size]}>{config.icon}</span>
            <span className="hidden sm:inline">{config.label}</span>
          </button>
        );
      })}
    </div>
  );
}
