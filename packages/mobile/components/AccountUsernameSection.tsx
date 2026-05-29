import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Username-change form for the Account screen.
 *
 * Wired to the shared authStore.updateUsername → PUT /account/username with
 * { username }. The shared action is platform-neutral and updates the store
 * user on success, so this is just the UI: a collapsible row, a single text
 * field, client-side validation matching the server's validateUsername rules
 * (2-30 chars; letters, numbers, spaces, hyphens, underscores), an in-flight
 * spinner, inline errors, and a success Alert.
 */
export default function AccountUsernameSection() {
  const t = useTokens();
  const styles = useStyles();
  const user = useAuthStore((s) => s.user);
  const updateUsername = useAuthStore((s) => s.updateUsername);

  const currentUsername = user?.username ?? '';

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentUsername);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setValue(currentUsername);
    setError(null);
  };

  const toggle = () => {
    setOpen((prev) => {
      if (prev) reset();
      else setValue(currentUsername);
      return !prev;
    });
  };

  const validate = (): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Enter a username.';
    if (trimmed.length < 2 || trimmed.length > 30) {
      return 'Username must be 2-30 characters.';
    }
    if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) {
      return 'Use only letters, numbers, spaces, hyphens, or underscores.';
    }
    if (trimmed === currentUsername) {
      return 'That is already your username.';
    }
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
      await updateUsername(value.trim());
      setOpen(false);
      Alert.alert('Username updated', 'Your username has been changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change username.');
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
        accessibilityLabel={open ? 'Hide change username form' : 'Change username'}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="at-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Username</Text>
          <Text style={styles.rowHint} numberOfLines={1}>
            {currentUsername ? `@${currentUsername}` : 'Set a username'}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-forward'}
          size={18}
          color={t.colors.text.placeholder}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="Username"
            placeholderTextColor={t.colors.text.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            editable={!submitting}
            accessibilityLabel="New username"
          />

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
            accessibilityLabel="Save username"
            accessibilityState={{ disabled: submitting }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
            ) : (
              <Text style={styles.submitText}>Save Username</Text>
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
