import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------------------
 * Variant & padding maps
 * -------------------------------------------------------------------------*/

const variantStyles = {
  default:
    'bg-bg-card border border-border rounded-xl transition-[transform,box-shadow] duration-200',
  elevated:
    'bg-bg-card border border-border rounded-xl glass-xs backdrop-blur-sm shadow-lg transition-[transform,box-shadow] duration-200',
  interactive:
    'bg-bg-card border border-border rounded-xl cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:bg-bg-card-hover active:scale-[0.97] motion-reduce:transition-none motion-reduce:transform-none',
  flush:
    'bg-bg-card border border-border rounded-xl transition-[transform,box-shadow] duration-200',
} as const;

const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

/* ---------------------------------------------------------------------------
 * Card root
 * -------------------------------------------------------------------------*/

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variantStyles;
  padding?: keyof typeof paddingStyles;
}

const CardRoot = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', padding = 'md', className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(variantStyles[variant], paddingStyles[padding], className)}
      {...props}
    />
  ),
);
CardRoot.displayName = 'Card';

/* ---------------------------------------------------------------------------
 * Compound sub-components
 * -------------------------------------------------------------------------*/

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

const Header = forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-3 mb-3 pb-3 border-b border-border-light',
        className,
      )}
      {...props}
    />
  ),
);
Header.displayName = 'Card.Header';

const Body = forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex-1', className)} {...props} />
  ),
);
Body.displayName = 'Card.Body';

const Footer = forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-3 mt-3 pt-3 border-t border-border-light',
        className,
      )}
      {...props}
    />
  ),
);
Footer.displayName = 'Card.Footer';

/* ---------------------------------------------------------------------------
 * Compose & export
 * -------------------------------------------------------------------------*/

export const Card = Object.assign(CardRoot, {
  Header,
  Body,
  Footer,
});
