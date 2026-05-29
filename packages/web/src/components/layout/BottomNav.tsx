import React, { useMemo } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { isFestivalOver } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

interface NavTab {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Trigger to warm this tab's lazy chunk before the user taps. */
  prefetch?: () => Promise<unknown>;
}

// Per-tab chunk prefetchers. Called from onPointerDown so the tap-up navigation
// happens with the chunk already loaded — no chunk-load pause that made the
// first scroll after tab switch feel laggy.
const prefetchers: Record<string, () => Promise<unknown>> = {
  '/cards':    () => import('../../routes/cards'),
  '/timeline': () => import('../../routes/timeline'),
  '/grid':     () => import('../../routes/grid'),
  '/picks':    () => import('../../routes/picks'),
  '/crew':     () => import('../../routes/crew'),
  '/wrap':     () => import('../../routes/wrap'),
  '/account':  () => import('../../routes/account'),
};

/** Schedule icon — matches legacy createSvgIcon('cards') */
const ScheduleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

/** Timeline icon — matches legacy createSvgIcon('timeline') */
const TimelineIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 6h16" />
    <path d="M4 12h10" />
    <path d="M4 18h14" />
  </svg>
);

/** Grid icon — matches legacy createSvgIcon('grid') */
const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="5" height="5" />
    <rect x="10" y="3" width="5" height="5" />
    <rect x="17" y="3" width="5" height="5" />
    <rect x="3" y="10" width="5" height="5" />
    <rect x="10" y="10" width="5" height="5" />
    <rect x="17" y="10" width="5" height="5" />
    <rect x="3" y="17" width="5" height="5" />
    <rect x="10" y="17" width="5" height="5" />
    <rect x="17" y="17" width="5" height="5" />
  </svg>
);

/** Picks icon — star */
const PicksIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

/** Crew icon — people */
const CrewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

/** Profile icon — user silhouette. Mobile needs a direct entry to /account
   because the header profile badge can get clipped off-screen at 390 px when
   the util-strip (Install App + Support Me) hogs .header-left width. */
const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

/** Wrap icon — sparkles (shown only after the festival ends) */
const WrapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 3l2.09 5.26L19 9.27l-4 3.87L15.82 19 12 16.77 8.18 19 9 13.14l-4-3.87 4.91-1.01L12 3z" />
    <path d="M5 3l1 2M19 3l-1 2M5 21l1-2M19 21l-1-2" strokeLinecap="round" />
  </svg>
);

const baseTabs: NavTab[] = [
  { label: 'Schedule', href: '/cards', icon: <ScheduleIcon /> },
  { label: 'Timeline', href: '/timeline', icon: <TimelineIcon /> },
  { label: 'Grid', href: '/grid', icon: <GridIcon /> },
];

const authTabs: NavTab[] = [
  { label: 'My Picks', href: '/picks', icon: <PicksIcon /> },
  { label: 'Crew', href: '/crew', icon: <CrewIcon /> },
  { label: 'Me', href: '/account', icon: <ProfileIcon /> },
];

const wrapTab: NavTab = { label: 'Wrap', href: '/wrap', icon: <WrapIcon /> };

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);

  // Show picks/crew tabs when user is logged in. Show Wrap tab ONLY after
  // the festival has ended — otherwise it's noise. Empty-state inside /wrap
  // handles the "coming soon" case for a direct URL visit before then.
  const tabs = useMemo(() => {
    if (!user) return baseTabs;
    const wrapUnlocked = isFestivalOver(currentFestival, days);
    return wrapUnlocked ? [...baseTabs, ...authTabs, wrapTab] : [...baseTabs, ...authTabs];
  }, [user, currentFestival, days]);

  const isActive = (href: string) => {
    if (href === '/cards') return location.pathname === '/' || location.pathname === '/cards';
    return location.pathname === href;
  };

  return (
    <footer
      className={cn(
        'hidden max-md:block flex-shrink-0',
        'bg-[var(--color-bg-chrome)] backdrop-saturate-[180%] backdrop-blur-[20px]',
        'border-t border-border',
        '[padding:6px_0_max(8px,env(safe-area-inset-bottom))]',
        '[padding-left:env(safe-area-inset-left)]',
        '[padding-right:env(safe-area-inset-right)]',
        'shadow-[0_-1px_0_var(--color-overlay-1),0_-4px_16px_var(--color-shade-6)]',
        'print:hidden',
      )}
      data-bottom-nav
    >
      <div
        className="flex justify-around w-full max-md:gap-0.5"
        role="tablist"
        aria-label="Mobile navigation"
      >
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <button
              key={tab.href}
              role="tab"
              aria-selected={active}
              aria-controls="main-content"
              tabIndex={active ? 0 : -1}
              aria-label={`View ${tab.label}`}
              className={cn(
                'flex flex-col items-center gap-[3px] px-3 py-2',
                'bg-transparent text-text-muted text-[11px] font-semibold',
                'rounded-sm min-h-11 min-w-0 flex-1 overflow-hidden',
                'transition-[color,transform] duration-150 ease-[ease]',
                'active:scale-90 motion-reduce:active:!transform-none',
                '[&_svg]:w-[22px] [&_svg]:h-[22px]',
                'max-[480px]:px-[2px] max-[480px]:py-1.5 max-[480px]:text-[10px] max-[480px]:gap-1',
                'max-[480px]:[&_svg]:w-5 max-[480px]:[&_svg]:h-5',
                'max-[375px]:min-h-11 max-[375px]:px-1 max-[375px]:py-[5px]',
                'max-[359px]:justify-center max-[359px]:px-0 max-[359px]:py-1.5',
                active && [
                  'text-accent-aqua',
                  '[&_svg]:drop-shadow-[0_0_6px_rgba(0,232,208,0.4)]',
                ],
              )}
              onPointerEnter={() => prefetchers[tab.href]?.().catch(() => {})}
              onPointerDown={() => prefetchers[tab.href]?.().catch(() => {})}
              onClick={() => navigate({ to: tab.href })}
            >
              {tab.icon}
              <span className={cn(
                'max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
                'max-[359px]:hidden',
              )}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}
