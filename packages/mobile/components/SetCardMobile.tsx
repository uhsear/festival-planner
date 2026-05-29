import { useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, artistSubtitle } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

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
}

/** Priority button definitions: value, icon, and human label. */
const PRIORITIES: ReadonlyArray<{
  value: Priority;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { value: 'must', icon: 'star', label: 'Must See' },
  { value: 'want-to-see', icon: 'heart', label: 'Want to See' },
  { value: 'maybe', icon: 'ellipse', label: 'Maybe' },
];

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
  const accent = priorityColor(t, option.value);
  return (
    <TouchableOpacity
      style={[
        styles.priorityButton,
        active && { backgroundColor: accent, borderColor: accent },
      ]}
      onPress={() => onPress(active ? null : option.value)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? `${option.label} (selected)` : option.label}
    >
      <Ionicons
        name={option.icon}
        size={16}
        color={active ? t.colors.text.onLightAccent : t.colors.text.muted}
      />
    </TouchableOpacity>
  );
}

/**
 * The festival set card for mobile — a presentational mirror of the web
 * SetCard. Shows artist/b2b name + subtitle, a stage-colored pill, the start–end
 * time, a conflict indicator, and a 3-level priority picker. All data and
 * callbacks come from the parent; this component holds no state.
 */
export default function SetCardMobile({
  set,
  stageName,
  stageColor,
  myPick,
  onPickChange,
  onPress,
  hasConflict = false,
}: SetCardMobileProps) {
  const t = useTokens();
  const styles = useStyles();

  const artistName = artistDisplayName(set);
  const subtitle = artistSubtitle(set);
  const timeLabel =
    set.startTime && set.endTime
      ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}`
      : 'TBA';

  const handlePick = useCallback(
    (priority: Priority | null) => onPickChange(priority),
    [onPickChange],
  );

  // The tappable card body and the priority footer are SIBLINGS inside a plain
  // <View> card — never parent/child touchables. On react-native-web a nested
  // TouchableOpacity renders button-in-button (invalid DOM) and the parent
  // onPress also fires when a priority button is tapped. Keeping them siblings
  // means: (a) valid DOM on web, (b) the body opens detail, (c) the priority
  // buttons stay independently tappable and don't bubble to onPress.
  return (
    <View style={[styles.card, { borderLeftColor: stageColor }]}>
      <TouchableOpacity
        style={styles.body}
        onPress={onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${artistName}, ${stageName}, ${timeLabel}`}
      >
        <View style={[styles.stagePill, { backgroundColor: stageColor }]}>
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
          {hasConflict ? (
            <View style={styles.conflictBadge}>
              <Ionicons
                name="warning"
                size={12}
                color={t.colors.accent.coral}
              />
              <Text style={styles.conflictText}>Conflict</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>

      <View style={styles.footer}>
        {PRIORITIES.map((option) => (
          <PriorityButton
            key={option.value}
            option={option}
            active={myPick === option.value}
            onPress={handlePick}
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderLeftWidth: 4,
    padding: t.spacing[4],
    gap: t.spacing[1],
  },
  body: {
    gap: t.spacing[1],
  },
  stagePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
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
    gap: t.spacing[3],
    marginTop: t.spacing[1],
  },
  priorityButton: {
    width: 40,
    height: 40,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
}));
