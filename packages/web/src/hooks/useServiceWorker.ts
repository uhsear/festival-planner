import { useEffect, useState, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function useServiceWorker() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const { updateServiceWorker } = useRegisterSW({
    onRegistered: (registration: any) => {
      console.log('SW Registered:', registration);
    },
    onRegisterError: (error: any) => {
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
