import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LazyMotion, domAnimation } from 'motion/react';
import { router } from './router';
import { initWebVitals } from './lib/web-vitals';
import { ToastProvider } from './lib/toastContext';
import Toast from './components/layout/Toast';
import './styles/globals.css';

// ── Global error boundary ────────────────────────────────────────────────
// Catches unhandled render errors anywhere in the tree. TanStack Router's
// per-route `errorComponent` handles most cases, but this is the final
// safety net so the user never sees a white screen.
class GlobalErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, margin: '8px 0 16px' }}>
            {this.state.error?.message}
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
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
  if (prevUserId && newId !== prevUserId) queryClient.clear();
  prevUserId = newId;
});

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <LazyMotion features={domAnimation} strict>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
            <Toast />
          </ToastProvider>
        </QueryClientProvider>
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
