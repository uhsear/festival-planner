import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Display-name editor for the Account screen.
 *
 * Wired to the shared authStore.updateDisplayName → PUT /account/display-name
 * with { displayName }. The display name is the friendly name shown across
 * crews/account; it falls back to the @username when unset. The username
 * itself is the permanent handle and is NOT editable here — it's shown
 * read-only beneath the form.
 */
export default function AccountDisplayNameSection() {
  const t = useTokens();
  const styles = useStyles();
  const user = useAuthStore((s) => s.user);
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName);

  const username = user?.username ?? '';
  const currentName = user?.name ?? '';

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setValue(currentName);
    setError(null);
  };

  const toggle = () => {
    setOpen((prev) => {
      if (prev) reset();
      else setValue(currentName);
      return !prev;
    });
  };

  const validate = (): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Enter a display name.';
    if (trimmed.length > 50) return 'Display name must be 50 characters or fewer.';
    if (trimmed === currentName) return 'That is already your display name.';
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateDisplayName(value.trim());
      setOpen(false);
      Alert.alert('Display name updated', 'Your display name has been changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change display name.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide change display name form' : 'Change display name'}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="person-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Display name</Text>
          <Text style={styles.rowHint} numberOfLines={1}>
            {currentName || (username ? `@${username}` : 'Set a display name')}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="How your name appears to your crew"
            placeholderTextColor={t.colors.text.placeholder}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={50}
            editable={!submitting}
            accessibilityLabel="New display name"
          />

          {username ? <Text style={styles.handleHint}>@{username} · username can’t be changed</Text> : null}

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.submit, submitting && styles.submitDisabled]}
            onPress={() => void submit()}
            disabled={submitting}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Save display name"
            accessibilityState={{ disabled: submitting }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
            ) : (
              <Text style={styles.submitText}>Save Display Name</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
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
  form: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  handleHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  submit: {
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
