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
        // R21: Container with dot-grid background and flex centering.
        // Vertical padding scales with viewport so the empty state stays
        // proportionate in tight panels (crew/picks) and roomy on desktop.
        // className can still override (e.g. festival-mode's compact slot).
        'empty-state flex flex-col items-center justify-center gap-4 py-4 sm:py-6 px-6 text-center min-h-[200px]',
        className,
      )}
    >
      <div className="empty-state-content flex flex-col items-center gap-4 w-full">
        {icon && (
          <div className="empty-state-icon flex justify-center">
            <div className="text-text-muted [&_svg]:w-12 [&_svg]:h-12">{icon}</div>
          </div>
        )}

        <h3 className="empty-state-title type-title font-semibold text-text-primary">{title}</h3>

        {description && (
          <p className="empty-state-description text-sm text-text-secondary max-w-[280px]">{description}</p>
        )}

        {cta && (
          <Button className="empty-state-cta" variant="primary" size="md" onClick={cta.onClick}>
            {cta.label}
          </Button>
        )}
      </div>
    </div>
  );
}
