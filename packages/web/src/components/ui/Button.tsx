import React from 'react';
import { Loader } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'ghost' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  disabled = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'btn font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2';

  const variantStyles = {
    primary: 'bg-accent-aqua text-bg-primary hover:opacity-80 focus-visible:outline-accent-aqua',
    danger: 'bg-accent-coral text-bg-primary hover:opacity-80 focus-visible:outline-accent-coral',
    ghost: 'bg-transparent text-text-primary border border-color-border hover:bg-bg-card focus-visible:outline-text-primary',
    secondary: 'bg-bg-card text-text-primary hover:bg-bg-card-hover focus-visible:outline-accent-aqua',
    outline: 'bg-transparent text-text-primary border border-border hover:border-border-light focus-visible:outline-accent-aqua',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm min-h-11',
    md: 'px-4 py-2 text-base min-h-11',
    lg: 'px-6 py-3 text-lg min-h-11',
  };

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className
      )}
    >
      <div className="flex items-center justify-center gap-2">
        {isLoading && <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />}
        {children}
      </div>
    </button>
  );
}
