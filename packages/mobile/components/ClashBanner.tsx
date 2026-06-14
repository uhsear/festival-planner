import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { usePickConflicts } from '@festie/shared/hooks';
import type { ConflictGroup, ConflictPick } from '@festie/shared/utils';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { priorityColor } from '../lib/priorityColor';

/**
 * Compact, glanceable set-time CLASH banner for the picks screen — web/mobile
 * parity for the "you can't be in two places at once" surface. Reads the shared
 * `usePickConflicts` (pure `buildPickConflicts` bound to the festival store:
 * sets / selectedDay / days / festival timeZone / my picks), and renders one
 * banner per conflict group on the selected day.
 *
 * Each banner lists the clashing acts (recommended-keep emphasized with a "Keep"
 * tag + its priority color) and a "tap to decide" affordance that opens the
 * recommended set's detail — where the per-set keep/clear controls live. Renders
 * nothing when there are no clashes (the common case).
 */
export default function ClashBanner() {
  const groups = usePickConflicts();
  if (groups.length === 0) return null;
  return <ClashBannerList groups={groups} />;
}

function ClashBannerList({ groups }: { groups: ConflictGroup[] }) {
  const t = useTokens();
  const styles = useStyles();
  const separator = useFestivalDataStore((s) => s.currentFestival?.b2bSeparator);

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Ionicons name="warning-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
        <Text style={styles.headingText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {groups.length === 1 ? 'Schedule clash' : `${groups.length} schedule clashes`}
        </Text>
      </View>
      {groups.map((group) => (
        <ClashCard key={clashKey(group)} group={group} separator={separator} />
      ))}
    </View>
  );
}

/** Stable key for a group: its participating set ids in order. */
function clashKey(group: ConflictGroup): string {
  return group.picks.map((p) => p.set.id).join('|');
}

function ClashCard({ group, separator }: { group: ConflictGroup; separator?: string }) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();

  const keep = useMemo(() => group.picks.find((p) => p.set.id === group.recommendedKeepId) ?? group.picks[0], [group]);
  const keepName = keep ? artistDisplayName(keep.set, separator) : '';
  // "8:30 PM" anchored on the latest start = the moment both acts are on stage.
  const atLabel = useMemo(() => {
    const latest = group.picks.reduce((a, b) => (b.startMs > a.startMs ? b : a));
    return formatTime(latest.set.startTime);
  }, [group.picks]);

  const overlapLabel = group.overlapMin > 0 ? `${group.overlapMin} min overlap` : 'overlapping sets';

  const a11yNames = group.picks.map((p) => artistDisplayName(p.set, separator)).join(', ');

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => keep && router.push(`/set/${keep.set.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Schedule clash${atLabel ? ` at ${atLabel}` : ''}: ${a11yNames}. ${
        keepName ? `Recommended keep ${keepName}. ` : ''
      }Tap to decide.`}
    >
      <View style={styles.cardHead}>
        <Text style={styles.cardTime} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {atLabel ? `${atLabel} · ` : ''}
          {overlapLabel}
        </Text>
        <View style={styles.decideRow}>
          <Text style={styles.decideText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Tap to decide
          </Text>
          <Ionicons name="chevron-forward" size={t.iconSize.xs} color={t.colors.accent.aqua} />
        </View>
      </View>

      <View style={styles.actList}>
        {group.picks.map((pick) => (
          <ActRow
            key={pick.set.id}
            pick={pick}
            name={artistDisplayName(pick.set, separator)}
            recommended={pick.set.id === group.recommendedKeepId}
          />
        ))}
      </View>
    </TouchableOpacity>
  );
}

function ActRow({ pick, name, recommended }: { pick: ConflictPick; name: string; recommended: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.actRow}>
      <View style={[styles.priorityDot, { backgroundColor: priorityColor(t, pick.priority) }]} />
      <Text
        style={[styles.actName, recommended && styles.actNameKeep]}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {name}
      </Text>
      {recommended && (
        <View style={styles.keepTag}>
          <Text style={styles.keepTagText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Keep
          </Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    marginBottom: t.spacing[2],
    gap: t.spacing[2],
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  headingText: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
  },
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.bg.card,
    padding: t.spacing[3],
    gap: t.spacing[2],
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  cardTime: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  decideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  decideText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  actList: {
    gap: t.spacing[1],
  },
  actRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actName: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  actNameKeep: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
  },
  keepTag: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  keepTagText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
}));
