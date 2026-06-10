import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/utils';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** lucide-react icon (or any ReactNode). Rendered inside a square touch target. */
  icon: ReactNode;
  /** Required — maps to aria-label. Falls back to title for tooltip. */
  label: string;
  /** default: muted → primary on hover; danger: muted → coral on hover; ghost: same as default, slightly lighter baseline. */
  variant?: 'default' | 'ghost' | 'danger';
  /** md = 44×44 (WCAG 2.5.5 AAA); sm = 44×44 (WCAG AA minimum). */
  size?: 'sm' | 'md';
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Icon-only square tap target. Enforces WCAG 2.5.5 touch target size +
 * aria-label requirement. Replaces the 10 hand-rolled
 * `min-h-11 min-w-11 flex items-center justify-center` button instances
 * that were scattered across the app.
 */
function IconButton({
  icon,
  label,
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const sizeClass = size === 'sm' ? 'min-h-11 min-w-11' : 'min-h-11 min-w-11';
  const variantClass =
    variant === 'danger' ? 'text-text-muted hover:text-accent-coral' : 'text-text-muted hover:text-text-primary';

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
        sizeClass,
        variantClass,
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}

export default IconButton;
