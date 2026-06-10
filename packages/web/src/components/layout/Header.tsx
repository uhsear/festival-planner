import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { cn } from '@/lib/utils';
import UserMenu from './UserMenu';
import FestivalModeToggle from '../features/FestivalModeToggle';
import Button from '../ui/Button';

export default function Header() {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();

  // Desktop nav tabs — show picks/crew when logged in. Those views render
  // their own empty state if the user hasn't joined the festival yet.
  // Gating on user (instead of currentProfile) avoids races where the tabs
  // disappear on reload before profiles have finished loading.
  // Schedule/Timeline/Grid collapse into one "Schedule" tab; the in-page
  // ScheduleViewSwitcher (rendered by AppShell) swaps between the three views.
  const desktopTabs = useMemo(() => {
    const base = [{ label: 'Schedule', href: '/cards' }];
    if (user) {
      base.push({ label: 'My Picks', href: '/picks' }, { label: 'Crew', href: '/crew' });
    }
    return base;
  }, [user]);

  const scheduleHrefs = ['/', '/cards', '/timeline', '/grid'];
  const isTabActive = (href: string) => {
    if (href === '/cards') return scheduleHrefs.includes(location.pathname);
    return location.pathname === href;
  };

  // Dark-theme-only: the app always renders in the default dark palette. Strip
  // any stale `data-theme` left on the root by a previous (now-removed) light/
  // daylight preference, clear the persisted key, and pin the PWA chrome color
  // to the dark canvas so a saved preference can never produce a light render.
  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.removeItem('fp-theme');
    } catch {
      /* storage may be unavailable in some sandboxes */
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#080810');
  }, []);

  // Connection status — simplified for React rewrite
  const [connected] = useState(true);

  // Capture the `beforeinstallprompt` event so the Install App button can
  // actually trigger the PWA install flow. Browsers fire this once when
  // the PWA is installable; we stash it on window for the click handler.
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      window.__festieInstallPrompt = e as BeforeInstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return (
    <header
      className={cn(
        'flex items-center justify-between shrink-0',
        'bg-[var(--color-bg-chrome)] backdrop-saturate-[180%] backdrop-blur-[var(--glass-blur-strong)]',
        'border-b border-border',
        'shadow-[0_1px_0_var(--color-overlay-1),0_4px_16px_var(--color-shade-7)]',
        'z-dropdown',
        /* safe-area + responsive padding */
        '[padding:14px_24px]',
        '[padding-top:max(14px,env(safe-area-inset-top))]',
        '[padding-left:max(24px,env(safe-area-inset-left))]',
        '[padding-right:max(24px,env(safe-area-inset-right))]',
        /* mobile: tighter padding + gap + scroll-collapse transitions */
        'max-md:![padding:8px_12px] max-md:![padding-top:max(8px,env(safe-area-inset-top))]',
        'max-md:min-h-0 max-md:gap-4',
        'max-md:transition-[min-height,padding] max-md:duration-[320ms] max-md:[transition-timing-function:cubic-bezier(.22,.61,.36,1)]',
        'max-md:will-change-[min-height,padding]',
        /* extra-small phones */
        'max-[480px]:![padding:6px_10px]',
        'max-[380px]:![padding:6px_10px] max-[380px]:!gap-[6px]',
      )}
    >
      {/* Left section: connection dot + brand + util strip */}
      <div className={cn('flex items-center gap-3', 'max-md:min-w-0 max-md:overflow-hidden')}>
        <div
          className={cn(
            'w-2 h-2 rounded-full mr-1 shrink-0',
            connected
              ? 'bg-accent-green shadow-[0_0_8px_var(--color-accent-green)]'
              : 'bg-accent-coral shadow-[0_0_8px_var(--color-accent-coral)] animate-blink',
          )}
          role="status"
          aria-label={connected ? 'Connected' : 'Disconnected'}
        />
        <div className={cn('flex flex-col gap-2', 'max-md:gap-0')}>
          <h1
            className={cn(
              'font-display text-base font-bold tracking-[3px] uppercase text-accent-coral whitespace-nowrap',
              /* logo link touch target */
              '[&_a]:inline-flex [&_a]:items-center [&_a]:min-h-11 [&_a]:py-1.5',
              /* responsive type refinements */
              'md:[letter-spacing:0.12em] md:font-medium',
              'max-[480px]:font-normal max-[480px]:[letter-spacing:0.08em]',
              'max-md:text-sm max-md:tracking-[2px] max-md:leading-none',
              'max-[380px]:text-[13px] max-[380px]:tracking-[1.5px]',
              /* scroll-collapse transitions */
              'max-md:transition-[font-size,line-height] max-md:duration-[280ms] max-md:[transition-timing-function:cubic-bezier(.22,.61,.36,1)]',
            )}
          >
            <a href="/" aria-label="FESTIE home" className="text-[inherit] no-underline">
              FESTIE
            </a>
          </h1>
          <div
            className={cn(
              'flex gap-4 items-center',
              /* hidden on mobile (<768px) — Install App + Support Me */
              'max-md:!hidden',
            )}
          >
            {/* Install App button */}
            <Button
              variant="util"
              type="button"
              aria-label="Install Festie app"
              data-testid="install-app-btn"
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
              }
              onClick={async () => {
                const evt = window.__festieInstallPrompt;
                if (!evt) return;
                try {
                  await evt.prompt();
                  await evt.userChoice;
                } catch {
                  /* user dismissed or prompt already consumed */
                }
                window.__festieInstallPrompt = null; // eslint-disable-line require-atomic-updates -- module-level flag, not a real race
              }}
            >
              {' Install App'}
            </Button>

            {/* Support link */}
            <a
              className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[background-color,color,border-color] duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 bg-[var(--color-overlay-2)] text-text-secondary border border-color-border text-[11px] tracking-wide hover:border-accent-coral hover:text-accent-coral hover:bg-[var(--color-overlay-4)] focus-visible:outline-accent-aqua [&_svg]:w-[11px] [&_svg]:h-[11px] px-2.5 py-1.5 min-h-11 min-w-11 no-underline whitespace-nowrap"
              href="https://paypal.me/uhsear"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Support the project via PayPal"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {' Support Me'}
            </a>
          </div>
        </div>

        {/* Primary nav tabs — desktop only (lg+). Tablet and mobile use the
            bottom nav (BottomNav is `max-lg:block`), so the handoff is a clean
            single switch at the lg breakpoint: no double-nav, no gap. */}
        <nav aria-label="Main navigation">
          <div className="hidden lg:flex gap-1 ml-6">
            {desktopTabs.map((tab) => {
              const active = isTabActive(tab.href);
              return (
                <button
                  key={tab.href}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'px-4 py-2 bg-transparent text-text-secondary text-[13px] font-semibold rounded-sm',
                    'transition-colors duration-[250ms] ease-standard tracking-[0.3px]',
                    'hover:text-text-primary',
                    'border border-transparent',
                    active && 'bg-aqua-a12 text-accent-aqua !border-aqua-a2 !rounded-lg',
                  )}
                  onClick={() => navigate({ to: tab.href })}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Right section: festival mode + admin badge + profile badge */}
      <div
        className={cn(
          'flex items-center gap-5',
          'max-md:!gap-1.5 max-md:shrink-0 max-md:ml-auto',
          'max-[380px]:gap-3',
          /* hide ghost sm buttons on extra-small phones */
          'max-[380px]:[&_.btn-ghost.btn-sm]:hidden',
        )}
      >
        {/* Festival Mode toggle — flips store flag + navigates to /festival-mode */}
        <FestivalModeToggle />

        {/* User menu / profile badge */}
        {user && <UserMenu user={user} />}
      </div>
    </header>
  );
}
