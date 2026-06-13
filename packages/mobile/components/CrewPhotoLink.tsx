import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import Button from './Button';

interface CrewPhotoLinkProps {
  crewId: string;
  photoAlbumUrl: string | null | undefined;
}

/**
 * M6 Crew Photo Wall — Phase 1, link-out only. Festie does not host photos yet
 * (the R2 upload pipeline is deferred). This card stores a single shared-album
 * URL (Google Photos / Apple shared album, etc.) any crew member can paste and
 * everyone can open via expo-linking. Mirrors web CrewPhotosCard; writes via the
 * shared updatePhotoAlbum (member-gated PUT /crews/:id/photo-album).
 */
export default function CrewPhotoLink({ crewId, photoAlbumUrl }: CrewPhotoLinkProps) {
  const t = useTokens();
  const styles = useStyles();
  const updatePhotoAlbum = useCrewStore((s) => s.updatePhotoAlbum);

  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(photoAlbumUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);

  // Keep the form in sync when the crew's stored URL changes underneath us
  // (e.g. another member sets it and the crew:photo-album-updated event lands).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable URL draft from the store when another member sets it (crew:photo-album-updated); can't be pure derived state because the user edits it locally before saving back.
    setUrl(photoAlbumUrl ?? '');
  }, [photoAlbumUrl]);

  const hasAlbum = !!photoAlbumUrl;
  const trimmed = url.trim();
  // Only accept https links (matches the backend schema); blank clears the link.
  const isValid = trimmed === '' || trimmed.startsWith('https://');

  const open = () => {
    if (photoAlbumUrl) Linking.openURL(photoAlbumUrl).catch(() => {});
  };

  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      await updatePhotoAlbum(crewId, { photoAlbumUrl: trimmed || null });
      setEditing(false);
    } catch {
      // Error is surfaced via the crew store.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.editBox}>
        <View style={styles.editHeader}>
          <Ionicons name="images" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.editTitle}>Crew photos</Text>
          <TouchableOpacity
            onPress={() => setEditing(false)}
            style={styles.iconButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing crew photos"
          >
            <Ionicons name="close" size={18} color={t.colors.text.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Paste a shared album link (Google Photos, Apple shared album, etc.).</Text>
        <TextInput
          style={[styles.input, focused && styles.inputFocused]}
          placeholder="https://photos.app.goo.gl/…"
          placeholderTextColor={t.colors.text.placeholder}
          value={url}
          onChangeText={setUrl}
          maxLength={2048}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={handleSave}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Shared album URL"
        />
        {!isValid ? <Text style={styles.errorText}>Link must start with https://</Text> : null}
        <Button
          label="Save"
          loading={saving}
          loadingLabel="Saving…"
          disabled={!isValid}
          onPress={handleSave}
          accessibilityLabel="Save crew photo album link"
        />
      </View>
    );
  }

  if (!hasAlbum) {
    return (
      <TouchableOpacity
        style={[styles.card, styles.cardEmpty]}
        onPress={() => setEditing(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Add a shared photo album"
      >
        <Ionicons name="images" size={16} color={t.colors.text.muted} />
        <View style={styles.cardInfo}>
          <Text style={styles.cardPlaceholder}>Add a shared photo album</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, styles.cardSet]}>
      <Ionicons name="images" size={16} color={t.colors.accent.aqua} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardLabel} numberOfLines={1}>
          Crew photos
        </Text>
      </View>
      <TouchableOpacity
        onPress={open}
        style={styles.actionButton}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Open crew photo album"
      >
        <Ionicons name="open-outline" size={14} color={t.colors.accent.aqua} />
        <Text style={styles.actionText}>Open</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setEditing(true)}
        style={styles.iconButton}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Edit crew photo album link"
      >
        <Ionicons name="pencil" size={14} color={t.colors.text.secondary} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    backgroundColor: t.colors.bg.secondary,
  },
  cardSet: {
    borderColor: t.colors.accent.aqua,
  },
  cardEmpty: {
    borderColor: t.colors.border.default,
    borderStyle: 'dashed',
  },
  cardInfo: {
    flex: 1,
  },
  cardLabel: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  cardPlaceholder: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
  },
  actionText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  editBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  editTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (14-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  errorText: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
  },
}));
