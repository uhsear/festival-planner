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
