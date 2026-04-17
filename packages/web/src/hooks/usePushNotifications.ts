import { useEffect, useCallback, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useAuthStore } from '@festie/shared/stores/authStore';

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BALNPV05RWu4564kGyCoIkL238AgM4u6_zMOJ7m7EwPHFcBp4HeXSVZ-iH-EgF4bqMpc1QPWGONavgw2xAXhKvs';

export interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: NotificationPermission | 'default';
  requestPermission: () => Promise<NotificationPermission | 'default' | null>;
  registerToken: () => Promise<void>;
  unregisterToken: () => Promise<void>;
}

let _currentToken: string | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'default'>('default');
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    const supported =
      'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);

    if (supported && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<
    NotificationPermission | 'default' | null
  > => {
    if (!isSupported || !('Notification' in window)) {
      return null;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return null;
    }
  }, [isSupported]);

  const registerToken = useCallback(async (): Promise<void> => {
    if (!isSupported) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const token = JSON.stringify(subscription);

    if (token !== _currentToken) {
      await api.post<void>('/notifications/token', { token, platform: 'web' });
      _currentToken = token;
    }
  }, [isSupported]);

  const unregisterToken = useCallback(async (): Promise<void> => {
    if (!_currentToken) return;

    try {
      await api.delete<void>('/notifications/token');
    } catch {
      // Swallow — server may have already removed the token
    }

    _currentToken = null;
  }, []);

  // Auto-register when permission is already granted and user is logged in
  useEffect(() => {
    if (
      isSupported &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      user
    ) {
      registerToken().catch(console.error);
    }
  }, [isSupported, user, registerToken]);

  // Clean up on logout
  useEffect(() => {
    if (!user && _currentToken) {
      unregisterToken().catch(console.error);
    }
  }, [user, unregisterToken]);

  return {
    isSupported,
    permission,
    requestPermission,
    registerToken,
    unregisterToken,
  };
}
