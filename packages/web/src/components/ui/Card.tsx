import { type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------------------
 * Variant & padding maps
 * -------------------------------------------------------------------------*/

const variantStyles = {
  default: 'bg-bg-card border border-border rounded-xl transition-[transform,box-shadow] duration-200',
  elevated:
    'bg-bg-card border border-border rounded-xl glass-xs backdrop-blur-sm shadow-lg transition-[transform,box-shadow] duration-200',
  interactive:
    'bg-bg-card border border-border rounded-xl cursor-pointer transition-[transform,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-bg-card-hover active:scale-[0.97] motion-reduce:transition-none motion-reduce:transform-none',
  flush: 'bg-bg-card border border-border rounded-xl transition-[transform,box-shadow] duration-200',
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
  ref?: Ref<HTMLDivElement>;
}

function CardRoot({ variant = 'default', padding = 'md', className, ref, ...props }: CardProps) {
  return <div ref={ref} className={cn(variantStyles[variant], paddingStyles[padding], className)} {...props} />;
}

/* ---------------------------------------------------------------------------
 * Compound sub-components
 * -------------------------------------------------------------------------*/

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

function Header({ className, ref, ...props }: CardSectionProps) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 mb-3 pb-3 border-b border-border-light', className)}
      {...props}
    />
  );
}

function Body({ className, ref, ...props }: CardSectionProps) {
  return <div ref={ref} className={cn('flex-1', className)} {...props} />;
}

function Footer({ className, ref, ...props }: CardSectionProps) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 mt-3 pt-3 border-t border-border-light', className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------------------
 * Compose & export
 * -------------------------------------------------------------------------*/

export const Card = Object.assign(CardRoot, {
  Header,
  Body,
  Footer,
});
