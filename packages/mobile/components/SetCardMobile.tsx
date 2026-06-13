import { memo, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, artistSubtitle, ensureWhiteContrast } from '@festie/shared/utils';
import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { duration, easing } from '@festie/shared/tokens';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useSetStatus } from '../hooks/useSetStatus';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import AppPressable from './AppPressable';
import Avatar from './Avatar';
import LiveBadge from './LiveBadge';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A single crew member's pick, used to render the "who's going" avatars. */
export interface FriendProfile {
  profileId?: string;
  name?: string;
  avatarUrl?: string | null;
  priority: Priority;
  color?: string;
  initials?: string;
}

interface SetCardMobileProps {
  /** The set to render. */
  set: FestivalSet;
  /** Stage label shown in the colored pill. */
  stageName: string;
  /** Stage accent color (hex/hsl); drives the left border + pill background. */
  stageColor: string;
  /** Current user's pick for this set, or null/undefined if not picked. */
  myPick: Priority | null | undefined;
  /**
   * Called when a priority button is tapped. Receives the new priority, or
   * null when the user taps the already-active priority (toggle off). Parent
   * owns persistence (e.g. via usePicks().savePick).
   */
  onPickChange: (priority: Priority | null) => void;
  /** Called when the card body is tapped (open detail). */
  onPress: () => void;
  /** When true, shows the conflict warning indicator. */
  hasConflict?: boolean;
  /** When true, shows a small "has note" indicator next to the time. */
  hasNote?: boolean;
  /**
   * Crew members (other than the current user) who have this set picked.
   * Renders an overlapping avatar cluster + "+N" overflow in the footer,
   * mirroring the web SetCard. Optional — omit to hide the cluster entirely.
   */
  friendProfiles?: FriendProfile[];
}

/**
 * Priority button definitions: value, icon, full a11y label, and the short
 * visible label shown on the card control (icon + word — the icon alone was
 * ambiguous; color + word makes the priority tier legible at a glance).
 */
const PRIORITIES: readonly {
  value: Priority;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  short: string;
}[] = [
  { value: 'must', icon: 'star', label: 'Must See', short: 'Must' },
  { value: 'want-to-see', icon: 'heart', label: 'Want to See', short: 'Want' },
  { value: 'maybe', icon: 'ellipse', label: 'Maybe', short: 'Maybe' },
];

// Crew-overlap avatars cluster by priority: must first, then want, then maybe.
const PRIORITY_RANK: Record<Priority, number> = {
  must: 0,
  'want-to-see': 1,
  maybe: 2,
};

const PRIORITY_NOUN: Record<Priority, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

/**
 * Build the "N must, N want" breakdown phrase for the crew-overlap accessibility
 * label. Empty groups are dropped; an all-empty list yields ''.
 */
function buildOverlapBreakdown(friends: readonly { priority: Priority }[]): string {
  const counts: Record<Priority, number> = {
    must: 0,
    'want-to-see': 0,
    maybe: 0,
  };
  for (const f of friends) counts[f.priority] = (counts[f.priority] ?? 0) + 1;
  return (['must', 'want-to-see', 'maybe'] as const)
    .filter((p) => counts[p] > 0)
    .map((p) => `${counts[p]} ${PRIORITY_NOUN[p]}`)
    .join(', ');
}

/** Maps a priority to its accent token for active styling. */
function priorityColor(t: ReturnType<typeof useTokens>, p: Priority): string {
  if (p === 'must') return t.colors.priority.must;
  if (p === 'want-to-see') return t.colors.priority.want;
  return t.colors.priority.maybe;
}

interface PriorityButtonProps {
  option: (typeof PRIORITIES)[number];
  active: boolean;
  onPress: (priority: Priority | null) => void;
}

function PriorityButton({ option, active, onPress }: PriorityButtonProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();
  const accent = priorityColor(t, option.value);

  // DC21: the pick is the product's core loop — confirm it with a scale pop +
  // color timing instead of an instant style flip. `progress` (0→1) drives the
  // fill/border interpolation; `scale` pops on each activation. Both honor
  // Reduce Motion: progress jumps instantly and the pop is skipped.
  const progress = useSharedValue(active ? 1 : 0);
  const scale = useSharedValue(1);

  useEffect(() => {
    progress.value = reduceMotion
      ? active
        ? 1
        : 0
      : withTiming(active ? 1 : 0, {
          duration: duration.fast,
          easing: Easing.bezier(...easing.standard.bezier),
        });
  }, [active, reduceMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const bg = interpolateColor(progress.value, [0, 1], [t.colors.overlay[3], accent]);
    const border = interpolateColor(progress.value, [0, 1], [t.colors.border.light, accent]);
    return {
      backgroundColor: bg,
      borderColor: border,
      transform: [{ scale: scale.value }],
    };
  });

  const handlePress = useCallback(() => {
    // Taptic feedback on iOS (selectionAsync), tuned Vibration on Android —
    // additive on the existing handler; the no-op fallback keeps picks
    // working on devices without a vibrator/Taptic Engine.
    haptics.select();
    // Scale pop only when ACTIVATING (not when toggling off) — the celebration
    // is for committing to a pick. Skipped under Reduce Motion.
    if (!active && !reduceMotion) {
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value
      scale.value = withSequence(
        withTiming(1.12, { duration: duration.fast, easing: Easing.bezier(...easing.out.bezier) }),
        withTiming(1, { duration: duration.med, easing: Easing.bezier(...easing.spring.bezier) }),
      );
    }
    onPress(active ? null : option.value);
  }, [haptics, active, reduceMotion, scale, onPress, option.value]);

  // Small control → ripple on Android, opacity fade on iOS/web (matching the
  // AppPressable convention), applied directly so the Reanimated fill/scale
  // style can ride on an animated component.
  const android_ripple = Platform.OS === 'android' ? { color: t.colors.overlay[4], borderless: false } : undefined;

  return (
    <AnimatedPressable
      style={({ pressed }) => [
        styles.priorityButton,
        animatedStyle,
        Platform.OS !== 'android' && pressed ? { opacity: 0.7 } : null,
      ]}
      onPress={handlePress}
      android_ripple={android_ripple}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? `${option.label} (selected)` : option.label}
    >
      {/* DC25: 15 is off-grid; snap to iconSize.sm (16). */}
      <Ionicons name={option.icon} size={16} color={active ? t.colors.text.onLightAccent : accent} />
      <Text
        style={[styles.priorityLabel, { color: active ? t.colors.text.onLightAccent : t.colors.text.secondary }]}
        numberOfLines={1}
      >
        {option.short}
      </Text>
    </AnimatedPressable>
  );
}

/**
 * The festival set card for mobile — a presentational mirror of the web
 * SetCard. Shows artist/b2b name + subtitle, a stage-colored pill, the start–end
 * time, a conflict indicator, and a 3-level priority picker. All data and
 * callbacks come from the parent; this component holds no state.
 */
function SetCardMobileImpl({
  set,
  stageName,
  stageColor,
  myPick,
  onPickChange,
  onPress,
  hasConflict = false,
  hasNote = false,
  friendProfiles,
}: SetCardMobileProps) {
  const t = useTokens();
  const styles = useStyles();
  const setStatus = useSetStatus(set);

  const artistName = artistDisplayName(set);
  const subtitle = artistSubtitle(set);
  const timeLabel = set.startTime && set.endTime ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}` : 'TBA';

  // The stage pill renders white (onAccent) text on the stage color, so darken
  // the fill just enough for that text to clear WCAG AA (see shared
  // ensureWhiteContrast). The card's left border keeps the true stage color.
  const pillBg = useMemo(() => ensureWhiteContrast(stageColor), [stageColor]);

  const handlePick = useCallback((priority: Priority | null) => onPickChange(priority), [onPickChange]);

  // The tappable card body and the priority footer are SIBLINGS inside a plain
  // <View> card — never parent/child touchables. On react-native-web a nested
  // TouchableOpacity renders button-in-button (invalid DOM) and the parent
  // onPress also fires when a priority button is tapped. Keeping them siblings
  // means: (a) valid DOM on web, (b) the body opens detail, (c) the priority
  // buttons stay independently tappable and don't bubble to onPress.
  // R19: Apply live state styling when set status is 'live'.
  const isLive = setStatus.status === 'live';
  return (
    <View style={[styles.card, { borderLeftColor: stageColor }, isLive && styles.cardLive]}>
      <AppPressable
        style={styles.body}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${artistName}, ${stageName}, ${timeLabel}`}
      >
        <View style={[styles.stagePill, { backgroundColor: pillBg }]}>
          <Text style={styles.stageText} numberOfLines={1}>
            {stageName}
          </Text>
        </View>

        <Text style={styles.artist} numberOfLines={2}>
          {artistName}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={styles.time}>{timeLabel}</Text>
          <LiveBadge status={setStatus.status} label={setStatus.label} />
          {hasNote ? (
            <Ionicons
              name="document-text-outline"
              size={12} // DC25: 13 is off-grid; snap to iconSize.xs (12).
              color={t.colors.text.muted}
              accessibilityLabel="Has note"
            />
          ) : null}
          {hasConflict ? (
            <View style={styles.conflictBadge}>
              <Ionicons name="warning" size={12} color={t.colors.accent.coral} />
              <Text style={styles.conflictText}>Conflict</Text>
            </View>
          ) : null}
        </View>
      </AppPressable>

      <View style={styles.footer}>
        <View style={styles.priorityGroup}>
          {PRIORITIES.map((option) => (
            <PriorityButton key={option.value} option={option} active={myPick === option.value} onPress={handlePick} />
          ))}
        </View>

        {friendProfiles && friendProfiles.length > 0 ? <CrewCluster friendProfiles={friendProfiles} /> : null}
      </View>
    </View>
  );
}

/**
 * Re-render only when the displayed data changes. onPickChange/onPress identity
 * is intentionally ignored: they're inline closures in the list renderer, but
 * their behavior is stable (the row's set.id + the parent's useCallback'd
 * handler), so churn in their identity carries no new information. This keeps a
 * single pick/keystroke from re-rendering every visible card.
 */
function areEqual(prev: SetCardMobileProps, next: SetCardMobileProps): boolean {
  if (
    prev.set !== next.set ||
    prev.stageName !== next.stageName ||
    prev.stageColor !== next.stageColor ||
    prev.myPick !== next.myPick ||
    prev.hasConflict !== next.hasConflict ||
    prev.hasNote !== next.hasNote
  ) {
    return false;
  }
  const a = prev.friendProfiles ?? [];
  const b = next.friendProfiles ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.profileId !== b[i]!.profileId || a[i]!.priority !== b[i]!.priority) return false;
  }
  return true;
}

const SetCardMobile = memo(SetCardMobileImpl, areEqual);
SetCardMobile.displayName = 'SetCardMobile';
export default SetCardMobile;

interface CrewClusterProps {
  friendProfiles: FriendProfile[];
}

/**
 * Overlapping avatar cluster for the crew who picked this set, mirroring the
 * web SetCard footer: up to 3 ringed avatars stacked with negative margin,
 * then a "+N" overflow badge. When no crew identity data is available, falls
 * back to a bare "N going" count pill.
 */
function CrewCluster({ friendProfiles }: CrewClusterProps) {
  const t = useTokens();
  const styles = useStyles();
  // Read-only joins (both already persisted via Foundations F1, so the cluster
  // renders offline): profiles supply profileId -> userId, crew members supply
  // the avatar image. Mirrors the web SetCard.
  const allProfiles = useFestivalStore((s) => s.allProfiles);
  const crewMembers = useCrewStore((s) => s.crewMembers);

  // Enrich (avatar join) + group by priority (must > want > maybe).
  const grouped = useMemo(() => {
    const userIdByProfileId = new Map<string, string>();
    for (const p of allProfiles) userIdByProfileId.set(p.id, p.userId);
    const memberByUserId = new Map<string, (typeof crewMembers)[number]>();
    for (const m of crewMembers) memberByUserId.set(m.userId, m);

    return friendProfiles
      .map((f) => {
        const userId = f.profileId ? userIdByProfileId.get(f.profileId) : undefined;
        const member = userId ? memberByUserId.get(userId) : undefined;
        return {
          ...f,
          avatarUrl: f.avatarUrl ?? null,
          name: f.name ?? member?.name,
        };
      })
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }, [friendProfiles, allProfiles, crewMembers]);

  const visible = grouped.slice(0, 3);
  const overflow = grouped.length - visible.length;
  const hasAvatarData = grouped.some((f) => f.name || f.initials || f.avatarUrl);
  const count = grouped.length;
  const countLabel = count === 1 ? '1 going' : `${count} going`;
  const breakdown = buildOverlapBreakdown(grouped);
  const a11yLabel = `${count} crew ${count === 1 ? 'member' : 'members'} going` + (breakdown ? ` — ${breakdown}` : '');

  if (!hasAvatarData) {
    return (
      <View style={styles.crewCluster} accessibilityRole="text" accessibilityLabel={a11yLabel}>
        <Text style={styles.countPill}>{countLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.crewCluster} accessibilityRole="image" accessibilityLabel={a11yLabel}>
      {visible.map((f, i) => (
        <View key={f.profileId ?? `${f.name ?? 'crew'}-${i}`} style={i > 0 ? styles.avatarOverlap : undefined}>
          <Avatar name={f.name || f.initials || 'Crew'} image={f.avatarUrl} size="xs" borderColor={t.colors.bg.card} />
        </View>
      ))}
      {overflow > 0 ? (
        <View style={[styles.overflowBadge, styles.avatarOverlap]}>
          <Text style={styles.overflowText}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    // R2 hairline: neutral white 0.08 separator (was border.default 0.06).
    borderColor: t.colors.glass.border,
    borderLeftWidth: 4,
    padding: t.spacing[4],
    gap: t.spacing[1],
  },
  // R19: Live state — static 1.5px aqua border. Mobile: static border
  // (no conic-gradient in RN without deps).
  cardLive: {
    borderWidth: 1.5,
    borderColor: t.colors.accent.aqua,
  },
  body: {
    gap: t.spacing[1],
  },
  stagePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    marginBottom: t.spacing[1],
  },
  stageText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
  },
  artist: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  subtitle: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginTop: t.spacing[1],
    marginBottom: t.spacing[2],
  },
  time: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  conflictBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.ring.coral,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
  },
  conflictText: {
    ...typeStyle('micro'),
    color: t.colors.accent.coral,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    marginTop: t.spacing[1],
  },
  priorityGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    flexShrink: 1,
  },
  crewCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarOverlap: {
    marginLeft: -8,
  },
  overflowBadge: {
    width: 24,
    height: 24,
    // Circular badge: radii.pill (999) keeps it a circle at any size (F48).
    borderRadius: t.radii.pill,
    borderWidth: 2,
    borderColor: t.colors.bg.card,
    backgroundColor: t.colors.ring.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    // micro role is weight 600; typeStyle('micro', 700) selects SpaceGrotesk_700Bold (F4).
    ...typeStyle('micro', 700),
    color: t.colors.accent.aqua,
  },
  countPill: {
    ...typeStyle('micro', 700),
    color: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  priorityButton: {
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target — three adjacent,
    // frequently-tapped controls; matches the dayChip/filterChip 44pt floor.
    // Now icon + short label, so width is content-driven (with a 44px floor).
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
    flexShrink: 1,
  },
  priorityLabel: {
    // F4: typeStyle('micro', 700) selects SpaceGrotesk_700Bold instead of the
    // inert raw fontWeight override.
    ...typeStyle('micro', 700),
  },
}));
