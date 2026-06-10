import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { api } from '@festie/shared/services';

const TOKEN_KEY = 'festie-push-token';

// Show a banner for notifications that arrive while the app is foregrounded.
// Time-critical local set reminders (scheduled with sound:true + data.kind
// 'local-set-reminder') must still CHIME when foregrounded — the user may be on
// another screen and the set is about to start. Everything else stays silent
// in-app to avoid interrupting active use. (R4: the old blanket
// shouldPlaySound:false muted reminders even when they mattered.)
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isSetReminder = notification.request?.content?.data?.kind === 'local-set-reminder';
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: isSetReminder,
      shouldSetBadge: false,
    };
  },
});

/**
 * Ensure the Android channels exist. Idempotent — safe to call on every mount.
 *
 * DC7: 'updates' has been split into two channels so users can tune them
 * independently in Android system settings:
 *   - 'set-reminders' (HIGH)   — on-device local set alarms (time-critical).
 *   - 'crew' (DEFAULT)          — FCM crew activity (member actions, SOS etc.).
 *
 * The legacy 'updates' channel is kept so existing scheduled local
 * notifications (that still carry channelId='updates') land on a valid
 * channel during the transition — it can be removed once all devices have
 * received a build with the new channels.
 */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  // DC7 split: personal set reminders get their own HIGH-importance channel.
  await Notifications.setNotificationChannelAsync('set-reminders', {
    name: 'Set reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
  // DC7 split: crew activity (member updates, status changes, etc.).
  await Notifications.setNotificationChannelAsync('crew', {
    name: 'Crew updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  // Transition channel: keep until all devices have received a build with the
  // new channels above. Previously bundled set reminders + crew updates.
  await Notifications.setNotificationChannelAsync('updates', {
    name: 'Set reminders & crew updates (legacy)',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

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
      // Intentional best-effort: this only seeds the toggle's initial state from
      // the cached token. A storage-read miss just defaults to not-registered —
      // not worth a Sentry event.
      .catch(() => {});
    // Create/upgrade channels on mount so already-registered users (who won't
    // re-run register) get the correct 'updates' HIGH channel after this update.
    // A failure here means reminders/crew updates arrive silently or at the wrong
    // importance — a real, user-visible problem worth reporting.
    ensureAndroidChannels().catch((e) => Sentry.captureException(e));
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

      await ensureAndroidChannels();

      const { data: token } = await Notifications.getDevicePushTokenAsync();
      await api.post('/notifications/token', {
        token,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? undefined,
      });
      await AsyncStorage.setItem(TOKEN_KEY, token);
      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enable notifications. Try again.");
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
      setError(err instanceof Error ? err.message : "Couldn't disable notifications. Try again.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { registered, busy, error, register, unregister };
}
