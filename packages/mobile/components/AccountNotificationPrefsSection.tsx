import { useEffect, useState } from 'react';
import { View, Text, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNotificationPrefsStore, useFestivalStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
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

type TopicSubscriptions = { crew: boolean; schedule: boolean };

/**
 * Per-festival notification opt-out, scoped to the currently selected festival.
 * Toggling a topic OFF mutes that topic's push for this festival via
 * GET/PUT /notifications/topics/:festivalId (topics: crew, schedule). Defaults
 * to ON before load; the real subscription state loads on mount. Renders
 * nothing until a current festival is selected.
 */
function FestivalTopicsRows() {
  const styles = useStyles();
  const t = useTokens();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalId = currentFestival?.id ?? null;

  // Default to ON (subscribed) before the real state loads.
  const [subs, setSubs] = useState<TopicSubscriptions>({ crew: true, schedule: true });

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    api
      .get<TopicSubscriptions>(`/notifications/topics/${encodeURIComponent(festivalId)}`)
      .then((data) => {
        if (cancelled) return;
        setSubs({ crew: data.crew !== false, schedule: data.schedule !== false });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  if (!currentFestival || !festivalId) return null;

  const setTopic = (topic: keyof TopicSubscriptions, value: boolean) => {
    const prev = subs;
    setSubs((s) => ({ ...s, [topic]: value }));
    api.put(`/notifications/topics/${encodeURIComponent(festivalId)}`, { [topic]: value }).catch(() => {
      setSubs(prev);
      Alert.alert('Update failed', "Couldn't update notification setting. Try again.");
    });
  };

  const rows: { key: keyof TopicSubscriptions; title: string }[] = [
    { key: 'crew', title: 'Crew updates' },
    { key: 'schedule', title: 'Schedule changes' },
  ];

  return (
    <>
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderText} numberOfLines={1}>
          Notifications for {currentFestival.name}
        </Text>
      </View>
      {rows.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={styles.rowTitle}>{r.title}</Text>
          <Switch
            value={subs[r.key]}
            onValueChange={(v) => setTopic(r.key, v)}
            trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
            thumbColor={t.colors.text.onAccent}
          />
        </View>
      ))}
    </>
  );
}

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
    {
      key: 'lineupDrops',
      title: 'New lineups',
      value: prefs.lineupDrops,
      onChange: (v) => updatePrefs({ lineupDrops: v }).catch(() => {}),
    },
    {
      key: 'crewReformed',
      title: 'Crew re-forms',
      value: prefs.crewReformed,
      onChange: (v) => updatePrefs({ crewReformed: v }).catch(() => {}),
    },
    {
      key: 'wrapReady',
      title: 'Wrap-up ready',
      value: prefs.wrapReady,
      onChange: (v) => updatePrefs({ wrapReady: v }).catch(() => {}),
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
      <FestivalTopicsRows />
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
  subHeader: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    paddingBottom: t.spacing[1],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  subHeaderText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
