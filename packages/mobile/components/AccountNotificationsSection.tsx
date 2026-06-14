import { View, Text, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMobilePush } from '../hooks/useMobilePush';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Push-notification toggle for the Account screen. Flips FCM registration on/off
 * via useMobilePush (POST/DELETE /notifications/token). Requires a real build —
 * in Expo Go getDevicePushTokenAsync fails, surfaced as an alert.
 */
export default function AccountNotificationsSection() {
  const t = useTokens();
  const styles = useStyles();
  const { registered, busy, register, unregister } = useMobilePush();

  const onToggle = async (next: boolean) => {
    try {
      if (next) await register();
      else await unregister();
    } catch (err) {
      Alert.alert('Notifications', err instanceof Error ? err.message : 'Could not update notifications.');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="notifications-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Push Notifications</Text>
          <Text style={styles.rowHint} numberOfLines={1}>
            Set reminders & crew updates on this device
          </Text>
        </View>
        <Switch
          value={registered}
          onValueChange={onToggle}
          disabled={busy}
          trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
          thumbColor={t.colors.text.onAccent}
          accessibilityLabel="Push notifications"
        />
      </View>
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
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
