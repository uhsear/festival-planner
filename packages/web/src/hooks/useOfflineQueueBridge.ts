import { useEffect } from 'react';
import { api } from '@festie/shared/services';
import { useOfflineQueue } from './useOfflineQueue';

/**
 * Sets up the global `window.__festieQueue` bridge so any component
 * (savePick, RatingButtons, etc.) can queue offline mutations.
 * Also auto-drains the queue on `online` events and on mount.
 */
export function useOfflineQueueBridge() {
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
    window.__festieQueue = {
      queueMutation: queueMutation as (args: unknown) => Promise<unknown>,
      processQueue: () => processQueue(adapter),
    };
    const onOnline = () => { processQueue(adapter).catch(() => {}); };
    window.addEventListener('online', onOnline);
    // Also drain on mount (covers the case where we boot online with queued items)
    if (navigator.onLine) processQueue(adapter).catch(() => {});
    return () => { window.removeEventListener('online', onOnline); };
  }, [queueMutation, processQueue]);
}
