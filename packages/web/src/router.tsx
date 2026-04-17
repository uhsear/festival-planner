import { RootRoute, Route, Router, redirect } from '@tanstack/react-router';
import { lazy } from 'react';
import AppShell from './components/layout/AppShell';
import { useAuthStore } from '@festie/shared';

// Auth check helpers
const isAuthenticated = () => !!useAuthStore.getState().user;
const isAdmin = () => useAuthStore.getState().user?.isAdmin || false;

// Lazy load route components
const CardsView = lazy(() => import('./routes/cards'));
const TimelineView = lazy(() => import('./routes/timeline'));
const PicksView = lazy(() => import('./routes/picks'));
const CrewView = lazy(() => import('./routes/crew'));
const GridView = lazy(() => import('./routes/grid'));
const AdminPanel = lazy(() => import('./routes/admin'));
const LoginPage = lazy(() => import('./routes/login'));
const RegisterPage = lazy(() => import('./routes/register'));
const ForgotPasswordPage = lazy(() => import('./routes/forgot-password'));
const AccountPage = lazy(() => import('./routes/account'));

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
