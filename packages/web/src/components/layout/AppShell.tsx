import React, { useEffect, Suspense, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestival } from '@festie/shared/hooks';
import Header from './Header';
import BottomNav from './BottomNav';
import Toast from './Toast';
import PageTransition from './PageTransition';
import DetailPanel from '../features/DetailPanel';
import OfflineBanner from '../features/OfflineBanner';
import UpdatePrompt from '../features/UpdatePrompt';
import { ToastProvider } from '../../lib/toastContext';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { usePushNotifications } from '../../hooks/usePushNotifications';

const authRoutes = ['/login', '/register', '/forgot-password'];

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
  const { getStageColor } = useFestival();
  const isAuthRoute = authRoutes.includes(location.pathname);

  // Initialize real-time sync
  useRealtimeSync();

  // Request push notification permission if user is logged in
  usePushNotifications();

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

  // Re-fetch festival context + crews when user logs in (profiles require auth)
  const loadCrews = useCrewStore((state) => state.loadCrews);
  useEffect(() => {
    if (user && currentFestival) {
      // User just logged in — reload profiles so currentProfile gets set, load crews
      selectFestival(currentFestival.id).catch(() => {});
      loadCrews().catch(() => {});
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Stage chip toggle handler (legacy behavior: toggle individual, show all when empty)
  const handleStageToggle = useCallback(
    (stageId: string) => {
      const isActive = activeStages.includes(stageId);
      if (isActive) {
        const updated = activeStages.filter((id) => id !== stageId);
        setActiveStages(updated);
      } else {
        setActiveStages([...activeStages, stageId]);
      }
    },
    [activeStages, setActiveStages],
  );

  // Auth routes don't use app shell layout
  if (isAuthRoute) {
    return (
      <ToastProvider>
        <div className="auth-screen">
          <Suspense fallback={<div className="loading-skeleton">Loading...</div>}>
            <Outlet />
          </Suspense>
        </div>
        <Toast />
      </ToastProvider>
    );
  }

  // App shell layout — matches legacy #app > .header + .main-content + .guest-banner + .bottom-nav + #toasts
  return (
    <ToastProvider>
      <div id="app">
        {/* Offline banner */}
        <OfflineBanner />

        {/* Update prompt */}
        <UpdatePrompt />

        {/* Header */}
        <Header />

        {/* Main content wrapper (legacy .main-content holds sub-header + content-area) */}
        <div className="main-content">
          {/* Sub-header: festival selector, day tabs, stage filter, search */}
          <div className="sub-header">
            {/* Festival selector */}
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
              <div className="day-tabs" role="tablist" aria-label="Festival days">
                {days.map((day, i) => (
                  <button
                    key={day.id || i}
                    className={'day-tab' + (selectedDay === i ? ' active' : '')}
                    role="tab"
                    aria-selected={selectedDay === i}
                    aria-controls="main-content"
                    tabIndex={selectedDay === i ? 0 : -1}
                    onClick={() => setSelectedDay(i)}
                  >
                    {day.label || day.date}
                  </button>
                ))}
              </div>
            )}

            {/* Stage filter chips */}
            {currentFestival && stages.length > 0 && (
              <div className="filter-stage" role="group" aria-label="Filter by stage">
                {stages.map((stage) => {
                  const color = getStageColor(stage.id);
                  const isActive = activeStages.includes(stage.id);
                  // Active: solid stage color + white text (AA contrast).
                  // Inactive: faded stage-color tint + stage-color text on
                  // dark bg for brand feel (the legacy app.css fallback
                  // handles inactive contrast via a dark canvas bg).
                  const style = isActive
                    ? { color: '#fff', background: color, borderColor: color }
                    : { color: color, background: color + '20', borderColor: 'transparent' };
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

            {/* Search */}
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
          </div>

          <main id="main-content" className="content-area">
            <Suspense fallback={<div className="loading-skeleton" aria-busy="true" aria-label="Loading">Loading...</div>}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </Suspense>
          </main>
        </div>

        {/* Guest banner for unauthenticated users — positioned after .main-content like legacy */}
        {!user && (
          <div className="guest-banner">
            <span>Browsing as guest.</span>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => navigate({ to: '/login' })}
            >
              Login / Sign Up
            </button>
          </div>
        )}

        {/* Bottom navigation */}
        <BottomNav />

        {/* Detail panel overlay — rendered when a set card is tapped */}
        {detailSet && (
          <DetailPanel set={detailSet} onClose={() => setDetailSet(null)} />
        )}

        {/* Toast container — legacy position + a11y attributes */}
        <div id="toasts" className="toast-container" role="status" aria-live="polite">
          <Toast />
        </div>
      </div>
    </ToastProvider>
  );
}
