import { useEffect, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useOffline } from '@festie/shared/hooks';
import Header from './Header';
import BottomNav from './BottomNav';
import SubHeader from './SubHeader';
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

const authRoutes = ['/login', '/register', '/forgot-password'];

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
  useRealtimeSync();
  useOffline();
  usePushNotifications();
  useOfflineQueueBridge();
  useFestivalLoader();
  const { showDayBanner } = useFestivalMode(location.pathname);

  // Prefetch main-tab chunks on idle so switching between tabs is instant.
  useEffect(() => { prefetchMainRoutes(); }, []);

  // Auth routes don't use app shell layout
  if (isAuthRoute) {
    return (
      <div className="auth-screen">
        <Suspense fallback={<div className="loading-skeleton">Loading...</div>}>
          <Outlet />
        </Suspense>
      </div>
    );
  }

  return (
    <div id="app">
      {/* Skip link -- WCAG 2.4.1 Bypass Blocks */}
      <a
        href="#main-content"
        className="skip-link"
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

      <div className="main-content">
        {!hideSubHeader && (
          <SubHeader
            dayOnly={dayOnlySubHeader}
            festivalOnly={festivalOnlySubHeader}
          />
        )}

        <main id="main-content" className="content-area">
          <Suspense fallback={<div className="loading-skeleton" aria-busy="true" aria-label="Loading">Loading...</div>}>
            <PageTransition>
              <Outlet />
            </PageTransition>
          </Suspense>
        </main>
      </div>

      {/* Guest banner for unauthenticated users */}
      {!user && (
        <aside className="guest-banner" aria-label="Guest notice">
          <span>Browsing as guest.</span>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => navigate({ to: '/login' })}
          >
            Login / Sign Up
          </button>
        </aside>
      )}

      <BottomNav />

      {detailSet && (
        <DetailPanel
          set={detailSet}
          autoOpenSpotify={detailAutoSpotify}
          onClose={() => { setDetailSet(null); setDetailAutoSpotify(false); }}
        />
      )}
    </div>
  );
}
