import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCrewNudges, usePicks, useFestival } from '@festie/shared/hooks';
import { useFestivalDataStore } from '@festie/shared/stores';
import { artistDisplayName, ensureWhiteContrast } from '@festie/shared/utils';
import { duration as motionDuration } from '@festie/shared/tokens';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useHaptics } from '../hooks/useHaptics';
import { safeStageColor } from '../lib/stageColor';
import { goingLabel, addLabel, clusterLabel } from '../lib/crewSuggestion';
import Avatar from './Avatar';
import Button from './Button';

/**
 * "Your crew is seeing these" — the mobile port of web's CrewSuggestionStrip.
 * Surfaces sets the active crew has consensus on that the user hasn't picked,
 * straight from the shared `useCrewNudges` (pure `buildCrewNudges` bound to the
 * festival + crew stores). No selection, ranking or phrasing logic lives here.
 *
 * One-tap Add applies the crew's top priority through the optimistic,
 * offline-queued `savePick`; the row then disappears on its own because
 * useCrewNudges stops returning a set the user has picked. Dismissal is
 * in-memory for the screen's lifetime (React Native has no per-session web
 * storage; ClashPrompt uses the same pattern). Renders nothing when there is nothing to suggest.
 */
export default function CrewSuggestionStrip() {
  const nudges = useCrewNudges();
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const haptics = useHaptics();
  const { savePick } = usePicks();
  const { getStageColor, getStageName } = useFestival();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const dismiss = useCallback(
    (setId: string) => {
      haptics.tap();
      setDismissed((prev) => new Set(prev).add(setId));
    },
    [haptics],
  );

  const handleAdd = useCallback(
    (setId: string, priority: Parameters<typeof savePick>[2]) => {
      if (!festival) return;
      haptics.success();
      // Optimistic + offline-queued: the store surfaces its own error and the
      // queue retries, so swallow the rejection rather than throwing out of a
      // press handler. The row vanishes once the pick lands.
      savePick(festival.id, setId, priority).catch(() => {});
    },
    [festival, haptics, savePick],
  );

  const visible = nudges.filter((n) => !dismissed.has(n.set.id));
  if (visible.length === 0) return null;

  return (
    <Animated.View style={styles.card} entering={reduceMotion ? undefined : FadeIn.duration(motionDuration.med)}>
      <Text style={styles.headingText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
        Your crew is seeing these
      </Text>
      {/* RN's AccessibilityRole has no 'listitem', so the rows stay unroled and
          the named list carries the grouping (OfflineReadinessCard's pattern). */}
      <View style={styles.list} accessibilityRole="list" accessibilityLabel="Crew suggestions">
        {visible.map((nudge) => {
          const set = nudge.set;
          const name = artistDisplayName(set, festival?.b2bSeparator);
          const stageColor = safeStageColor(getStageColor(set.stageId), t.colors.text.muted);
          const stageName = getStageName(set.stageId) || set.stageName || 'Stage';
          // Slice ALL backers, as web's cluster does, so the +N overflow counts
          // the nameless ones too. Backers carry no avatar URL, so the cluster
          // is initials-only and falls back to a count pill when not one of
          // them has a name (SetCardMobile's CrewOverlap, same shapes).
          const shown = nudge.backers.slice(0, 3);
          const overflow = nudge.count - shown.length;
          const hasAvatarData = nudge.backers.some((b) => b.name);
          const clusterA11y = clusterLabel(name, nudge.count, nudge.breakdown);

          return (
            <View key={set.id} style={styles.row}>
              <View style={styles.rowMain}>
                <View style={styles.titleRow}>
                  <Text style={styles.artist} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {name}
                  </Text>
                  <View style={styles.stagePill}>
                    <View
                      style={[styles.stagePillBg, { backgroundColor: ensureWhiteContrast(stageColor) }]}
                      pointerEvents="none"
                    />
                    <Text
                      style={styles.stageText}
                      numberOfLines={1}
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      {/* Trailing space absorbs Fabric's single-line
                          self-under-measure (SetCardMobile's stage pill). */}
                      {stageName + ' '}
                    </Text>
                  </View>
                </View>
                <View style={styles.metaRow}>
                  {hasAvatarData ? (
                    <View style={styles.faces} accessibilityRole="image" accessibilityLabel={clusterA11y}>
                      {shown.map((b, i) => (
                        <View key={b.userId} style={i > 0 ? styles.avatarOverlap : undefined}>
                          <Avatar name={b.name || 'Crew'} size="xs" borderColor={t.colors.bg.card} />
                        </View>
                      ))}
                      {overflow > 0 ? (
                        <View style={[styles.overflowBadge, styles.avatarOverlap]}>
                          <Text style={styles.overflowText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                            +{overflow}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.faces} accessibilityRole="text" accessibilityLabel={clusterA11y}>
                      <Text style={styles.countPill} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {goingLabel(nudge.count, '')}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.going} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {goingLabel(nudge.count, nudge.breakdown)}
                  </Text>
                </View>
              </View>

              <Button
                label="Add"
                size="sm"
                variant="primary"
                onPress={() => handleAdd(set.id, nudge.topPriority)}
                accessibilityLabel={addLabel(name, nudge.count, nudge.breakdown)}
              />
              <TouchableOpacity
                style={styles.dismiss}
                activeOpacity={0.7}
                onPress={() => dismiss(set.id)}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss suggestion: ${name}`}
              >
                <Ionicons name="close" size={t.iconSize.sm} color={t.colors.text.muted} />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  // Outer card, web parity: the strip is one bordered surface, not loose rows
  // on the bare screen background.
  card: {
    marginBottom: t.spacing[3],
    padding: t.spacing[3],
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.glass.border,
    backgroundColor: t.colors.bg.card,
  },
  headingText: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
  },
  list: {
    gap: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // Rows sit inside the glass-bordered card, so they take the plainer
    // border token (web: border-border inside border-glass-border).
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: t.spacing[1],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  artist: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  stagePill: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    flexShrink: 1,
  },
  // The pill background lives on this absolutely-positioned sibling — not on
  // stagePill itself — so the Text child is never clipped to the rounded
  // bounds on Android (see SetCardMobile's stagePillBg / dayChipBg).
  stagePillBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
  },
  stageText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  going: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  faces: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarOverlap: {
    marginLeft: -8,
  },
  overflowBadge: {
    width: 24,
    height: 24,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.ring.aqua,
    borderWidth: 2,
    borderColor: t.colors.bg.card,
  },
  overflowText: {
    ...typeStyle('micro', 700),
    color: t.colors.accent.aqua,
  },
  // No-avatar-data fallback: web swaps the faces for a bare count pill rather
  // than dropping the cluster.
  countPill: {
    ...typeStyle('micro', 700),
    color: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  // WCAG 2.5.5 touch target: the web strip's dismiss is a 32px icon button;
  // native needs 44 minimum, so the hit area is decoupled from the 16px glyph.
  dismiss: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
