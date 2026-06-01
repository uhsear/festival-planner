import { useEffect } from 'react';
import { View, Text, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotificationPrefsStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Per-category notification preferences (crew / set reminders / schedule) plus
 * a quiet-hours toggle, wired to GET/PUT /notifications/prefs via the shared
 * notificationPrefs store. These gate which FCM sends the server delivers, so
 * a user can keep time-critical set reminders while silencing 3am crew noise.
 * Quiet hours maps to the backend DND window (23:00–08:00 when on).
 */
const QUIET_START = '23:00';
const QUIET_END = '08:00';

export default function AccountNotificationPrefsSection() {
  const t = useTokens();
  const styles = useStyles();
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);

  useEffect(() => {
    loadPrefs().catch(() => {});
  }, [loadPrefs]);

  const quietOn = !!prefs.dndStart;

  const rows: { key: keyof typeof prefs; title: string; value: boolean; onChange: (v: boolean) => void }[] = [
    {
      key: 'setReminders',
      title: 'Set reminders',
      value: prefs.setReminders,
      onChange: (v) => updatePrefs({ setReminders: v }).catch(() => {}),
    },
    {
      key: 'crewUpdates',
      title: 'Crew updates',
      value: prefs.crewUpdates,
      onChange: (v) => updatePrefs({ crewUpdates: v }).catch(() => {}),
    },
    {
      key: 'scheduleChanges',
      title: 'Schedule changes',
      value: prefs.scheduleChanges,
      onChange: (v) => updatePrefs({ scheduleChanges: v }).catch(() => {}),
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="options-outline" size={18} color={t.colors.text.secondary} />
        <Text style={styles.headerText}>Notification types</Text>
      </View>
      {rows.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.rowTitle}>{r.title}</Text>
          <Switch
            value={r.value}
            onValueChange={r.onChange}
            trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
            thumbColor={t.colors.text.onAccent}
          />
        </View>
      ))}
      <View style={styles.row}>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Quiet hours</Text>
          <Text style={styles.rowHint}>Mute 11pm–8am</Text>
        </View>
        <Switch
          value={quietOn}
          onValueChange={(v) =>
            updatePrefs(v ? { dndStart: QUIET_START, dndEnd: QUIET_END } : { dndStart: null, dndEnd: null }).catch(
              () => {},
            )
          }
          trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
          thumbColor={t.colors.text.onAccent}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    paddingBottom: t.spacing[1],
  },
  headerText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 52,
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
