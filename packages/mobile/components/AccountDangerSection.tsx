import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface AccountDangerSectionProps {
  /** Called after a successful delete (store + token already cleared) so the
   *  screen can route to login. */
  onDeleted: () => void;
}

/**
 * Danger-zone (account deletion) for the Account screen.
 *
 * Wired to the shared authStore.deleteAccount(password) → DELETE /account/
 * with { password }. Deletion is a soft delete with a 30-day grace period;
 * the shared action calls logout() on success (clearing the token + resetting
 * all stores), and this component then invokes onDeleted to route to login.
 *
 * Flow: expand the danger row → enter the account password → a double-confirm
 * Alert spells out the 30-day grace window → on confirm we call deleteAccount.
 * A wrong password surfaces inline (server returns PASSWORD_INCORRECT / 403).
 */
export default function AccountDangerSection({ onDeleted }: AccountDangerSectionProps) {
  const t = useTokens();
  const styles = useStyles();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPassword('');
    setError(null);
  };

  const toggle = () => {
    setOpen((prev) => {
      if (prev) reset();
      return !prev;
    });
  };

  const confirmDelete = () => {
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    setError(null);
    Alert.alert(
      'Delete account?',
      'This soft-deletes your account with a 30-day grace period. You can recover it by signing back in within 30 days; after that it is permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => void handleDelete(),
        },
      ],
    );
  };

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await deleteAccount(password);
      // deleteAccount → logout already cleared token + reset stores.
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account.');
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
        accessibilityLabel={open ? 'Hide delete account form' : 'Delete account'}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="trash-outline" size={20} color={t.colors.text.danger} />
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, styles.dangerText]}>Delete Account</Text>
          <Text style={styles.rowHint}>30-day grace period before permanent removal</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Confirm your password"
            placeholderTextColor={t.colors.text.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!submitting}
            accessibilityLabel="Account password to confirm deletion"
          />

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.submit, submitting && styles.submitDisabled]}
            onPress={confirmDelete}
            disabled={submitting}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityState={{ disabled: submitting }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
            ) : (
              <Text style={styles.submitText}>Delete My Account</Text>
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
  dangerText: {
    color: t.colors.text.danger,
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
    backgroundColor: t.colors.accent.coralStrong,
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
    color: t.colors.text.onAccent,
  },
}));
