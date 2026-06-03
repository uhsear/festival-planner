import { useEffect, useState } from 'react';
import { useUIStore } from '../stores/uiStore';

export interface UseOfflineReturn {
  isOffline: boolean;
  pendingSync: number;
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

    // Cold-start sync: the page may have loaded while already offline (the
    // festival case — dead signal before the app is even opened), in which case
    // no 'offline' event ever fires. Seed the store from navigator.onLine so the
    // banner shows and the api-layer write queue engages from the first action.
    const online = navigator.onLine;
    setIsOnline(online);
    setOfflineMode(!online);

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

  return {
    isOffline: !isOnline,
    pendingSync,
  };
}
