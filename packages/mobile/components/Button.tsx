import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  type GestureResponderEvent,
  type StyleProp,
  type TouchableOpacityProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Canonical button for the mobile app — the single definition of the aqua
 * primary / aqua-outline secondary / coral danger CTA that was previously
 * re-declared ~12 times across the crew components with height/padding/disabled
 * drift (design-hardening F8).
 *
 * Accent rule (packages/shared/src/tokens/colors.ts): aqua = primary/positive
 * with dark ink (onLightAccent); coral is danger only and a FILLED coral button
 * uses coralStrong behind white text to clear WCAG AA (~6.04:1), mirroring the
 * solved CrewSos pattern.
 *
 * Variants:
 *   - primary   — aqua fill + dark ink
 *   - secondary — aqua border + aqua text (borderless fill)
 *   - ghost     — borderless muted text
 *   - danger    — coralStrong fill + white text
 *   - utility   — bordered input-bg tonal button (e.g. "Use my location")
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'utility';
export type ButtonSize = 'md' | 'sm';

interface ButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading Ionicons glyph rendered before the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Loading copy substituted for the label while `loading` is true. */
  loadingLabel?: string;
  /**
   * Max label lines. Default (undefined) lets the label lay out naturally —
   * short labels stay one line; long ones wrap instead of tail-clipping. A hard
   * `numberOfLines={1}` triggers Android/Fabric's centered single-line
   * under-measurement, which false-clips the last glyph even with room to spare
   * ("Switch fest…"). Pass an explicit value only if a hard line cap is required.
   */
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  loadingLabel,
  numberOfLines,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const t = useTokens();
  const styles = useStyles();

  const isDisabled = disabled || loading;
  const iconColor = ICON_COLOR[variant](t);

  return (
    <TouchableOpacity
      style={[
        styles.base,
        size === 'sm' && styles.sizeSm,
        VARIANT_CONTAINER[variant](styles),
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled }}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? t.iconSize.sm : t.iconSize.action} color={iconColor} style={styles.icon} /> : null}
          <Text style={[styles.label, VARIANT_TEXT[variant](styles)]} numberOfLines={numberOfLines}>
            {/* Trailing NBSP when a leading icon exists: Android under-measures
                a Text following an icon-font sibling and clips the last glyph;
                the sacrificial space absorbs the shortfall. */}
            {(loading ? (loadingLabel ?? label) : label) + (icon ? ' ' : '')}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

type Styles = ReturnType<typeof useStyles>;
type Tokens = ReturnType<typeof useTokens>;

const VARIANT_CONTAINER: Record<ButtonVariant, (s: Styles) => Styles[keyof Styles]> = {
  primary: (s) => s.primary,
  secondary: (s) => s.secondary,
  ghost: (s) => s.ghost,
  danger: (s) => s.danger,
  utility: (s) => s.utility,
};

const VARIANT_TEXT: Record<ButtonVariant, (s: Styles) => Styles[keyof Styles]> = {
  primary: (s) => s.labelPrimary,
  secondary: (s) => s.labelSecondary,
  ghost: (s) => s.labelGhost,
  danger: (s) => s.labelDanger,
  utility: (s) => s.labelUtility,
};

const ICON_COLOR: Record<ButtonVariant, (t: Tokens) => string> = {
  primary: (t) => t.colors.text.onLightAccent,
  secondary: (t) => t.colors.text.muted,
  ghost: (t) => t.colors.text.secondary,
  danger: (t) => t.colors.text.onAccent,
  utility: (t) => t.colors.accent.aqua,
};

const useStyles = makeStyles((t) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // No `gap` here: Android under-measures a centered Text sibling in a
    // gap-spaced row and clips the last glyph ("Uploa"); the icon carries a
    // marginRight instead.
    minHeight: 48, // WCAG 2.5.5 / Apple HIG touch target
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    // Pill per the current design language — the recent design pass moved CTAs
    // to pill (login, EmptyState R21, festival-mode); this is the single source.
    borderRadius: t.radii.pill,
  },
  sizeSm: {
    minHeight: 44,
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
  },
  // accent rule: aqua primary + dark ink (coral = danger/SOS only; coral-on-white failed AA)
  primary: {
    backgroundColor: t.colors.accent.aqua,
  },
  // R3 outline-secondary: 1px aqua/40 border + muted text. The single solid
  // aqua per screen lives on `primary`; demoted CTAs use this. (No hover on
  // native, so the resting aqua/40 + muted-text state is authoritative.)
  secondary: {
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[40],
  },
  ghost: {},
  // Filled danger: coralStrong clears WCAG AA behind white text (~6.04:1); plain
  // coral only reaches ~3.55:1. Mirrors the solved CrewSos sosButton pattern.
  danger: {
    backgroundColor: t.colors.accent.coralStrong,
  },
  utility: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  disabled: {
    opacity: 0.6,
  },
  // Leading-glyph spacing (replaces the row gap — see `base`).
  icon: {
    marginRight: t.spacing[2],
  },
  label: {
    ...typeStyle('label'),
    textAlign: 'center',
  },
  labelPrimary: {
    color: t.colors.text.onLightAccent,
  },
  // R3: muted text on the outline-secondary (was aqua) so the lone solid-aqua
  // primary is the only loud element on screen.
  labelSecondary: {
    color: t.colors.text.muted,
  },
  labelGhost: {
    color: t.colors.text.secondary,
  },
  labelDanger: {
    color: t.colors.text.onAccent,
  },
  labelUtility: {
    color: t.colors.text.primary,
  },
}));
