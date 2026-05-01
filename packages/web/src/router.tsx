import { RootRoute, Route, Router, redirect } from '@tanstack/react-router';
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import AppShell from './components/layout/AppShell';
import { useAuthStore } from '@festie/shared';
import CardsSkeleton from './components/ui/skeletons/CardsSkeleton';
import TimelineSkeleton from './components/ui/skeletons/TimelineSkeleton';
import GridSkeleton from './components/ui/skeletons/GridSkeleton';
import FestivalModeSkeleton from './components/ui/skeletons/FestivalModeSkeleton';
import PicksSkeleton from './components/ui/skeletons/PicksSkeleton';
import CrewSkeleton from './components/ui/skeletons/CrewSkeleton';
import AccountSkeleton from './components/ui/skeletons/AccountSkeleton';
import WrapSkeleton from './components/ui/skeletons/WrapSkeleton';

// Wrap a lazy component so React.Suspense shows a layout-matched skeleton
// while the chunk downloads — this replaces the previous single "Loading..."
// text fallback and eliminates the visible layout jolt when content arrives.
function withSkeleton(
  LazyCmp: ComponentType,
  Skeleton: ComponentType,
): () => ReactElement {
  return function SuspendedRoute() {
    return (
      <Suspense fallback={<Skeleton />}>
        <LazyCmp />
      </Suspense>
    );
  };
}

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
const loadCompare       = () => import('./routes/compare');

// Generic minimal fallback for auth/admin routes — these chunks are tiny and
// a layout-matched skeleton isn't worth the bytes. Main-tab routes below get
// dedicated skeletons keyed to their real layout.
const MinimalFallback = () => (
  <div className="loading-skeleton" aria-busy="true" aria-label="Loading">
    <div className="skeleton" style={{ height: 200, margin: 24, borderRadius: 12 }} />
  </div>
);

const CardsView        = withSkeleton(lazy(loadCards),         CardsSkeleton);
const TimelineView     = withSkeleton(lazy(loadTimeline),      TimelineSkeleton);
const PicksView        = withSkeleton(lazy(loadPicks),         PicksSkeleton);
const CrewView         = withSkeleton(lazy(loadCrew),          CrewSkeleton);
const GridView         = withSkeleton(lazy(loadGrid),          GridSkeleton);
const FestivalModeView = withSkeleton(lazy(loadFestivalMode),  FestivalModeSkeleton);
const WrapView         = withSkeleton(lazy(loadWrap),          WrapSkeleton);
const AccountPage      = withSkeleton(lazy(loadAccount),       AccountSkeleton);
const CompareView      = withSkeleton(lazy(loadCompare),       MinimalFallback);
const AdminPanel       = withSkeleton(lazy(loadAdmin),         MinimalFallback);
const LoginPage        = withSkeleton(lazy(loadLogin),         MinimalFallback);
const RegisterPage     = withSkeleton(lazy(loadRegister),      MinimalFallback);
const ForgotPasswordPage = withSkeleton(lazy(loadForgot),      MinimalFallback);

/**
 * Prefetch all authenticated main-tab chunks. Called from AppShell on idle
 * after first paint. Each import() is cached by the bundler — calling it
 * again later is a no-op. Keeps the initial bundle small while eliminating
 * the chunk-load pause on tab switch.
 */
export function prefetchMainRoutes() {
  const loaders = [loadCards, loadTimeline, loadGrid, loadFestivalMode, loadPicks, loadCrew, loadAccount, loadWrap];
  const run = () => loaders.forEach((fn) => fn().catch(() => {}));
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2000 });
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
  // Guests were seeing an inline <GuestTeaser> on /picks while /crew, /wrap,
  // /compare, /account all redirected to /login — inconsistent and the
  // Playwright sweep flagged /picks as the odd one out. Match the rest:
  // redirect at the router layer so the login flow is reached in one hop.
  beforeLoad: async () => {
    if (!isAuthenticated()) throw redirect({ to: '/login' });
  },
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

// /compare — side-by-side schedule compare with your crew.
// Ported from the legacy `renderCrewSchedule` view in public/views/crew.js.
const compareRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: CompareView,
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
  compareRoute,
  adminRoute,
]);

// Router instance
export const router = new Router({
  routeTree,
  notFoundMode: 'root',
  // Per-route Suspense fallbacks above handle the chunk-load skeleton; this
  // default only fires for beforeLoad redirects + route-level pending states.
  defaultPendingComponent: MinimalFallback,
  defaultPendingMs: 200,
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
