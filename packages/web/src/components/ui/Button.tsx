import React from 'react';
import { Loader } from 'lucide-react';
import { cn } from '../../lib/utils';

type ButtonVariant =
  | 'primary'
  | 'danger'
  | 'ghost'
  | 'secondary'
  | 'outline'
  | 'util'
  | 'delete';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  disabled = false,
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2';

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      'bg-accent-aqua text-bg-primary hover:opacity-80 focus-visible:outline-accent-aqua',
    danger:
      'bg-accent-coral text-bg-primary hover:opacity-80 focus-visible:outline-accent-coral',
    ghost:
      'bg-transparent text-text-primary border border-color-border hover:bg-bg-card focus-visible:outline-text-primary',
    secondary:
      'bg-bg-card text-text-primary hover:bg-bg-card-hover focus-visible:outline-accent-aqua',
    outline:
      'bg-transparent text-text-primary border border-border hover:border-border-light focus-visible:outline-accent-aqua',
    util:
      'bg-[var(--color-overlay-2)] text-text-secondary border border-color-border text-[11px] font-semibold tracking-wide hover:border-accent-aqua hover:text-text-primary hover:bg-[var(--color-overlay-4)] focus-visible:outline-accent-aqua [&_svg]:w-[11px] [&_svg]:h-[11px]',
    delete:
      'w-11 h-11 min-w-11 min-h-11 rounded-full bg-transparent text-accent-coral border border-transparent hover:bg-accent-coral/10 hover:border-accent-coral focus-visible:outline-accent-coral',
  };

  const sizeStyles: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm min-h-11',
    md: 'px-4 py-2 text-base min-h-11',
    lg: 'px-6 py-3 text-lg min-h-11',
  };

  // util and delete variants have their own sizing — skip the size map
  const appliedSize =
    variant === 'util'
      ? 'px-2.5 py-1.5 min-h-11 min-w-11'
      : variant === 'delete'
        ? '' // sizing baked into variant
        : sizeStyles[size];

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        baseStyles,
        variantStyles[variant],
        appliedSize,
        fullWidth && 'w-full',
        className,
      )}
    >
      {isLoading && <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {!isLoading && icon}
      {children}
    </button>
  );
}
