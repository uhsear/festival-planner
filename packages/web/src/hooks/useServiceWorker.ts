import { useEffect, useState, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function useServiceWorker() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh: () => setNeedRefresh(true),
    onRegistered: (_registration: ServiceWorkerRegistration | undefined) => {},
    onRegisterError: (error: unknown) => {
      console.error('SW registration error:', error);
    },
  });

  const handleUpdate = useCallback(() => {
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  return {
    needRefresh,
    updateServiceWorker: handleUpdate,
  };
}
