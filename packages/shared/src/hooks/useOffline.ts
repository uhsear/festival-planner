import { useEffect, useCallback, useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { getStorage } from '../platform/storage';

export interface OfflineSnapshot {
  timestamp: number;
  data: unknown;
}

export interface UseOfflineReturn {
  isOffline: boolean;
  pendingSync: number;
  saveSnapshot: (data: unknown) => void;
  restoreSnapshot: () => OfflineSnapshot | null;
}

export function useOffline(): UseOfflineReturn {
  const setOfflineMode = useUIStore((state) => state.setOfflineMode);
  const pendingSync = useUIStore((state) => state.pendingSync);
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      setOfflineMode(false);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setOfflineMode(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOfflineMode]);

  const saveSnapshot = useCallback((data: unknown) => {
    try {
      const snapshot: OfflineSnapshot = {
        timestamp: Date.now(),
        data,
      };
      getStorage().setItem('festie-offline-snapshot', JSON.stringify(snapshot));
    } catch (err) {
      console.error('Failed to save offline snapshot:', err);
    }
  }, []);

  const restoreSnapshot = useCallback((): OfflineSnapshot | null => {
    try {
      const raw = getStorage().getItem('festie-offline-snapshot');
      // Storage adapter may return a Promise (AsyncStorage) -- the sync
      // signature is kept for backward-compat; async adapters will return
      // null here. Callers needing async restore should use the storage
      // adapter directly.
      if (raw instanceof Promise) return null;
      if (!raw) return null;
      return JSON.parse(raw) as OfflineSnapshot;
    } catch (err) {
      console.error('Failed to restore offline snapshot:', err);
      return null;
    }
  }, []);

  return {
    isOffline: !isOnline,
    pendingSync,
    saveSnapshot,
    restoreSnapshot,
  };
}
