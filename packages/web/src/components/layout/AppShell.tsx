import { useEffect, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { Loader } from 'lucide-react';
import { useAuthStore } from '@festie/shared';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useOffline } from '@festie/shared/hooks';
import Header from './Header';
import BottomNav from './BottomNav';
import Button from '../ui/Button';
import SubHeader from './SubHeader';
import ScheduleViewSwitcher, { isSchedulePath } from './ScheduleViewSwitcher';
import PageTransition from './PageTransition';
import DetailPanel from '../features/DetailPanel';
import OfflineBanner from '../features/OfflineBanner';
import UpdatePrompt from '../features/UpdatePrompt';
import IOSInstallSheet from '../features/IOSInstallSheet';
import FestivalDayBanner from '../features/FestivalDayBanner';
import Onboarding from '../features/Onboarding';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useScrollReset } from '../../hooks/useScrollReset';
import { useOfflineQueueBridge } from '../../hooks/useOfflineQueueBridge';
import { useFestivalLoader } from '../../hooks/useFestivalLoader';
import { useFestivalMode } from '../../hooks/useFestivalMode';
import { prefetchMainRoutes } from '../../router';
import { cn } from '../../lib/utils';
import { SocketContext } from '../../lib/socketContext';

const authRoutes = ['/login', '/register', '/forgot-password'];

// Centered branded loader for lazy-route chunk loads. Replaces the bare
// "Loading..." text the Suspense boundaries used to fall back to.
function RouteFallback() {
  return (
    <div
      className="flex flex-1 items-center justify-center w-full min-h-[40vh] py-10"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader className="w-8 h-8 animate-spin text-accent-aqua motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// Routes where the global festival/day/stage sub-header has no purpose.
const noSubHeaderRoutes = ['/account', '/crew', '/festival-mode'];

// Routes that keep ONLY the day toggle (Sat/Sun).
const dayOnlySubHeaderRoutes = ['/timeline', '/grid', '/picks'];

// Routes that keep ONLY the festival selector.
const festivalOnlySubHeaderRoutes = ['/wrap'];

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const detailSet = useUIStore((s) => s.detailSet);
  const setDetailSet = useUIStore((s) => s.setDetailSet);
  const detailAutoSpotify = useUIStore((s) => s.detailAutoSpotify);
  const setDetailAutoSpotify = useUIStore((s) => s.setDetailAutoSpotify);

  const isAuthRoute = authRoutes.includes(location.pathname);
  const hideSubHeader = noSubHeaderRoutes.includes(location.pathname);
  const dayOnlySubHeader = dayOnlySubHeaderRoutes.includes(location.pathname);
  const festivalOnlySubHeader = festivalOnlySubHeaderRoutes.includes(location.pathname);

  // --- Side-effect hooks ---
  useScrollReset(location.pathname);
  // useRealtimeSync owns the single shared socket; expose it via context so the
  // crew Live Location publisher can emit on it (no second connection). The
  // optional chaining tolerates the test mock that returns undefined.
  const realtime = useRealtimeSync() as ReturnType<typeof useRealtimeSync> | undefined;
  const socket = realtime?.socket ?? null;
  useOffline();
  usePushNotifications();
  useOfflineQueueBridge();
  useFestivalLoader();
  const { showDayBanner } = useFestivalMode(location.pathname);

  // Prefetch main-tab chunks on idle so switching between tabs is instant.
  useEffect(() => {
    prefetchMainRoutes();
  }, []);

  // Auth routes don't use app shell layout
  if (isAuthRoute) {
    return (
      <main
        className={cn(
          'auth-screen',
          'flex flex-col items-center min-h-full overflow-y-auto text-center',
          'px-5 relative',
          '[padding-top:max(2.5rem,env(safe-area-inset-top,0px))]',
          'pb-10',
        )}
        aria-label="Authentication"
      >
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
    );
  }

  return (
    <SocketContext.Provider value={socket}>
      <div id="app">
        {/* Skip link -- WCAG 2.4.1 Bypass Blocks */}
        <a
          href="#main-content"
          className={cn(
            'skip-link',
            'absolute left-[-9999px] top-0 z-[var(--z-top)]',
            'bg-bg-primary text-accent-aqua px-4 py-2 underline font-semibold',
            'focus:left-[var(--space-4)] focus:top-[var(--space-4)]',
          )}
          onClick={() => {
            const main = document.getElementById('main-content');
            if (main) {
              main.setAttribute('tabindex', '-1');
              main.focus({ preventScroll: false });
            }
          }}
        >
          Skip to main content
        </a>

        <OfflineBanner />
        <UpdatePrompt />
        <IOSInstallSheet />
        <Onboarding />
        <Header />

        {showDayBanner && <FestivalDayBanner />}

        <div className="main-content flex flex-1 overflow-hidden flex-col">
          {!hideSubHeader && <SubHeader dayOnly={dayOnlySubHeader} festivalOnly={festivalOnlySubHeader} />}
          {isSchedulePath(location.pathname) && <ScheduleViewSwitcher />}

          <main
            id="main-content"
            className={cn(
              'content-area',
              'flex-1 overflow-auto px-6 py-4',
              '[-webkit-overflow-scrolling:touch] [overscroll-behavior-y:contain]',
            )}
          >
            <Suspense fallback={<RouteFallback />}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </Suspense>
          </main>
        </div>

        {/* Guest banner for unauthenticated users */}
        {!user && (
          <aside
            className={cn(
              'guest-banner',
              'z-10 relative',
              'flex items-center justify-between gap-[var(--space-6)]',
              'py-3 px-4 bg-[var(--color-aqua-a08)] border border-[var(--color-aqua-a25)]',
              'text-text-primary rounded-sm mb-0 font-semibold text-sm',
              'pb-[max(12px,calc(env(safe-area-inset-bottom,0px)+8px))]',
            )}
            aria-label="Guest notice"
          >
            <span>Browsing as guest.</span>
            <Button variant="primary" size="sm" type="button" onClick={() => navigate({ to: '/login' })}>
              Sign in / Sign up
            </Button>
          </aside>
        )}

        <BottomNav />

        {detailSet && (
          <DetailPanel
            key={detailSet.id}
            set={detailSet}
            autoOpenSpotify={detailAutoSpotify}
            onClose={() => {
              setDetailSet(null);
              setDetailAutoSpotify(false);
            }}
          />
        )}
      </div>
    </SocketContext.Provider>
  );
}
