import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@festie/shared/hooks';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Avatar management for the Account screen.
 *
 * Wired to the shared, platform-neutral store methods:
 *   - useAuth().uploadAvatar(file: Blob) → POST /account/avatar (FormData,
 *     bearer + trusted-mutation header), updates user.avatar with rollback.
 *   - useAuth().removeAvatar()           → DELETE /account/avatar, clears it.
 *
 * Only the file-acquisition step is native-specific. Web uses <input type=file>;
 * here we pick via expo-image-picker, then materialize the chosen URI into a
 * Blob (fetch(uri).blob()) so the SAME shared uploadAvatar consumes it.
 *
 * expo-image-picker is loaded lazily via dynamic import() so the bundle/typecheck
 * does not hard-depend on it; if the native module isn't present we surface a clear
 * message instead of crashing. Install `expo-image-picker` to enable picking.
 */

// Minimal shape of the parts of expo-image-picker we use — declared locally so
// the optional dependency does not need to be installed for typecheck to pass.
interface ImagePickerAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}
interface ImagePickerResult {
  canceled: boolean;
  assets?: ImagePickerAsset[] | null;
}
interface ImagePickerModule {
  requestMediaLibraryPermissionsAsync: () => Promise<{ granted: boolean }>;
  launchImageLibraryAsync: (options?: {
    mediaTypes?: ('images' | 'videos' | 'livePhotos')[];
    allowsEditing?: boolean;
    aspect?: [number, number];
    quality?: number;
  }) => Promise<ImagePickerResult>;
}

async function loadImagePicker(): Promise<ImagePickerModule | null> {
  try {
    // Dynamic import keeps expo-image-picker optional: the bundle/typecheck does
    // not hard-depend on it, and a missing native module degrades gracefully.
    const mod = (await import('expo-image-picker')) as unknown as {
      default?: ImagePickerModule;
    } & ImagePickerModule;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export default function AccountAvatarSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { uploadAvatar, removeAvatar } = useAuth();
  const user = useAuthStore((s) => s.user);

  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Transient confirmation after a successful change — a quiet "Saved" beats a
  // modal Alert for a low-stakes action the user can see worked.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const avatarUrl = user?.avatar ?? user?.avatarUrl;

  const flashSaved = () => {
    haptics.success();
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2200);
  };

  const pickAndUpload = async () => {
    setError(null);
    setSaved(false);
    const picker = await loadImagePicker();
    if (!picker) {
      const msg = 'Image picker is unavailable. Install expo-image-picker to change your avatar.';
      setError(msg);
      Alert.alert('Unavailable', msg);
      return;
    }

    try {
      const perm = await picker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('Photo library permission is required to choose an avatar.');
        return;
      }

      const result = await picker.launchImageLibraryAsync({
        // SDK 52+ replaced the removed MediaTypeOptions enum with a string array.
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) return;
      setBusy('upload');
      // Materialize the picked URI into a Blob so the shared (platform-neutral)
      // uploadAvatar(File | Blob) can append it to FormData unchanged.
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      await uploadAvatar(blob);
      flashSaved();
    } catch (err) {
      haptics.warning();
      setError(err instanceof Error ? err.message : 'Could not update avatar.');
    } finally {
      setBusy(null);
    }
  };

  const confirmRemove = () => {
    Alert.alert('Remove avatar', 'Remove your current profile photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void handleRemove(),
      },
    ]);
  };

  const handleRemove = async () => {
    setError(null);
    setSaved(false);
    setBusy('remove');
    try {
      await removeAvatar();
      flashSaved();
    } catch (err) {
      haptics.warning();
      setError(err instanceof Error ? err.message : 'Could not remove avatar.');
    } finally {
      setBusy(null);
    }
  };

  const hint = busy === 'upload' ? 'Uploading…' : busy === 'remove' ? 'Removing…' : 'JPG or PNG, square works best';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={() => void pickAndUpload()}
          disabled={busy !== null}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add a profile photo'}
          accessibilityState={{ disabled: busy !== null }}
          style={styles.avatarTap}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              accessibilityIgnoresInvertColors
              accessibilityLabel="Current avatar"
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="image-outline" size={24} color={t.colors.text.secondary} />
            </View>
          )}
          {/* Camera affordance badge so it reads as tappable. */}
          <View style={styles.camBadge}>
            <Ionicons name="camera" size={12} color={t.colors.text.onLightAccent} />
          </View>
        </TouchableOpacity>

        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Profile Photo</Text>
          {saved ? (
            <View style={styles.savedRow} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={13} color={t.colors.status.verified} style={styles.savedIcon} />
              <Text style={styles.savedText}>Saved</Text>
            </View>
          ) : (
            <Text style={styles.rowHint}>{hint}</Text>
          )}
        </View>
        {busy ? <ActivityIndicator size="small" color={t.colors.accent.aqua} /> : null}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { flex: 1 }, busy ? styles.btnDisabled : null]}
          onPress={() => void pickAndUpload()}
          disabled={busy !== null}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Upload profile photo'}
          accessibilityState={{ disabled: busy !== null }}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={t.colors.accent.aqua} style={styles.btnIcon} />
          <Text style={styles.btnPrimaryText}>{`${avatarUrl ? 'Change' : 'Upload'}\u00a0`}</Text>
        </TouchableOpacity>

        {avatarUrl ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, busy ? styles.btnDisabled : null]}
            onPress={confirmRemove}
            disabled={busy !== null}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Remove profile photo"
            accessibilityState={{ disabled: busy !== null }}
          >
            <Ionicons name="trash-outline" size={18} color={t.colors.text.danger} style={styles.btnIcon} />
            <Text style={styles.btnGhostText}>{'Remove '}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  avatarTap: {
    width: 48,
    height: 48,
  },
  avatar: {
    width: 48,
    height: 48,
    // Circular avatar: use radii.pill (999) so the circle holds at any size
    // rather than a raw sz/2 literal (F48).
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colors.bg.secondary,
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
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  savedIcon: {
    marginRight: 4,
  },
  savedText: {
    ...typeStyle('caption'),
    color: t.colors.status.verified,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // No `gap`: Android under-measures a centered Text sibling in a gap-spaced
    // row and clips the last glyph ("Uploa") — the icon carries marginRight.
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.default,
  },
  btnIcon: {
    marginRight: t.spacing[2],
  },
  btnPrimary: {
    // The avatar is optional, so this is DEMOTED to a secondary/outline aqua
    // button — it must not be the loudest element on the Account screen. A
    // filled aqua fill is reserved for true primary CTAs.
    // flex:1 is applied conditionally in JSX (present when avatar is set so
    // both buttons share the row equally; absent when Upload is the only
    // button so it sizes to content and the label does not clip).
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  btnPrimaryText: {
    ...typeStyle('label'),
    // Android 16 under-measures this short Space Grotesk label by one glyph in
    // a centered icon/text row even with unconstrained width. The system face
    // measures reliably here; retain the brand face on iOS.
    fontFamily: Platform.OS === 'android' ? undefined : typeStyle('label').fontFamily,
    color: t.colors.accent.aqua,
    // Reserve the full label width at large Android font scales. Android can
    // otherwise lay out this centered icon/text row one glyph too narrowly.
    minWidth: 64,
    textAlign: 'center',
    flexShrink: 0,
  },
  btnGhost: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  btnGhostText: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
  btnDisabled: {
    opacity: 0.6,
  },
}));
