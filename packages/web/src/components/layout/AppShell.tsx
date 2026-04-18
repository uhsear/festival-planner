import React, { useEffect, useMemo, useRef, Suspense, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalModeStore, isTodayFestivalDay } from '@festie/shared/stores/festivalModeStore';
import { useFestival } from '@festie/shared/hooks';
import { api } from '@festie/shared/services';
import { useToast } from '../../lib/toastContext';
import Header from './Header';
import BottomNav from './BottomNav';
import PageTransition from './PageTransition';
import DetailPanel from '../features/DetailPanel';
import OfflineBanner from '../features/OfflineBanner';
import UpdatePrompt from '../features/UpdatePrompt';
import IOSInstallSheet from '../features/IOSInstallSheet';
import FestivalDayBanner from '../features/FestivalDayBanner';
import { getStageBadgeStyle } from '../ui/StageBadge';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useSwipeDays } from '../../hooks/useSwipeDays';
import { useHaptics } from '../../hooks/useHaptics';
import { useOffline } from '@festie/shared/hooks';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { prefetchMainRoutes } from '../../router';

const authRoutes = ['/login', '/register', '/forgot-password'];
// Routes where the global festival/day/stage sub-header chrome has no purpose.
// Hiding it reclaims ~300 vertical px on mobile for the page's own content.
// Also hide the sub-header on /crew — that view is crew-scoped, not
// festival-schedule-scoped, so day tabs + artist search + stage chips are
// noise + they eat mobile viewport space the user needs for the crew tabs.
const noSubHeaderRoutes = ['/account', '/crew', '/festival-mode'];
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
  const festivals = useFestivalStore((state) => state.festivals);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const stages = useFestivalStore((state) => state.stages);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const setSelectedDay = useFestivalStore((state) => state.setSelectedDay);
  const setActiveStages = useFestivalStore((state) => state.setActiveStages);
  const setSearchQuery = useFestivalStore((state) => state.setSearchQuery);
  const detailSet = useUIStore((state) => state.detailSet);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const detailAutoSpotify = useUIStore((state) => state.detailAutoSpotify);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
  const { getStageColor } = useFestival();
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

  // Swipe-between-days gesture on the day-tabs row. Bound at shell level
  // because the day-tabs row lives in the sub-header — users swipe the
  // Sat/Sun pill strip to switch days instead of tapping.
  const { bind: swipeDaysBind } = useSwipeDays({
    days,
    selectedDay,
    onSelectDay: setSelectedDay,
  });

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

  // ?joinCrew=<inviteCode> deep-link handler (ported from legacy public/app.js).
  // Flow: GET /api/v1/crews/join/:code on the server returns an HTML landing
  // page whose CTA links to /?joinCrew=<code>. If the user isn't signed in,
  // stash the code and send them to /register; after register/login we replay.
  // If they're signed in but haven't joined this festival yet, POST /profiles
  // first (crew invite implies explicit intent to participate) and then POST
  // /crews/join. Success + failure both surface as toasts — the legacy app
  // swallowed errors into the console; we don't.
  const joinByCode = useCrewStore((state) => state.joinByCode);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const loadProfiles = useFestivalStore((state) => state.loadProfiles);
  const { toast } = useToast();
  const joinAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('joinCrew');
    if (!code) return;
    if (joinAttemptedRef.current === code) return;

    // Unauthenticated: stash and redirect to /register with a return-to hint
    if (!user) {
      try { sessionStorage.setItem('fk.pendingJoinCrew', code); } catch (_) {}
      joinAttemptedRef.current = code;
      navigate({ to: '/register' });
      return;
    }
    // Authenticated: wait for festival context to be ready
    if (!currentFestival) return;

    joinAttemptedRef.current = code;
    (async () => {
      try {
        if (!currentProfile) {
          await api.post('/profiles', { festivalId: currentFestival.id });
          await loadProfiles(currentFestival.id);
        }
        await joinByCode({ inviteCode: code });
        toast('Joined crew!', 'success');
        // Drop the query param so a refresh doesn't retry.
        const url = new URL(window.location.href);
        url.searchParams.delete('joinCrew');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        navigate({ to: '/crew' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not join crew';
        if (/already/i.test(msg)) {
          toast('You are already in this crew', 'info');
        } else {
          toast('Could not join crew: ' + msg, 'error');
        }
        // Clean URL anyway so we don't loop
        const url = new URL(window.location.href);
        url.searchParams.delete('joinCrew');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    })();
  }, [user?.id, currentFestival?.id, currentProfile?.id, joinByCode, loadProfiles, navigate, toast]);

  // Replay pending crew join after the user completes registration/login.
  useEffect(() => {
    if (!user) return;
    let pending: string | null = null;
    try { pending = sessionStorage.getItem('fk.pendingJoinCrew'); } catch (_) {}
    if (!pending) return;
    try { sessionStorage.removeItem('fk.pendingJoinCrew'); } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('joinCrew', pending);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    // Bump a state so the handler above re-runs.
    joinAttemptedRef.current = null;
  }, [user?.id]);

  // Re-fetch festival profiles on login once a festival is selected so
  // currentProfile gets populated.
  useEffect(() => {
    if (user && currentFestival) {
      selectFestival(currentFestival.id).catch(() => {});
    }
  }, [user?.id, currentFestival?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [isFestivalDayToday, fmManuallyDisabled, setFestivalMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the day banner on festival days whenever the user has either
  // explicitly dismissed Festival Mode OR turned it off — and only on
  // non-mode routes (nudging on /festival-mode itself would be silly).
  const showDayBanner = isFestivalDayToday && !fmOn && location.pathname !== '/festival-mode';

  // Festival select handler
  const handleFestivalChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (!id) return;
      try {
        await selectFestival(id);
      } catch (_) {}
    },
    [selectFestival],
  );

  // Haptic shell — same instance for day-tab taps + stage-chip toggles.
  const { select: selectHaptic } = useHaptics();

  // Stage chip toggle handler (legacy behavior: toggle individual, show all when empty)
  const handleStageToggle = useCallback(
    (stageId: string) => {
      selectHaptic();
      const isActive = activeStages.includes(stageId);
      if (isActive) {
        const updated = activeStages.filter((id) => id !== stageId);
        setActiveStages(updated);
      } else {
        setActiveStages([...activeStages, stageId]);
      }
    },
    [activeStages, setActiveStages, selectHaptic],
  );

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
          <div className="sub-header-wrap">
          <nav className="sub-header" aria-label="Festival view controls">
            {/* Festival selector — always rendered when the sub-header is
                visible. Day-only routes (/timeline, /grid, /picks) still
                show festival + day tabs so the user can swap festivals
                without backing out to /cards. Only stage chips + artist
                search are suppressed on those routes. */}
            <label
              htmlFor="festival-select-input"
              style={{ fontSize: '12px', color: 'var(--text-secondary)', marginRight: '6px', display: 'inline-block', fontWeight: '600' }}
            >
              Festival:
            </label>
            <select
              id="festival-select-input"
              className="festival-select"
              data-testid="festival-select"
              value={currentFestival?.id || ''}
              onChange={handleFestivalChange}
            >
              <option value="">Select Festival</option>
              {festivals.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            {/* Day tabs */}
            {currentFestival && days.length > 0 && (
              <div className="day-tabs" role="tablist" aria-label="Festival days"
                {...swipeDaysBind()} style={{ touchAction: 'pan-y' }}>
                {days.map((day, i) => (
                  <button
                    key={day.id || i}
                    className={'day-tab' + (selectedDay === i ? ' active' : '')}
                    role="tab"
                    aria-selected={selectedDay === i}
                    aria-controls="main-content"
                    tabIndex={selectedDay === i ? 0 : -1}
                    onClick={() => { selectHaptic(); setSelectedDay(i); }}
                  >
                    {day.label || day.date}
                  </button>
                ))}
              </div>
            )}

            {/* Stage filter chips + artist search — Schedule-scoped.
                Hidden on /timeline, /grid, /picks (those views are either
                already filtered by construction or have their own scoped
                controls). Visible on /cards + /crew. */}
            {!dayOnlySubHeader && currentFestival && stages.length > 0 && (
              <div className="filter-stage" role="group" aria-label="Filter by stage">
                {stages.map((stage) => {
                  const color = getStageColor(stage.id);
                  const isActive = activeStages.includes(stage.id);
                  // Active: solid stage color + white text with text-shadow
                  // (AA contrast on every palette color, incl. dark purples).
                  // Inactive: faded stage-color tint + stage-color text on
                  // dark bg for brand feel. See StageBadge for the shared
                  // palette logic.
                  const style = getStageBadgeStyle(color, 'chip', isActive);
                  return (
                    <button
                      key={stage.id}
                      className={'stage-chip' + (isActive ? ' active' : '')}
                      style={style}
                      aria-pressed={isActive}
                      aria-label={stage.name + (isActive ? ' (selected)' : '')}
                      onClick={() => handleStageToggle(stage.id)}
                    >
                      {stage.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Search — same scoping as stage filter */}
            {!dayOnlySubHeader && (
              <div className="search-box" role="search">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search artist..."
                  value={searchQuery}
                  aria-label="Search festival artists"
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
          </nav>
          </div>
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
