import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore, useFestivalModeStore } from '@festie/shared/stores';
import { timeAgoFromIso } from '@festie/shared/utils';
import { CREW_ACTIVITY_LABELS } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

interface CrewActivityProps {
  crewId: string;
}

// How many events show before the "Show more" expander. Keeps the feed tidy
// (and cheap to render) on a long-running crew without hiding history.
const COLLAPSED_LIMIT = 8;

type IconName = keyof typeof Ionicons.glyphMap;
type Tint = 'aqua' | 'green' | 'coral' | 'amber' | 'muted';

// Map each crew event type to a scannable icon + tint, so the feed reads at a
// glance (join vs. spend vs. removal) instead of a wall of identical avatars.
// Tints stay within the documented accent rule: coral = removal/danger only,
// green = positive/settled, aqua = neutral crew action, amber = config change.
const ACTIVITY_VISUAL: Record<string, { icon: IconName; tint: Tint }> = {
  'member-joined': { icon: 'person-add', tint: 'green' },
  'member-left': { icon: 'exit-outline', tint: 'muted' },
  'member-kicked': { icon: 'person-remove', tint: 'coral' },
  'poll-created': { icon: 'bar-chart', tint: 'aqua' },
  'poll-voted': { icon: 'checkmark-circle-outline', tint: 'aqua' },
  'expense-added': { icon: 'cash-outline', tint: 'aqua' },
  'expense-deleted': { icon: 'trash-outline', tint: 'coral' },
  'expense-settled': { icon: 'checkmark-done', tint: 'green' },
  'home-base-updated': { icon: 'home-outline', tint: 'aqua' },
  'meeting-point-added': { icon: 'location', tint: 'aqua' },
  'meeting-point-removed': { icon: 'location-outline', tint: 'muted' },
  'crew-updated': { icon: 'create-outline', tint: 'amber' },
};

const FALLBACK_VISUAL = { icon: 'ellipse-outline' as IconName, tint: 'muted' as Tint };

/**
 * Crew activity feed — chronological log of crew events. Polls every 30s so
 * new events appear without socket wiring (mirrors the web ActivityTab). Reads
 * from the shared crewStore; the initial load is kicked off here on mount.
 *
 * Each row carries a typed icon badge (join / spend / poll / removal …) so the
 * feed is scannable at a glance, and collapses past COLLAPSED_LIMIT behind a
 * "Show more" toggle to stay tidy on a long-running crew.
 */
export default function CrewActivity({ crewId }: CrewActivityProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const activity = useCrewStore((s) => s.activity);
  const loadActivity = useCrewStore((s) => s.loadActivity);
  // Festival low-power mode slows the background refresh to save battery; the
  // feed still loads once on mount / crew-change, just polls far less often.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!crewId) return;
    loadActivity(crewId).catch(() => {});
    const intervalMs = lowPowerMode ? 120_000 : 30_000;
    const interval = setInterval(() => {
      loadActivity(crewId).catch(() => {});
    }, intervalMs);
    return () => clearInterval(interval);
  }, [crewId, loadActivity, lowPowerMode]);

  // Collapse back to the short view whenever the crew changes, so switching
  // crews never strands the feed in a stale expanded state. Render-time
  // previous-value idiom (matches the crew screen) — no setState-in-effect.
  const [prevCrewId, setPrevCrewId] = useState(crewId);
  if (crewId !== prevCrewId) {
    setPrevCrewId(crewId);
    setExpanded(false);
  }

  // Deduplicate by id — the polling interval can produce duplicate entries if the
  // server returns overlapping pages or the store accumulates repeated loads.
  const dedupedActivity = Array.from(new Map(activity.map((a) => [a.id, a])).values());

  if (dedupedActivity.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Ionicons name="pulse-outline" size={20} color={t.colors.text.muted} />
        <Text style={styles.empty}>No activity yet — crew events will appear here as they happen.</Text>
      </View>
    );
  }

  const hasMore = dedupedActivity.length > COLLAPSED_LIMIT;
  const visible = expanded ? dedupedActivity : dedupedActivity.slice(0, COLLAPSED_LIMIT);
  const tintColor: Record<Tint, string> = {
    aqua: t.colors.accent.aqua,
    green: t.colors.accent.green,
    coral: t.colors.accent.coral,
    amber: t.colors.accent.amber,
    muted: t.colors.text.muted,
  };

  return (
    <View style={styles.container}>
      {visible.map((it, idx) => {
        const verb = CREW_ACTIVITY_LABELS[it.type] ?? it.type.replace(/-/g, ' ');
        const visual = ACTIVITY_VISUAL[it.type] ?? FALLBACK_VISUAL;
        const color = tintColor[visual.tint];
        // R22 staggered reveal — cap the stagger so a full page never feels slow;
        // gated on reduce-motion (a plain View = instant).
        const entering = reduceMotion ? undefined : FadeInDown.delay(Math.min(idx, 9) * 30).duration(220);
        return (
          <Animated.View key={it.id} entering={entering} style={styles.row}>
            <View style={[styles.iconBadge, { borderColor: color }]}>
              <Ionicons name={visual.icon} size={14} color={color} />
            </View>
            <View style={styles.info}>
              <Text style={styles.line}>
                <Text style={styles.name}>{it.username || 'Someone'}</Text> <Text style={styles.verb}>{verb}</Text>
                {it.detail ? <Text style={styles.verb}>: {it.detail}</Text> : null}
              </Text>
              <Text style={styles.time}>{timeAgoFromIso(it.created_at)}</Text>
            </View>
          </Animated.View>
        );
      })}

      {hasMore ? (
        <TouchableOpacity
          style={styles.moreButton}
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? 'Show fewer activity events' : `Show all ${dedupedActivity.length} activity events`
          }
        >
          <Text style={styles.moreText}>
            {expanded ? 'Show less' : `Show ${dedupedActivity.length - COLLAPSED_LIMIT} more`}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[2],
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flex: 1,
  },
  emptyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  // Typed icon badge — a circular tinted ring keyed to the event category. The
  // border carries the tint (set inline) so the fill stays a calm neutral.
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.input,
  },
  info: {
    flex: 1,
    gap: t.spacing[1],
  },
  line: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  name: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  verb: {
    color: t.colors.text.secondary,
  },
  time: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  moreText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
}));
