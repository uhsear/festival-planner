import { m, useReducedMotion } from 'motion/react';
import { Flame } from 'lucide-react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useFestivalModeStore } from '@festie/shared';
import { useHaptics } from '../../hooks/useHaptics';
import { cn } from '@/lib/utils';

// Where to send the user when they turn Festival Mode OFF. If they arrived at
// /festival-mode from another view we could remember that, but simplest
// correct behavior is to land on the main schedule — matches the legacy
// experience where turning off just unhid the original content.
const EXIT_ROUTE = '/cards';

export default function FestivalModeToggle() {
  const isFestivalMode = useFestivalModeStore((state) => state.isFestivalMode);
  const toggleFestivalMode = useFestivalModeStore((state) => state.toggleFestivalMode);
  const { select } = useHaptics();
  const navigate = useNavigate();
  const location = useLocation();
  // motion/react drives animations via rAF — our `@media (prefers-reduced-motion)`
  // rule in globals.css only clamps CSS `animation-duration` and has no effect
  // on this JS-driven pulse. Gate it explicitly so vestibular-sensitive users
  // actually get a still icon (infinite scale loop is exactly the kind of
  // motion WCAG 2.3.3 flags).
  const prefersReducedMotion = useReducedMotion();

  const handleToggle = () => {
    select();
    toggleFestivalMode();
    const nowOn = !isFestivalMode;
    if (nowOn && location.pathname !== '/festival-mode') {
      navigate({ to: '/festival-mode' });
    } else if (!nowOn && location.pathname === '/festival-mode') {
      navigate({ to: EXIT_ROUTE });
    }
  };

  return (
    <m.button
      onClick={handleToggle}
      whileTap={{ scale: 0.95 }}
      aria-label={isFestivalMode ? 'Turn off Festival Mode' : 'Turn on Festival Mode'}
      aria-pressed={isFestivalMode}
      title={isFestivalMode ? 'Festival Mode: on' : 'Festival Mode: off'}
      data-testid="festival-mode-toggle"
      className={cn(
        'relative p-2 rounded-lg transition-[background-color,color,box-shadow] duration-300 min-h-11 min-w-11 flex items-center justify-center',
        isFestivalMode
          ? 'bg-accent-aqua text-[var(--text-on-light-accent)] shadow-lg shadow-accent-aqua/50'
          : 'bg-glass text-text-secondary hover:text-text-primary',
      )}
    >
      {isFestivalMode && !prefersReducedMotion && (
        <m.div
          className="absolute inset-0 rounded-lg bg-accent-aqua -z-[1]"
          animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.25, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5" aria-hidden="true" />
        <span className="text-sm font-medium hidden sm:inline">Festival Mode</span>
      </div>
    </m.button>
  );
}
