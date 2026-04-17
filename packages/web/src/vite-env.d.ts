/// <reference types="vite/client" />
declare module 'virtual:pwa-register/react' {
  import type { Ref } from 'react';

  export type { RegisterSWOptions } from 'vite-plugin-pwa/client';
  export function useRegisterSW(options?: {
    onRegistered?: (registration: ServiceWorkerRegistration) => void;
    onRegisterError?: (error: any) => void;
  }): {
    offlineReady: Ref<boolean>;
    needRefresh: Ref<boolean>;
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}
