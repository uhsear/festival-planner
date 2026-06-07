import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/utils';

interface AuthTabsProps {
  /** Which auth screen is active — its segment renders as a non-navigating current tab. */
  active: 'login' | 'register';
  /**
   * Visual treatment. `pill` = the rounded segmented control used on /login;
   * `split` = the bordered two-half control used on /register. Both are kept
   * deliberately (the design roadmap calls out "login pill vs register split")
   * — this component is the single source so they can't drift again.
   */
  variant: 'pill' | 'split';
}

const TABS = [
  { key: 'login', label: 'Sign in', to: '/login' },
  { key: 'register', label: 'Create Account', to: '/register' },
] as const;

/**
 * Shared auth-method tab strip for the login/register screens. Replaces the two
 * near-identical hand-rolled tab blocks. The active segment is a current-page
 * button; the inactive one is a router Link so the auth method swaps in one hop.
 */
export default function AuthTabs({ active, variant }: AuthTabsProps) {
  const container =
    variant === 'pill'
      ? 'flex gap-1 p-1 mb-6 bg-bg-secondary rounded-full w-full max-w-[360px] relative z-[1]'
      : 'flex mb-6 border border-border-light rounded-DEFAULT overflow-hidden w-full max-w-[360px] relative z-[1]';

  const segBase =
    variant === 'pill'
      ? 'flex-1 py-2 px-3 min-h-11 rounded-full text-sm font-semibold text-center inline-flex items-center justify-center'
      : 'flex-1 py-[var(--space-6)] min-h-11 text-sm text-center inline-flex items-center justify-center';

  const activeSeg = cn(
    'bg-accent-aqua text-[var(--text-on-light-accent)] font-bold cursor-default',
    'transition-[background,color,transform] duration-200 ease-[var(--ease-out)]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
  );

  const inactiveSeg = cn(
    variant === 'pill' ? 'bg-transparent' : 'bg-[var(--color-bg-card)]',
    'text-text-secondary hover:text-text-primary cursor-pointer',
    'transition-[background,color,transform] duration-200 ease-[var(--ease-out)]',
    'active:scale-[0.97] motion-reduce:transform-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
  );

  return (
    <div className={container} role="tablist" aria-label="Authentication method">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        if (isActive) {
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={true}
              tabIndex={0}
              className={cn(segBase, activeSeg)}
            >
              {tab.label}
            </button>
          );
        }
        return (
          <Link
            key={tab.key}
            to={tab.to}
            role="tab"
            aria-selected={false}
            tabIndex={-1}
            className={cn(segBase, inactiveSeg)}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
