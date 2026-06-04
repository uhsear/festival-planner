import React from 'react';
import Button from './Button';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({ icon, title, description, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        // Vertical padding scales with viewport so the empty state stays
        // proportionate in tight panels (crew/picks) and roomy on desktop.
        // className can still override (e.g. festival-mode's compact slot).
        'flex flex-col items-center justify-start gap-3 py-4 sm:py-6 px-6 text-center',
        className,
      )}
    >
      {icon && <div className="text-text-muted opacity-70 [&_svg]:w-12 [&_svg]:h-12">{icon}</div>}

      <h3 className="type-title font-semibold text-text-primary">{title}</h3>

      {description && <p className="text-sm text-text-secondary max-w-xs">{description}</p>}

      {cta && (
        <Button variant="primary" size="md" onClick={cta.onClick}>
          {cta.label}
        </Button>
      )}
    </div>
  );
}
