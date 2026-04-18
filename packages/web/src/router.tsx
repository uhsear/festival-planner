import { RootRoute, Route, Router, redirect } from '@tanstack/react-router';
import { lazy } from 'react';
import AppShell from './components/layout/AppShell';
import { useAuthStore } from '@festie/shared';

// Auth check helpers
const isAuthenticated = () => !!useAuthStore.getState().user;
const isAdmin = () => useAuthStore.getState().user?.isAdmin || false;

// Lazy load route components — import promises are cached, so exposing the
// import factories as named loaders lets us prefetch a chunk before the user
// taps its nav button. AppShell calls these on idle after first paint so
// /grid + /timeline etc. are ready the moment the user switches tabs — no
// more "tab switch → wait for chunk → scroll feels laggy" pattern.
const loadCards         = () => import('./routes/cards');
const loadTimeline      = () => import('./routes/timeline');
const loadPicks         = () => import('./routes/picks');
const loadCrew          = () => import('./routes/crew');
const loadGrid          = () => import('./routes/grid');
const loadFestivalMode  = () => import('./routes/festival-mode');
const loadWrap          = () => import('./routes/wrap');
const loadAdmin         = () => import('./routes/admin');
const loadLogin         = () => import('./routes/login');
const loadRegister      = () => import('./routes/register');
const loadForgot        = () => import('./routes/forgot-password');
const loadAccount       = () => import('./routes/account');

const CardsView        = lazy(loadCards);
const TimelineView     = lazy(loadTimeline);
const PicksView        = lazy(loadPicks);
const CrewView         = lazy(loadCrew);
const GridView         = lazy(loadGrid);
const FestivalModeView = lazy(loadFestivalMode);
const WrapView         = lazy(loadWrap);
const AdminPanel       = lazy(loadAdmin);
const LoginPage        = lazy(loadLogin);
const RegisterPage     = lazy(loadRegister);
const ForgotPasswordPage = lazy(loadForgot);
const AccountPage      = lazy(loadAccount);

/**
 * Prefetch all authenticated main-tab chunks. Called from AppShell on idle
 * after first paint. Each import() is cached by the bundler — calling it
 * again later is a no-op. Keeps the initial bundle small while eliminating
 * the chunk-load pause on tab switch.
 */
export function prefetchMainRoutes() {
  const loaders = [loadCards, loadTimeline, loadGrid, loadFestivalMode, loadPicks, loadCrew, loadAccount, loadWrap];
  const run = () => loaders.forEach((fn) => fn().catch(() => {}));
  if (typeof (window as any).requestIdleCallback === 'function') {
    (window as any).requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 500);
  }
}

// Root route with AppShell layout
const rootRoute = new RootRoute({
  component: AppShell,
});

// ── Public routes (guests can browse the schedule) ──────────────────
const indexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <CardsView />,
});

const cardsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/cards',
  component: CardsView,
});

const timelineRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/timeline',
  component: TimelineView,
});

const picksRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/picks',
  component: PicksView,
});

const gridRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/grid',
  component: GridView,
});

const festivalModeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/festival-mode',
  component: FestivalModeView,
});

const wrapRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/wrap',
  component: WrapView,
  beforeLoad: async () => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

// ── Auth routes ─────────────────────────────────────────────────────
const loginRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

const forgotPasswordRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});

// ── Protected routes (redirect to /login if not authenticated) ──────
const crewRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/crew',
  component: CrewView,
  beforeLoad: async () => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

const accountRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
  beforeLoad: async () => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
});

const adminRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminPanel,
  beforeLoad: async () => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
    if (!isAdmin()) throw redirect({ to: '/' });
  },
});

// Route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  cardsRoute,
  timelineRoute,
  picksRoute,
  crewRoute,
  gridRoute,
  festivalModeRoute,
  wrapRoute,
  accountRoute,
  adminRoute,
]);

// Router instance
export const router = new Router({
  routeTree,
  notFoundMode: 'root',
  defaultPendingComponent: () => (
    <div className="loading-skeleton" aria-busy="true" aria-label="Loading">
      Loading...
    </div>
  ),
  defaultErrorComponent: ({ error, reset }) => (
    <div className="no-festival" role="alert">
      <p style={{ color: 'var(--accent-coral)', fontSize: '16px', marginBottom: '12px' }}>
        Error loading page
      </p>
      <button onClick={() => reset()} className="btn btn-primary btn-sm">
        Try Again
      </button>
    </div>
  ),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
