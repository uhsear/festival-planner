import { useEffect, useRef } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { getAvatarColor, getInitials, normalizeIdentityName } from '@festie/shared/utils';
import { makeStyles, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

/** Avatar diameters (px) -- mirror the web Avatar's xs/sm/md sizes. */
const SIZE_PX = { xs: 24, sm: 32, md: 40 } as const;

/** Status dot diameter per avatar size. */
const DOT_PX = { xs: 6, sm: 8, md: 10 } as const;

interface AvatarProps {
  /** Display name; drives the deterministic fallback color + initials. */
  name?: string;
  /** Avatar image URL. When absent, renders the initials fallback. */
  image?: string | null;
  /** Diameter preset: xs=24, sm=32, md=40. */
  size?: keyof typeof SIZE_PX;
  /**
   * Border ring color. Defaults to the card background so overlapping
   * avatars read as separated rings (matches web's ring-2 ring-bg-card).
   */
  borderColor?: string;
  /**
   * R23: show the presence status dot. Pair with isOnline.
   * When true, renders a dot at bottom-right of the avatar.
   */
  showStatus?: boolean;
  /**
   * R23: online state. ONLINE -> aqua dot; OFFLINE -> muted dot.
   * Flipping false to true triggers a one-shot Reanimated ring pulse.
   */
  isOnline?: boolean;
}

/**
 * A circular avatar that mirrors the web Avatar: an image when available,
 * otherwise a deterministic colored circle with the person's initials. Color
 * and initials are derived from `name` via the same shared helpers the web app
 * uses, so an identity renders identically across platforms.
 *
 * R23: optional status dot with one-shot presence-flip ring animation.
 * Battery rule: ring fires once on false to true transition only; no
 * continuous animation. Reduce-motion: ring skipped entirely.
 */
export default function Avatar({
  name,
  image,
  size = 'sm',
  borderColor,
  showStatus = false,
  isOnline = false,
}: AvatarProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const sz = SIZE_PX[size];
  const dotSz = DOT_PX[size];

  const normalizedName = normalizeIdentityName(name ?? undefined);
  const initials = getInitials(normalizedName);
  const fallbackColor = getAvatarColor(normalizedName);

  // R23: one-shot ring on presence flip false to true.
  // Ring Animated.View scales 1 to 2.8 and fades opacity 0.7 to 0 in 600ms once.
  // Continuous animation banned (battery). Reduce-motion: skip.
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const prevOnlineRef = useRef(isOnline);

  useEffect(() => {
    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;
    if (!showStatus || !isOnline || wasOnline || reduceMotion) return;
    ringOpacity.value = 0.7;
    ringScale.value = 1;
    ringScale.value = withTiming(2.8, { duration: 600, easing: Easing.out(Easing.cubic) });
    ringOpacity.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [isOnline, showStatus, reduceMotion, ringScale, ringOpacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  return (
    <View
      style={[
        styles.avatar,
        {
          width: sz,
          height: sz,
          borderRadius: sz / 2,
          borderColor: borderColor ?? t.colors.bg.card,
          backgroundColor: image ? t.colors.bg.secondary : fallbackColor,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={normalizedName}
    >
      {image ? (
        <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
      ) : (
        <Text style={[styles.initials, { fontSize: Math.round(sz / 3) }]} numberOfLines={1}>
          {initials}
        </Text>
      )}

      {showStatus ? (
        <View
          style={[
            styles.dotWrapper,
            {
              width: dotSz + 4,
              height: dotSz + 4,
              borderRadius: (dotSz + 4) / 2,
              bottom: -2,
              right: -2,
            },
          ]}
        >
          {/* R23: one-shot ring layer behind the dot */}
          <Animated.View
            style={[
              styles.dotRing,
              { width: dotSz, height: dotSz, borderRadius: dotSz / 2, backgroundColor: t.colors.accent.aqua },
              ringStyle,
            ]}
          />
          {/* Status dot: R6: ONLINE -> aqua; OFFLINE -> muted. No greens. */}
          <View
            style={[
              styles.dot,
              {
                width: dotSz,
                height: dotSz,
                borderRadius: dotSz / 2,
                backgroundColor: isOnline ? t.colors.accent.aqua : t.colors.text.muted,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  avatar: {
    borderWidth: 2,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 9999,
    overflow: 'hidden',
  },
  initials: {
    fontWeight: '700',
    color: t.colors.text.onAccent,
  },
  dotWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.card,
  },
  dotRing: {
    position: 'absolute',
  },
  dot: {
    position: 'absolute',
  },
}));
