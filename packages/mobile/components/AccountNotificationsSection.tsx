import { View, Text, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMobilePush } from '../hooks/useMobilePush';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Push-notification toggle for the Account screen. Flips FCM registration on/off
 * via useMobilePush (POST/DELETE /notifications/token). Requires a real build —
 * in Expo Go getDevicePushTokenAsync fails, surfaced as an alert.
 */
export default function AccountNotificationsSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { registered, busy, error, register, unregister } = useMobilePush();

  const onToggle = async (next: boolean) => {
    haptics.select();
    try {
      if (next) await register();
      else await unregister();
    } catch (err) {
      haptics.warning();
      Alert.alert('Notifications', err instanceof Error ? err.message : 'Could not update notifications.');
    }
  };

  const hint = busy
    ? registered
      ? 'Turning off…'
      : 'Turning on…'
    : registered
      ? 'Active on this device'
      : 'Set reminders & crew updates on this device';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons
            name={registered ? 'notifications' : 'notifications-outline'}
            size={20}
            color={registered ? t.colors.accent.aqua : t.colors.text.secondary}
          />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Push Notifications</Text>
          <View style={styles.hintRow}>
            {registered && !busy ? <View style={styles.dot} /> : null}
            <Text style={styles.rowHint} numberOfLines={1}>
              {hint}
            </Text>
          </View>
        </View>
        <Switch
          value={registered}
          onValueChange={(v) => void onToggle(v)}
          disabled={busy}
          trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
          thumbColor={t.colors.text.onAccent}
          accessibilityLabel="Push notifications"
          accessibilityState={{ disabled: busy, checked: registered }}
        />
      </View>

      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={14} color={t.colors.text.danger} style={styles.errorIcon} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
    paddingBottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.green,
    marginRight: t.spacing[2],
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
  errorIcon: {
    marginRight: t.spacing[1],
  },
  errorText: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    flexShrink: 1,
  },
}));
