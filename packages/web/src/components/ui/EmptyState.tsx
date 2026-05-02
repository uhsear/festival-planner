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

export default function EmptyState({
  icon,
  title,
  description,
  cta,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-start py-6 px-4 text-center',
      className
    )}>
      {icon && (
        <div className="mb-2 text-text-muted opacity-50">
          {icon}
        </div>
      )}

      <h3 className="text-lg font-semibold text-text-primary mb-2">
        {title}
      </h3>

      {description && (
        <p className="text-sm text-text-muted max-w-xs mb-4">
          {description}
        </p>
      )}

      {cta && (
        <Button
          variant="primary"
          size="md"
          onClick={cta.onClick}
        >
          {cta.label}
        </Button>
      )}
    </div>
  );
}
