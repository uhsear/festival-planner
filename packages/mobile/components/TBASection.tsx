import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  FestivalSet,
  Priority,
  Stage,
  Festival,
  Profile,
} from '@festie/shared/types';
import { artistDisplayName } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import Avatar from './Avatar';

const PRIORITIES: ReadonlyArray<{
  value: Priority;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { value: 'must', icon: 'star', label: 'Must See' },
  { value: 'want-to-see', icon: 'heart', label: 'Want to See' },
  { value: 'maybe', icon: 'ellipse', label: 'Maybe' },
];

type Crew = { profileId: string; priority: Priority; name?: string };

export interface TBASectionProps {
  sets: FestivalSet[];
  stages: Stage[];
  currentProfile: Profile | null;
  currentFestival: Festival | null;
  getMyPick: (setId: string) => Priority | null | undefined;
  getOtherPicks: (setId: string) => Crew[];
  getStageColor: (stageId: string) => string;
  onSavePick: (setId: string, priority: Priority | null) => void;
  onOpenDetail: (set: FestivalSet) => void;
  /** Start expanded (e.g. when the day has no timed sets, so TBA is all there is). */
  defaultExpanded?: boolean;
}

function priorityColor(
  t: ReturnType<typeof useTokens>,
  p: Priority,
): string {
  if (p === 'must') return t.colors.priority.must;
  if (p === 'want-to-see') return t.colors.priority.want;
  return t.colors.priority.maybe;
}

interface TBACardProps {
  set: FestivalSet;
  width: number;
  stageName?: string;
  stageColor?: string;
  myPick: Priority | null | undefined;
  others: Crew[];
  showPicks: boolean;
  onSavePick: (setId: string, priority: Priority | null) => void;
  onOpenDetail: (set: FestivalSet) => void;
  b2bSeparator?: string;
}

function TBACard({
  set,
  width,
  stageName,
  stageColor,
  myPick,
  others,
  showPicks,
  onSavePick,
  onOpenDetail,
  b2bSeparator,
}: TBACardProps) {
  const t = useTokens();
  const styles = useStyles();
  const name = artistDisplayName(set, b2bSeparator);
  const borderLeftColor = myPick
    ? priorityColor(t, myPick)
    : (stageColor ?? t.colors.border.default);

  return (
    <View
      style={[
        styles.card,
        {
          width,
          borderLeftColor,
          backgroundColor: myPick ? t.colors.bg.hover : t.colors.bg.secondary,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.cardBody}
        onPress={() => onOpenDetail(set)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${name}${stageName ? ' at ' + stageName : ''}, time TBA`}
      >
        <Text style={styles.cardArtist} numberOfLines={2}>
          {name}
        </Text>
        {stageName && stageColor ? (
          <View style={[styles.stageBadge, { backgroundColor: stageColor }]}>
            <Text style={styles.stageBadgeText} numberOfLines={1}>
              {stageName}
            </Text>
          </View>
        ) : null}
      </TouchableOpacity>

      {showPicks ? (
        <View style={styles.pickRow}>
          {PRIORITIES.map((option) => {
            const active = myPick === option.value;
            const accent = priorityColor(t, option.value);
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.pickButton,
                  active && { backgroundColor: accent, borderColor: accent },
                ]}
                onPress={() =>
                  onSavePick(set.id, active ? null : option.value)
                }
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  active ? `${option.label} (selected)` : option.label
                }
              >
                <Ionicons
                  name={option.icon}
                  size={13}
                  color={active ? t.colors.text.onLightAccent : t.colors.text.muted}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {others.length > 0 ? (
        <View style={styles.crewRow}>
          {others.slice(0, 3).map((o) => (
            <Avatar
              key={o.profileId}
              name={o.name}
              size="xs"
              borderColor={t.colors.bg.secondary}
            />
          ))}
          {others.length > 3 ? (
            <Text style={styles.crewMore}>+{others.length - 3}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Collapsible section for timeless ("TBA") sets, rendered below the timed
 * schedule. Collapsed by default to save vertical space; expands to a wrapping
 * grid of compact TBA cards (2 cols < 500px, 3 cols above). Mirrors the web
 * TBASection's priority-tinted left border and crew overlap.
 */
export default function TBASection({
  sets,
  stages,
  currentProfile,
  currentFestival,
  getMyPick,
  getOtherPicks,
  getStageColor,
  onSavePick,
  onOpenDetail,
  defaultExpanded = false,
}: TBASectionProps) {
  const t = useTokens();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const stageById = useMemo(() => {
    const m = new Map<string, Stage>();
    for (const s of stages) m.set(s.id, s);
    return m;
  }, [stages]);

  // 3 columns on wider phones/tablets, 2 otherwise. Account for the section
  // padding (space[4] each side) and inter-card gap (space[2]).
  const { cols, cardWidth } = useMemo(() => {
    const sectionPad = t.spacing[4] * 2;
    const gap = t.spacing[2];
    const n = width >= 500 ? 3 : 2;
    const inner = width - sectionPad;
    const w = Math.floor((inner - gap * (n - 1)) / n);
    return { cols: n, cardWidth: w };
  }, [width, t.spacing]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  if (sets.length === 0) return null;

  return (
    <View style={styles.section}>
      <Pressable
        style={styles.header}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`TBA — Times Not Yet Announced, ${sets.length} sets`}
      >
        <Text style={styles.headerText} numberOfLines={2}>
          TBA — Times Not Yet Announced ({sets.length}{' '}
          {sets.length === 1 ? 'set' : 'sets'})
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={t.colors.text.muted}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.grid}>
          {sets.map((s) => {
            const stage = stageById.get(s.stageId);
            return (
              <TBACard
                key={s.id}
                set={s}
                width={cardWidth}
                stageName={stage?.name}
                stageColor={stage ? getStageColor(stage.id) : undefined}
                myPick={getMyPick(s.id)}
                others={getOtherPicks(s.id)}
                showPicks={!!currentProfile}
                onSavePick={onSavePick}
                onOpenDetail={onOpenDetail}
                b2bSeparator={currentFestival?.b2bSeparator}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: {
    margin: t.spacing[4],
    marginTop: t.spacing[2],
    padding: t.spacing[4],
    backgroundColor: t.colors.bg.card,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  headerText: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginTop: t.spacing[3],
  },
  card: {
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderLeftWidth: 3,
    padding: t.spacing[3],
    gap: t.spacing[2],
  },
  cardBody: {
    gap: t.spacing[1],
  },
  cardArtist: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    fontWeight: '600',
  },
  stageBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.default,
  },
  stageBadgeText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
  },
  pickRow: {
    flexDirection: 'row',
    gap: t.spacing[1],
  },
  pickButton: {
    width: 32,
    height: 32,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  crewMore: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    fontWeight: '700',
  },
}));
