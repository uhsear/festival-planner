import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { LayoutGrid, AlignLeft, Columns3 } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * In-page switcher for the three schedule views (Cards / Timeline / Grid),
 * mirroring the mobile SegmentedControl. Folds what used to be three separate
 * bottom-nav/header tabs into one "Schedule" destination — the nav now carries
 * a single Schedule tab and this control swaps the view in place.
 *
 * Per-tab chunk prefetchers live in BottomNav; navigating here reuses the
 * already-warmed route chunks.
 */
const VIEWS = [
  { key: '/cards', label: 'Cards', Icon: LayoutGrid },
  { key: '/timeline', label: 'Timeline', Icon: AlignLeft },
  { key: '/grid', label: 'Grid', Icon: Columns3 },
] as const;

/** Paths the schedule switcher applies to. `/` is the cards view alias. */
export const SCHEDULE_PATHS = ['/', '/cards', '/timeline', '/grid'] as const;

export function isSchedulePath(pathname: string): boolean {
  return (SCHEDULE_PATHS as readonly string[]).includes(pathname);
}

export default function ScheduleViewSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeKey = location.pathname === '/' ? '/cards' : location.pathname;

  // R13: sliding underline indicator. Measure the active tab and drive the
  // underline's translateX/width via CSS custom properties — the .tab-underline
  // element transitions transform + width (200ms standard easing). Measured in
  // useLayoutEffect (pre-paint, no flash) on active-tab change AND on resize so
  // it stays aligned. transform/width transitions are reduced-motion-safe via
  // the global prefers-reduced-motion block.
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const measure = () => {
      const active = bar.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (!active) return;
      setIndicator({ x: active.offsetLeft, w: active.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeKey]);

  return (
    <nav
      className={cn(
        'flex items-center gap-1 px-[var(--space-3)] py-2 sm:px-6',
        'bg-[var(--color-bg-chrome)] border-b border-border shrink-0',
        '[backdrop-filter:saturate(150%)_blur(12px)]',
      )}
      aria-label="Schedule view"
    >
      <div ref={tabBarRef} className="relative flex gap-1 p-1 rounded-full bg-bg-secondary" role="group">
        {VIEWS.map(({ key, label, Icon }) => {
          const active = key === activeKey;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? 'page' : undefined}
              aria-label={`${label} view`}
              onClick={() => navigate({ to: key })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 min-h-11 text-[length:var(--font-size-13)] font-semibold',
                'cursor-pointer transition-colors duration-[var(--duration-med)] ease-[var(--ease-out)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
                '[&_svg]:w-4 [&_svg]:h-4',
                active
                  ? 'bg-accent-aqua text-[var(--text-on-light-accent)]'
                  : 'bg-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
        {indicator && (
          <span
            className="tab-underline"
            aria-hidden="true"
            style={
              {
                '--tab-x': `${indicator.x}px`,
                '--tab-w': `${indicator.w}px`,
              } as CSSProperties
            }
          />
        )}
      </div>
    </nav>
  );
}
