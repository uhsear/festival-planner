import { View, Text, Image } from 'react-native';
import { getAvatarColor, getInitials, normalizeIdentityName } from '@festie/shared/utils';
import { makeStyles, useTokens } from '../hooks/useTokens';

/** Avatar diameters (px) — mirror the web Avatar's xs/sm/md sizes. */
const SIZE_PX = { xs: 24, sm: 32, md: 40 } as const;

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
}

/**
 * A circular avatar that mirrors the web Avatar: an image when available,
 * otherwise a deterministic colored circle with the person's initials. Color
 * and initials are derived from `name` via the same shared helpers the web app
 * uses, so an identity renders identically across platforms.
 */
export default function Avatar({
  name,
  image,
  size = 'sm',
  borderColor,
}: AvatarProps) {
  const t = useTokens();
  const styles = useStyles();
  const sz = SIZE_PX[size];

  const normalizedName = normalizeIdentityName(name ?? undefined);
  const initials = getInitials(normalizedName);
  const fallbackColor = getAvatarColor(normalizedName);

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
        <Image
          source={{ uri: image }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <Text
          style={[styles.initials, { fontSize: Math.round(sz / 3) }]}
          numberOfLines={1}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  avatar: {
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initials: {
    fontWeight: '700',
    color: t.colors.text.onAccent,
  },
}));
