import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { initWebVitals } from './lib/web-vitals';
import { ToastProvider } from './lib/toastContext';
import Toast from './components/layout/Toast';
import './styles/globals.css';

// Dev-only: expose zustand stores on window so smoke-test scripts and the
// /festival-mode manual-test harness can drive state without a backend.
// Tree-shaken in prod by the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  import('@festie/shared/stores').then((m) => {
    (window as any).__fs = m.useFestivalStore;
  });
  import('@festie/shared/stores/festivalModeStore').then((m) => {
    (window as any).__fms = m.useFestivalModeStore;
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

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
        <Toast />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

// Real User Monitoring — only in production to avoid dev-noise.
// Backend: POST /api/v1/metrics/web-vitals (routes/client-metrics.js) records
// into prom histogram fp_web_vitals_seconds{metric,nav}. Offline-queued in
// localStorage (cap 50) and flushed on `online` + visibilitychange-hidden.
if (import.meta.env.PROD) {
  initWebVitals();
}
