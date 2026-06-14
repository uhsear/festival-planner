import { View, Text, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalModeStore } from '@festie/shared/stores';
import { useTokens, makeStyles, typeStyle, iconSize } from '../hooks/useTokens';

/**
 * Festival low-power mode controls (mobile mirror of the web quick-win), wired
 * to the SHARED `festivalModeStore.lowPowerMode` flag (persisted). Battery is a
 * paired constraint with no-signal at a festival, so when ON, consumers gate
 * expensive/battery-hungry features (live-location auto-share, aggressive
 * polling) while keeping essentials (set reminders, meeting pins).
 *
 * Two exports:
 *  - `LowPowerToggle` — the labelled Switch row (lives on the Now & Next /
 *    festival-mode screen, the festival-behavior surface).
 *  - `LowPowerIndicator` — a compact "Low power" chip rendered wherever a gated
 *    feature would otherwise run, so the user knows WHY it's quiet.
 */
export function LowPowerToggle() {
  const t = useTokens();
  const styles = useStyles();
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const setLowPowerMode = useFestivalModeStore((s) => s.setLowPowerMode);

  return (
    <View style={styles.row}>
      <View style={styles.rowLead}>
        <Ionicons name="battery-half-outline" size={iconSize.md} color={t.colors.accent.amber} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Low-power mode</Text>
          <Text style={styles.rowHint}>Pauses live location & ambient polling to save battery</Text>
        </View>
      </View>
      <Switch
        value={lowPowerMode}
        onValueChange={setLowPowerMode}
        trackColor={{ false: t.colors.border.default, true: t.colors.accent.amber }}
        thumbColor={t.colors.text.onAccent}
        accessibilityLabel="Festival low-power mode"
      />
    </View>
  );
}

/**
 * Compact "Low power" status chip. Renders nothing when low-power mode is off,
 * so callers can drop it inline next to (or in place of) a gated feature.
 */
export function LowPowerIndicator() {
  const t = useTokens();
  const styles = useStyles();
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  if (!lowPowerMode) return null;

  return (
    <View style={styles.chip} accessibilityRole="text" accessibilityLabel="Low power mode on">
      <Ionicons name="battery-half-outline" size={iconSize.xs} color={t.colors.accent.amber} />
      <Text style={styles.chipText} numberOfLines={1}>
        Low power
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 52,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  rowLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    flex: 1,
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.amberAlpha[12],
    borderWidth: 1,
    borderColor: t.colors.accent.amber,
  },
  chipText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.amber,
  },
}));
