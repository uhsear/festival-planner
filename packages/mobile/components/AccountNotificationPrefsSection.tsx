import { useEffect, useRef, useState } from 'react';
import { View, Text, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useNotificationPrefsStore, useFestivalStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import { Skeleton } from './Skeleton';
import { formatQuietHours } from '../lib/accountFormat';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

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
  const haptics = useHaptics();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  // Auth gate: /notifications/topics is an authenticated endpoint, and this
  // section can be mounted eagerly (NativeTabs pre-renders the Account tab).
  // A guest fetch here 401s for nothing.
  const user = useAuthStore((s) => s.user);
  // Festival topics are member-scoped. An authenticated user may browse a
  // public festival without joining it; calling this endpoint then always
  // returns 403 and previously rendered a permanent settings error.
  const festivalId =
    user && currentFestival && currentProfile?.festivalId === currentFestival.id ? currentFestival.id : null;

  // null = not yet resolved (renders a skeleton); the real subscription state
  // loads on mount. We no longer assume "subscribed" before the GET lands — a
  // failed/in-flight load must not masquerade as a confirmed opt-in.
  const [subs, setSubs] = useState<TopicSubscriptions | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    // Re-resolve when the festival changes: clear stale state back to loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine data-fetch side effect: reset to the loading state before the async GET /notifications/topics keyed on festivalId; tracks the in-flight request, not render inputs.
    setSubs(null);
    setError(false);
    api
      .get<TopicSubscriptions>(`/notifications/topics/${encodeURIComponent(festivalId)}`)
      .then((data) => {
        if (cancelled) return;
        setSubs({ crew: data.crew !== false, schedule: data.schedule !== false });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  if (!currentFestival || !festivalId) return null;

  const setTopic = (topic: keyof TopicSubscriptions, value: boolean) => {
    haptics.select();
    setSubs((s) => (s ? { ...s, [topic]: value } : s));
    api.put(`/notifications/topics/${encodeURIComponent(festivalId)}`, { [topic]: value }).catch(() => {
      // Roll back ONLY the key we mutated, not a full snapshot — a snapshot
      // would clobber a concurrent toggle of the other topic.
      setSubs((s) => (s ? { ...s, [topic]: !value } : s));
      Alert.alert('Update failed', "Couldn't update notification setting. Try again.");
    });
  };

  const rows: { key: keyof TopicSubscriptions; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'crew', title: 'Crew updates', icon: 'people-outline' },
    { key: 'schedule', title: 'Schedule changes', icon: 'calendar-outline' },
  ];

  return (
    <>
      <View style={styles.subHeader}>
        <Text style={styles.subHeaderText} numberOfLines={1}>
          For {currentFestival.name}
        </Text>
      </View>
      {/* Skeleton until the subscription state resolves so the switches never
          show a guessed "on" before the GET confirms it. */}
      {subs === null ? (
        error ? (
          <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={14} color={t.colors.text.danger} style={styles.errorIcon} />
            <Text style={styles.errorText}>Couldn’t load festival settings.</Text>
          </View>
        ) : (
          <View style={styles.skeleton}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.skelRow}>
                <Skeleton width={140} height={14} radius={t.radii.xs} />
                <Skeleton width={40} height={22} radius={t.radii.pill} />
              </View>
            ))}
          </View>
        )
      ) : (
        rows.map((r) => (
        <View key={r.key} style={styles.row}>
          <View style={styles.rowIcon}>
            <Ionicons name={r.icon} size={18} color={t.colors.text.secondary} />
          </View>
          <Text style={styles.rowTitle}>{r.title}</Text>
          <Switch
            value={subs[r.key]}
            onValueChange={(v) => setTopic(r.key, v)}
            trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
            thumbColor={t.colors.text.onAccent}
            accessibilityLabel={`${r.title} for ${currentFestival.name}`}
          />
        </View>
        ))
      )}
    </>
  );
}

export default function AccountNotificationPrefsSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loaded = useNotificationPrefsStore((s) => s.loaded);
  const isLoading = useNotificationPrefsStore((s) => s.isLoading);
  const storeError = useNotificationPrefsStore((s) => s.error);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);

  useEffect(() => {
    // Auth gate: /notifications/prefs 401s for guests (section can be mounted
    // eagerly by NativeTabs even when the user never opens Account).
    if (!user) return;
    loadPrefs().catch(() => {});
  }, [user, loadPrefs]);

  // Remember the last real DND window so toggling quiet hours OFF (which nulls
  // the bounds) then back ON restores the user's own window instead of forcing
  // the 23:00/08:00 default.
  const lastWindow = useRef<{ start: string; end: string }>({ start: QUIET_START, end: QUIET_END });
  useEffect(() => {
    if (prefs.dndStart && prefs.dndEnd) {
      lastWindow.current = { start: prefs.dndStart, end: prefs.dndEnd };
    }
  }, [prefs.dndStart, prefs.dndEnd]);

  if (!user) return null;

  const quietOn = !!prefs.dndStart;
  // Caption reflects the actual stored window, not a hardcoded "11 PM – 8 AM"
  // that lies for any custom window. When off there is no stored window, so we
  // show a generic line (the remembered window lives in a ref, read only in the
  // toggle handler — never during render).
  const quietCaption = formatQuietHours(prefs.dndStart, prefs.dndEnd);
  const set = (patch: Parameters<typeof updatePrefs>[0]) => {
    haptics.select();
    updatePrefs(patch).catch(() => {});
  };

  const rows: {
    key: keyof typeof prefs;
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    value: boolean;
    onChange: (v: boolean) => void;
  }[] = [
    {
      key: 'setReminders',
      title: 'Set reminders',
      icon: 'alarm-outline',
      value: prefs.setReminders,
      onChange: (v) => set({ setReminders: v }),
    },
    {
      key: 'crewUpdates',
      title: 'Crew updates',
      icon: 'people-outline',
      value: prefs.crewUpdates,
      onChange: (v) => set({ crewUpdates: v }),
    },
    {
      key: 'scheduleChanges',
      title: 'Schedule changes',
      icon: 'calendar-outline',
      value: prefs.scheduleChanges,
      onChange: (v) => set({ scheduleChanges: v }),
    },
    {
      key: 'lineupDrops',
      title: 'New lineups',
      icon: 'megaphone-outline',
      value: prefs.lineupDrops,
      onChange: (v) => set({ lineupDrops: v }),
    },
    {
      key: 'crewReformed',
      title: 'Crew re-forms',
      icon: 'refresh-outline',
      value: prefs.crewReformed,
      onChange: (v) => set({ crewReformed: v }),
    },
    {
      key: 'wrapReady',
      title: 'Wrap-up ready',
      icon: 'sparkles-outline',
      value: prefs.wrapReady,
      onChange: (v) => set({ wrapReady: v }),
    },
  ];

  // Until the first load resolves, the switches would show defaults (all on)
  // which is a quiet lie — render a skeleton instead so toggles reflect truth.
  const showSkeleton = !loaded && isLoading;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="options-outline" size={18} color={t.colors.text.secondary} />
        <Text style={styles.headerText}>Notification types</Text>
      </View>

      {showSkeleton ? (
        <View style={styles.skeleton}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skelRow}>
              <Skeleton width={140} height={14} radius={t.radii.xs} />
              <Skeleton width={40} height={22} radius={t.radii.pill} />
            </View>
          ))}
        </View>
      ) : (
        <>
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name={r.icon} size={18} color={r.value ? t.colors.accent.aqua : t.colors.text.secondary} />
              </View>
              <Text style={styles.rowTitle}>{r.title}</Text>
              <Switch
                value={r.value}
                onValueChange={r.onChange}
                trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
                thumbColor={t.colors.text.onAccent}
                accessibilityLabel={r.title}
                accessibilityState={{ checked: r.value }}
              />
            </View>
          ))}

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="moon-outline" size={18} color={quietOn ? t.colors.accent.aqua : t.colors.text.secondary} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Quiet hours</Text>
              <Text style={styles.rowHint}>
                {quietOn && quietCaption
                  ? `Mutes everything ${quietCaption}`
                  : 'Mutes notifications during your chosen window'}
              </Text>
            </View>
            <Switch
              value={quietOn}
              onValueChange={(v) =>
                set(
                  v
                    ? { dndStart: lastWindow.current.start, dndEnd: lastWindow.current.end }
                    : { dndStart: null, dndEnd: null },
                )
              }
              trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
              thumbColor={t.colors.text.onAccent}
              accessibilityLabel="Quiet hours"
              accessibilityState={{ checked: quietOn }}
            />
          </View>

          <FestivalTopicsRows />

          {storeError ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle-outline" size={14} color={t.colors.text.danger} style={styles.errorIcon} />
              <Text style={styles.errorText}>{storeError}</Text>
            </View>
          ) : null}
        </>
      )}
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
    paddingBottom: t.spacing[2],
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
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 52,
  },
  rowIcon: {
    width: 22,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  subHeader: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    paddingBottom: t.spacing[1],
    marginTop: t.spacing[1],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  subHeaderText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textTransform: 'uppercase',
  },
  skeleton: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[2],
    gap: t.spacing[3],
  },
  skelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: t.spacing[2],
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[2],
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
