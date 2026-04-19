import React, { useEffect, useMemo, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalModeStore, isTodayFestivalDay } from '@festie/shared/stores/festivalModeStore';
import { api } from '@festie/shared/services';
import Header from './Header';
import BottomNav from './BottomNav';
import SubHeader from './SubHeader';
import PageTransition from './PageTransition';
import DetailPanel from '../features/DetailPanel';
import OfflineBanner from '../features/OfflineBanner';
import UpdatePrompt from '../features/UpdatePrompt';
import IOSInstallSheet from '../features/IOSInstallSheet';
import FestivalDayBanner from '../features/FestivalDayBanner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useCrewJoin } from '../../hooks/useCrewJoin';
import { useOffline } from '@festie/shared/hooks';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { prefetchMainRoutes } from '../../router';

const authRoutes = ['/login', '/register', '/forgot-password'];
// Routes where the global festival/day/stage sub-header chrome has no purpose.
// Hiding it reclaims ~300 vertical px on mobile for the page's own content.
// Also hide the sub-header on /crew — that view is crew-scoped, not
// festival-schedule-scoped, so day tabs + artist search + stage chips are
// noise + they eat mobile viewport space the user needs for the crew tabs.
const noSubHeaderRoutes = ['/account', '/crew', '/festival-mode', '/admin'];
// Routes that keep ONLY the day toggle (Sat/Sun). Festival selector, stage
// chips, and artist search are removed because those views are either
// already filtered by construction (picks/grid/timeline) or have their own
// scoped controls. Day switching is still needed across all three.
const dayOnlySubHeaderRoutes = ['/timeline', '/grid', '/picks'];

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const checkSession = useAuthStore((state) => state.checkSession);
  const user = useAuthStore((state) => state.user);
  const loadFestivals = useFestivalStore((state) => state.loadFestivals);
  const selectFestival = useFestivalStore((state) => state.selectFestival);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);
  const detailSet = useUIStore((state) => state.detailSet);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const detailAutoSpotify = useUIStore((state) => state.detailAutoSpotify);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
  const isAuthRoute = authRoutes.includes(location.pathname);
  const hideSubHeader = noSubHeaderRoutes.includes(location.pathname);
  const dayOnlySubHeader = dayOnlySubHeaderRoutes.includes(location.pathname);

  // Sub-header is now a regular block in the document flow: it scrolls away
  // with the page when the user scrolls down, and they have to scroll back
  // up to reach the festival / day / stage controls again. Previously this
  // used a scroll listener + `sub-header-wrap--hidden` toggle to auto-hide
  // on scroll-down and auto-restore on any upward scroll, which the user
  // reported as jarring ("shows back up as soon as you scroll up even a
  // little bit"). No listener, no state — the wrap stays for layout but is
  // always visible.

  // Reset scroll position on every route change. Two rAF ticks because
  // lazy-loaded routes mount AFTER the first effect fires — a plain
  // `scrollTop = 0` lands on an empty Suspense placeholder and the newly
  // mounted content (esp. pages with min-h-screen) can restore a previous
  // scroll offset. Two rAFs ensure the reset sticks after Suspense commits
  // and layout settles.
  useEffect(() => {
    const scrollEl = document.getElementById('main-content');
    if (!scrollEl) return;
    scrollEl.scrollTop = 0;
    const r1 = requestAnimationFrame(() => {
      scrollEl.scrollTop = 0;
      const r2 = requestAnimationFrame(() => { scrollEl.scrollTop = 0; });
      (scrollEl as any).__rafScrollReset = r2;
    });
    return () => {
      cancelAnimationFrame(r1);
      const r2 = (scrollEl as any).__rafScrollReset;
      if (r2) cancelAnimationFrame(r2);
    };
  }, [location.pathname]);

  // Initialize real-time sync
  useRealtimeSync();

  // Prefetch main-tab chunks on idle so switching between /grid, /timeline,
  // /picks, /crew is instant (no chunk-load pause that made first-scroll
  // feel laggy). Fires once per shell mount.
  useEffect(() => { prefetchMainRoutes(); }, []);

  // Request push notification permission if user is logged in
  usePushNotifications();

  // Offline detection — flips uiStore.offlineMode on window online/offline
  // events so <OfflineBanner /> shows the right state.
  useOffline();

  // Offline mutation queue — replays queued picks/ratings/notes when the
  // browser comes back online. The queue lives in IndexedDB so it survives
  // page reloads. Call sites (savePick, RatingButtons, etc.) can queue via
  // the bridge `window.__festieQueue` OR stay online-only; the queue is
  // inert until something enqueues. Permanent 4xx errors and 24h-stale
  // entries are auto-discarded by processQueue() itself.
  const { queueMutation, processQueue } = useOfflineQueue();
  useEffect(() => {
    // Adapter: api.* helpers take (path, body) not (path, {method, body}).
    const adapter = async (url: string, init: { method?: string; body?: unknown } = {}) => {
      const m = (init.method || 'POST').toUpperCase();
      if (m === 'GET')    return api.get(url);
      if (m === 'PUT')    return api.put(url, init.body);
      if (m === 'PATCH')  return api.patch(url, init.body);
      if (m === 'DELETE') return api.delete(url);
      return api.post(url, init.body);
    };
    (window as any).__festieQueue = { queueMutation, processQueue: () => processQueue(adapter) };
    const onOnline = () => { processQueue(adapter).catch(() => {}); };
    window.addEventListener('online', onOnline);
    // Also drain on mount (covers the case where we boot online with queued items)
    if (navigator.onLine) processQueue(adapter).catch(() => {});
    return () => { window.removeEventListener('online', onOnline); };
  }, [queueMutation, processQueue]);

  useEffect(() => {
    checkSession().catch(() => {});
  }, [checkSession]);

  // Auto-load festivals + select first one on boot (mirrors legacy init())
  useEffect(() => {
    loadFestivals()
      .then(() => {
        const fests = useFestivalStore.getState().festivals;
        if (fests.length > 0 && !useFestivalStore.getState().currentFestival) {
          selectFestival(fests[0].id).catch(() => {});
        }
      })
      .catch(() => {});
  }, [loadFestivals, selectFestival]);

  // Load crews whenever auth state transitions to logged-in. Independent of
  // festival — crew list is user-scoped, not festival-scoped.
  const loadCrews = useCrewStore((state) => state.loadCrews);
  useEffect(() => {
    if (user) {
      loadCrews().catch(() => {});
    }
  }, [user?.id, loadCrews]);

  // Crew join deep-link handler (?joinCrew=<inviteCode>)
  useCrewJoin();

  // Re-fetch festival profiles on login once a festival is selected so
  // currentProfile gets populated.
  useEffect(() => {
    if (user && currentFestival) {
      selectFestival(currentFestival.id).catch(() => {});
    }
  }, [user?.id, currentFestival?.id, selectFestival]);

  // Auto-enable Festival Mode when today is a festival day, unless the user
  // manually opted out (that intent is preserved in the store's
  // manuallyDisabled flag + legacy localStorage key). Runs once per day-list
  // update so loading a different festival re-evaluates. Navigating to
  // /festival-mode is additive — the user can still back out anytime.
  const setFestivalMode = useFestivalModeStore((s) => s.setFestivalMode);
  const fmOn = useFestivalModeStore((s) => s.isFestivalMode);
  const fmManuallyDisabled = useFestivalModeStore((s) => s.manuallyDisabled);
  const isFestivalDayToday = useMemo(() => {
    const dayDates = days.map((d) => d.date).filter(Boolean) as string[];
    return isTodayFestivalDay(dayDates);
  }, [days]);
  useEffect(() => {
    if (!isFestivalDayToday) return;
    if (fmManuallyDisabled) return;
    if (!fmOn) setFestivalMode(true);
    // Only redirect on an initial arrival at /, /cards; don't hijack deeper
    // routes where the user may be intentionally browsing.
    if (location.pathname === '/' || location.pathname === '/cards') {
      navigate({ to: '/festival-mode' });
    }
  }, [isFestivalDayToday, fmManuallyDisabled, setFestivalMode, fmOn, location.pathname, navigate]);

  // Show the day banner on festival days whenever the user has either
  // explicitly dismissed Festival Mode OR turned it off — and only on
  // non-mode routes (nudging on /festival-mode itself would be silly).
  const showDayBanner = isFestivalDayToday && !fmOn && location.pathname !== '/festival-mode';

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

  // App shell layout — matches legacy #app > .header + .main-content + .guest-banner + .bottom-nav + #toasts
  return (
    <div id="app">
        {/* Skip link — WCAG 2.4.1 Bypass Blocks. Hidden until keyboard focus
            lands on it so sighted users don't see it, but screen-reader and
            keyboard-only users get a one-tab route past the 20+ chrome tabs. */}
        <a
          href="#main-content"
          className="skip-link"
          onClick={(e) => {
            // Ensure programmatic focus lands on main after the anchor jump.
            const main = document.getElementById('main-content');
            if (main) {
              main.setAttribute('tabindex', '-1');
              main.focus({ preventScroll: false });
            }
          }}
        >
          Skip to main content
        </a>

        {/* Offline banner */}
        <OfflineBanner />

        {/* Update prompt */}
        <UpdatePrompt />

        {/* iOS "Add to Home Screen" prompt — hook gates on engagement + cooldown */}
        <IOSInstallSheet />

        {/* Header */}
        <Header />

        {/* Festival-day nudge — only on festival days when mode is off */}
        {showDayBanner && <FestivalDayBanner />}

        {/* Main content wrapper (legacy .main-content holds sub-header + content-area) */}
        <div className="main-content">
          {/* Sub-header: festival selector, day tabs, stage filter, search.
              Wrapped in .sub-header-wrap for grid-row collapse animation on
              scroll-down; grid-template-rows: 0fr crushes the nav to 0 height
              without layout reflow on the content area below. */}
          {!hideSubHeader && (
            <SubHeader dayOnly={dayOnlySubHeader} />
          )}

          <main id="main-content" className="content-area">
            <Suspense fallback={<div className="loading-skeleton" aria-busy="true" aria-label="Loading">Loading...</div>}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </Suspense>
          </main>
        </div>

        {/* Guest banner for unauthenticated users — positioned after .main-content like legacy.
            Using <aside role="complementary" aria-label="Guest notice"> so axe's `region` rule
            treats the banner as a recognized landmark instead of orphaned content. */}
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

        {/* Bottom navigation */}
        <BottomNav />

        {/* Detail panel overlay — rendered when a set card is tapped */}
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
