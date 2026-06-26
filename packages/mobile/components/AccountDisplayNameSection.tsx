import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import Button from './Button';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Display-name editor for the Account screen.
 *
 * Wired to the shared authStore.updateDisplayName → PUT /account/display-name
 * with { displayName }. The display name is the friendly name shown across
 * crews/account; it falls back to the @username when unset. The username
 * itself is the permanent handle and is NOT editable here — it's shown
 * read-only beneath the form.
 */
const MAX_LEN = 50;

export default function AccountDisplayNameSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName);

  const username = user?.username ?? '';
  const currentName = user?.name ?? '';

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // iOS lacks Android's input ripple, so give the field an explicit focus
  // affordance: accent border + subtle aqua ring (paired per token note).
  const [focused, setFocused] = useState(false);

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

  const trimmed = value.trim();
  const dirty = trimmed !== currentName;
  const valid = trimmed.length > 0 && trimmed.length <= MAX_LEN && dirty;

  const validate = (): string | null => {
    if (!trimmed) return 'Enter a display name.';
    if (trimmed.length > MAX_LEN) return `Display name must be ${MAX_LEN} characters or fewer.`;
    if (trimmed === currentName) return 'That is already your display name.';
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      haptics.warning();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateDisplayName(trimmed);
      haptics.success();
      setOpen(false);
      Alert.alert('Display name updated', 'Your display name has been changed.');
    } catch (err) {
      haptics.warning();
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
          <View style={[styles.inputWrap, focused && styles.inputFocused]}>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder="How your name appears to your crew"
              placeholderTextColor={t.colors.text.placeholder}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={MAX_LEN}
              editable={!submitting}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="done"
              onSubmitEditing={() => valid && void submit()}
              accessibilityLabel="New display name"
            />
            {value.length > 0 && !submitting ? (
              <TouchableOpacity
                onPress={() => setValue('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear display name"
                style={styles.clear}
              >
                <Ionicons name="close-circle" size={18} color={t.colors.text.placeholder} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            {username ? (
              <Text style={styles.handleHint} numberOfLines={1}>
                @{username} · username can’t be changed
              </Text>
            ) : (
              <View />
            )}
            <Text
              style={[styles.counter, trimmed.length > MAX_LEN && styles.counterOver]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {value.length}/{MAX_LEN}
            </Text>
          </View>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button
            label="Save Display Name"
            onPress={() => void submit()}
            loading={submitting}
            disabled={!valid}
            accessibilityLabel="Save display name"
          />
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
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingRight: t.spacing[2],
    minHeight: 48,
  },
  input: {
    ...typeStyle('body'),
    flex: 1,
    color: t.colors.text.primary,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  clear: {
    padding: t.spacing[1],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
    marginTop: -t.spacing[1],
  },
  handleHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  counter: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  counterOver: {
    color: t.colors.text.danger,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
}));
