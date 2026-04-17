import { useEffect, useCallback, useState } from 'react';
import { useUIStore } from '../stores/uiStore';

export interface OfflineSnapshot {
  timestamp: number;
  data: any;
}

export interface UseOfflineReturn {
  isOffline: boolean;
  pendingSync: number;
  saveSnapshot: (data: any) => void;
  restoreSnapshot: () => OfflineSnapshot | null;
}

export function useOffline(): UseOfflineReturn {
  const setOfflineMode = useUIStore((state) => state.setOfflineMode);
  const offlineMode = useUIStore((state) => state.offlineMode);
  const pendingSync = useUIStore((state) => state.pendingSync);
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    return true;
  });

  useEffect(() => {
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

  const saveSnapshot = useCallback((data: any) => {
    try {
      const snapshot: OfflineSnapshot = {
        timestamp: Date.now(),
        data,
      };
      localStorage.setItem('festie-offline-snapshot', JSON.stringify(snapshot));
    } catch (err) {
      console.error('Failed to save offline snapshot:', err);
    }
  }, []);

  const restoreSnapshot = useCallback((): OfflineSnapshot | null => {
    try {
      const item = localStorage.getItem('festie-offline-snapshot');
      if (!item) return null;
      return JSON.parse(item) as OfflineSnapshot;
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
