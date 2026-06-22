import React from 'react';
import { Loader } from 'lucide-react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'primary' | 'danger' | 'ghost' | 'secondary' | 'outline' | 'util' | 'delete';

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
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[color,background-color,border-color,box-shadow,transform,outline-color] duration-200 ease-out cursor-pointer active:scale-[0.97] active:brightness-95 motion-reduce:transform-none disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2';

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      'bg-accent-aqua text-bg-primary hover:bg-[var(--color-accent-aqua-hover)] focus-visible:outline-accent-aqua',
    // DANGER/SOS only. Filled with the deepened coral so WHITE label text clears
    // WCAG AA (white on brand #ff3366 fails). Primary actions use aqua, not coral.
    danger:
      'bg-accent-coral-strong text-text-on-accent hover:bg-[var(--color-accent-coral-strong-hover)] focus-visible:outline-accent-coral',
    ghost:
      'bg-transparent text-text-primary border border-color-border hover:bg-bg-card focus-visible:outline-text-primary',
    secondary: 'bg-bg-card text-text-primary hover:bg-bg-card-hover focus-visible:outline-accent-aqua',
    // R3 outline-secondary: the canonical demoted CTA — transparent fill, 1px
    // aqua/40 border, muted text; hover lifts border to aqua/70 + text to primary.
    // Single solid aqua per screen lives on `primary`; this is everything else.
    outline:
      'bg-transparent text-text-muted border border-accent-aqua/40 hover:border-accent-aqua/70 hover:text-text-primary focus-visible:outline-accent-aqua',
    util: 'bg-[var(--color-overlay-2)] text-text-secondary border border-color-border text-[11px] font-semibold tracking-wide hover:border-accent-aqua hover:text-text-primary hover:bg-[var(--color-overlay-4)] focus-visible:outline-accent-aqua [&_svg]:w-[11px] [&_svg]:h-[11px]',
    delete:
      'w-11 h-11 min-w-11 min-h-11 rounded-full bg-transparent text-accent-coral border border-transparent hover:bg-accent-coral/10 hover:border-accent-coral focus-visible:outline-accent-coral',
  };

  const sizeStyles: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm min-h-11',
    md: 'px-4 py-2 text-base min-h-11',
    lg: 'px-5 py-2.5 text-lg min-h-11',
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
      className={cn(baseStyles, variantStyles[variant], appliedSize, fullWidth && 'w-full', className)}
    >
      {isLoading && <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {!isLoading && icon}
      {children}
    </button>
  );
}
