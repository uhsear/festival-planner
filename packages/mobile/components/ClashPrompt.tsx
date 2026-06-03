import { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FestivalSet } from '@festie/shared/types';
import { formatTime, artistDisplayName, timeToMinutes } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';

interface Props {
  /** The set currently open in the detail screen. */
  currentSet: FestivalSet;
  /**
   * Sets that overlap `currentSet` and are also PICKED — already day-index
   * guarded and de-duped upstream by detectConflicts in conflicts.ts.
   */
  conflicts: FestivalSet[];
  b2bSeparator?: string;
  /**
   * Demote/clear one side of a clash. Maps to usePicks().savePick(fid,id,null),
   * which is offline-queued — resolving a clash works on dead signal.
   */
  onClear: (setId: string) => void;
}

/** Stable, order-independent key so a resolved/dismissed pair never re-nags. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** "2 acts at 8:30" anchors on the later start — when both are first on stage. */
function overlapStartLabel(a: FestivalSet, b: FestivalSet): string {
  const aS = timeToMinutes(a.startTime);
  const bS = timeToMinutes(b.startTime);
  const later = aS >= bS ? a : b;
  return formatTime(later.startTime);
}

/**
 * Inline clash prompt (M1, mobile parity of the web ClashPrompt). For each
 * overlapping PICKED pair through the open set, names both acts and lets the
 * user keep one — clearing the other via savePick(...,null). Shows once per
 * pair (in-memory for the screen's lifetime); the ambient conflict box in the
 * detail screen carries the lasting signal so we don't double-nag.
 */
export default function ClashPrompt({ currentSet, conflicts, b2bSeparator, onClear }: Props) {
  const t = useTokens();
  const styles = useStyles();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const dismissPair = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const active = useMemo(
    () => conflicts.filter((c) => !dismissed.has(pairKey(currentSet.id, c.id))),
    [conflicts, dismissed, currentSet.id],
  );

  if (active.length === 0) return null;

  const currentName = artistDisplayName(currentSet, b2bSeparator);

  return (
    <View style={styles.wrap}>
      {active.map((c) => {
        const key = pairKey(currentSet.id, c.id);
        const otherName = artistDisplayName(c, b2bSeparator);
        const at = overlapStartLabel(currentSet, c);
        return (
          <View key={c.id} style={styles.card} accessibilityRole="alert">
            <View style={styles.header}>
              <Ionicons name="alert-circle" size={16} color={t.colors.accent.coral} />
              <Text style={styles.title}>{`2 acts${at ? ` at ${at}` : ''} — keep one`}</Text>
            </View>
            <Text style={styles.body}>
              {`${currentName} and ${otherName} overlap. Keep one and we'll clear the other.`}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.keepButton}
                onPress={() => {
                  onClear(c.id);
                  dismissPair(key);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Keep ${currentName}, clear ${otherName}`}
              >
                <Text style={styles.keepText} numberOfLines={1}>{`Keep ${currentName}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keepButton}
                onPress={() => {
                  onClear(currentSet.id);
                  dismissPair(key);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Keep ${otherName}, clear ${currentName}`}
              >
                <Text style={styles.keepText} numberOfLines={1}>{`Keep ${otherName}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => dismissPair(key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Keep both acts"
              >
                <Text style={styles.dismissText}>Keep both</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
  },
  card: {
    gap: t.spacing[2],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  title: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
    flex: 1,
  },
  body: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  keepButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.card,
  },
  keepText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  dismissButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
  },
  dismissText: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
  },
}));
