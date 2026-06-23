import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RouterProvider } from '@tanstack/react-router';
import { buildPersistOptions } from './lib/queryPersist';
import { LazyMotion, domAnimation } from 'motion/react';
import { router } from './router';
import { initWebVitals } from './lib/web-vitals';
import { ToastProvider } from './lib/toastContext';
import Toast from './components/layout/Toast';
import Button from './components/ui/Button';
import './styles/globals.css';

// ── Sentry initialization ───────────────────────────────────────────────
// Mirrors the backend lib/sentry.js pattern: optional, no-op when DSN is
// unset. Uses VITE_SENTRY_DSN (Vite exposes VITE_-prefixed env vars to
// the client bundle).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || 'dev',
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.05),
    sendDefaultPii: false,
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
  });
}

// ── Global error boundary ────────────────────────────────────────────────
// Catches unhandled render errors anywhere in the tree. TanStack Router's
// per-route `errorComponent` handles most cases, but this is the final
// safety net so the user never sees a white screen.
class GlobalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error:', error, info);
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h1>Something went wrong</h1>
          <p className="text-[var(--color-text-secondary)] text-sm my-2 mb-4">{this.state.error?.message}</p>
          <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Dev-only: expose zustand stores on window so smoke-test scripts and the
// /festival-mode manual-test harness can drive state without a backend.
// Tree-shaken in prod by the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  import('@festie/shared/stores').then((m) => {
    (window as unknown as Record<string, unknown>).__fs = m.useFestivalStore;
  });
  import('@festie/shared/stores/festivalModeStore').then((m) => {
    (window as unknown as Record<string, unknown>).__fms = m.useFestivalModeStore;
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

import { useAuthStore } from '@festie/shared';
import { setOnUnauthorized } from '@festie/shared/services';
import { clearOfflineQueue } from './hooks/useOfflineQueue';

setOnUnauthorized(async () => {
  try {
    await useAuthStore.getState().refreshToken();
    return true;
  } catch {
    useAuthStore.getState().setUser(null);
    return false;
  }
});

let prevUserId: string | undefined;
useAuthStore.subscribe((state) => {
  const newId = state.user?.id;
  if (prevUserId && newId !== prevUserId) {
    queryClient.clear();
    clearOfflineQueue().catch(() => {});
  }
  prevUserId = newId;
});

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <LazyMotion features={domAnimation} strict>
        <PersistQueryClientProvider client={queryClient} persistOptions={buildPersistOptions()}>
          <ToastProvider>
            <RouterProvider router={router} />
            <Toast />
          </ToastProvider>
        </PersistQueryClientProvider>
      </LazyMotion>
    </GlobalErrorBoundary>
  </React.StrictMode>,
);

// Real User Monitoring — only in production to avoid dev-noise.
// Backend: POST /api/v1/metrics/web-vitals (routes/client-metrics.js) records
// into prom histogram fp_web_vitals_seconds{metric,nav}. Offline-queued in
// localStorage (cap 50) and flushed on `online` + visibilitychange-hidden.
if (import.meta.env.PROD) {
  initWebVitals();
}
