import { useEffect, useCallback, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useAuthStore } from '@festie/shared/stores/authStore';

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BALNPV05RWu4564kGyCoIkL238AgM4u6_zMOJ7m7EwPHFcBp4HeXSVZ-iH-EgF4bqMpc1QPWGONavgw2xAXhKvs';

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';
export type UnsupportedReason = 'browser' | 'ios-needs-install' | null;

export interface UsePushNotificationsReturn {
  isSupported: boolean;
  unsupportedReason: UnsupportedReason;
  permission: NotificationPermission | 'default';
  permissionState: PushPermissionState;
  requestPermission: () => Promise<NotificationPermission | 'default' | null>;
  registerToken: () => Promise<void>;
  unregisterToken: () => Promise<void>;
}

let _currentToken: string | null = null;

// Tracks which user ID registered the push subscription currently held by the
// browser. If a different user logs in on the same device, we must unsubscribe
// the stale subscription before auto-registering — otherwise POST
// /notifications/token fires with a subscription owned by the previous user
// and the server's hijacking check returns 400 (visible in the browser's
// network log even when caught by JS).
const REGISTERED_USER_KEY = 'fp-push-registered-user';

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
  const [unsupportedReason, setUnsupportedReason] = useState<UnsupportedReason>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'default'>('default');
  const user = useAuthStore((state) => state.user);
  const sessionChecked = useAuthStore((state) => state.sessionChecked);

  const permissionState: PushPermissionState = !isSupported
    ? 'unsupported'
    : (permission as PushPermissionState);

  useEffect(() => {
    // iOS Safari quirk: `PushManager` exists in regular tabs since iOS 16.4,
    // but `subscribe()` only works when the PWA is launched from the Home
    // Screen (standalone mode). We distinguish three states:
    //   1. No push APIs → reason='browser' (truly unsupported)
    //   2. iOS Safari tab → reason='ios-needs-install' (prompt Add to Home)
    //   3. Standalone PWA or non-iOS browser with APIs → supported=true
    const hasApis =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    // iPadOS 13+ reports as Mac; ontouchend presence disambiguates.
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
    const isStandalone =
      (typeof navigator !== 'undefined' && (navigator as any).standalone === true) ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(display-mode: standalone)').matches === true);

    if (!hasApis) {
      setIsSupported(false);
      setUnsupportedReason('browser');
      return;
    }
    if (isIOS && !isStandalone) {
      setIsSupported(false);
      setUnsupportedReason('ios-needs-install');
      return;
    }
    setIsSupported(true);
    setUnsupportedReason(null);
    setPermission(Notification.permission);
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
    if (!isSupported || !user) return;

    const registration = await navigator.serviceWorker.ready;

    const prevUserId = localStorage.getItem(REGISTERED_USER_KEY);
    if (prevUserId && prevUserId !== user.id) {
      try {
        const existing = await registration.pushManager.getSubscription();
        if (existing) await existing.unsubscribe();
      } catch { /* noop */ }
      localStorage.removeItem(REGISTERED_USER_KEY);
      return;
    }

    let subscription: PushSubscription;
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch {
      return;
    }

    const token = JSON.stringify(subscription);
    if (token === _currentToken) return;

    try {
      await api.post<void>('/notifications/token', { token, platform: 'web' });
      localStorage.setItem(REGISTERED_USER_KEY, user.id);
    } catch {
      // Server rejected — still cache token locally to avoid retry loop
    }
    _currentToken = token;
  }, [isSupported, user]);

  const unregisterToken = useCallback(async (): Promise<void> => {
    if (!_currentToken) return;

    try {
      await api.delete<void>('/notifications/token');
    } catch {
      // Swallow — server may have already removed the token
    }

    _currentToken = null;
    localStorage.removeItem(REGISTERED_USER_KEY);
  }, []);

  // Auto-register when permission is already granted and user is logged in.
  // Guest guard: `user !== null` must be checked FIRST — without this the
  // effect would POST /notifications/token with no session cookie, which the
  // server rejects as 400 "Invalid push token" / 429 "Too many token
  // registrations" on every guest page load and popped a red toast that
  // guests have no way to action.
  useEffect(() => {
    if (
      sessionChecked &&
      user !== null &&
      isSupported &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      registerToken().catch((err) => {
        // Swallow silently — the auto-register path is best-effort and
        // firing a red toast for a background registration failure the
        // user never initiated is more confusing than helpful. The manual
        // requestPermission flow still surfaces errors via its own return.
        console.error(err);
      });
    }
  }, [sessionChecked, isSupported, user, registerToken]);

  // Clean up on logout
  useEffect(() => {
    if (!user && _currentToken) {
      unregisterToken().catch(console.error);
    }
  }, [user, unregisterToken]);

  return {
    isSupported,
    unsupportedReason,
    permission,
    permissionState,
    requestPermission,
    registerToken,
    unregisterToken,
  };
}
