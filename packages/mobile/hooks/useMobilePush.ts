import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@festie/shared/services';

const TOKEN_KEY = 'festie-push-token';

// Show a banner for notifications that arrive while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export interface MobilePush {
  registered: boolean;
  busy: boolean;
  error: string | null;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
}

/**
 * Android push registration via FCM. Requests permission, gets the device's
 * FCM token (getDevicePushTokenAsync), and registers it with the backend
 * (POST /notifications/token) — the same /notifications endpoints web uses,
 * so the existing firebase-admin sender delivers to this device. The token is
 * cached locally so the toggle reflects state and can unregister later.
 *
 * Requires a real build (dev-client or production) — Expo Go cannot obtain an
 * FCM device token.
 */
export function useMobilePush(): MobilePush {
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then((t) => setRegistered(!!t))
      .catch(() => {});
  }, []);

  const register = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted') {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== 'granted') {
        throw new Error('Notifications permission was denied.');
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const { data: token } = await Notifications.getDevicePushTokenAsync();
      await api.post('/notifications/token', {
        token,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? undefined,
      });
      await AsyncStorage.setItem(TOKEN_KEY, token);
      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable notifications.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const unregister = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        await api.delete('/notifications/token', { body: { token } });
        await AsyncStorage.removeItem(TOKEN_KEY);
      }
      setRegistered(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable notifications.');
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { registered, busy, error, register, unregister };
}
