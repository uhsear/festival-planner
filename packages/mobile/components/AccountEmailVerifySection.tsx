import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Email-verification status + resend action for the Account screen.
 *
 * Renders only when the signed-in user has an email on file that is not yet
 * verified. Email is OPTIONAL at signup, so this is a soft status indicator —
 * there is no lockout. Wired to the shared authStore.resendVerification action,
 * which POSTs /auth/resend-verification (authenticated). Mirrors web's
 * UserMenuAccountSection resend button.
 */
export default function AccountEmailVerifySection() {
  const t = useTokens();
  const styles = useStyles();
  const user = useAuthStore((s) => s.user);
  const resendVerification = useAuthStore((s) => s.resendVerification);

  const [submitting, setSubmitting] = useState(false);

  // Soft indicator only — hidden entirely for email-less or already-verified users.
  if (!user?.email || user.emailVerified) return null;

  const handleResend = async () => {
    setSubmitting(true);
    try {
      await resendVerification();
      Alert.alert('Verification email sent', 'Check your inbox to verify your email address.');
    } catch (err) {
      Alert.alert('Could not send email', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="mail-unread-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Email not verified</Text>
          <Text style={styles.rowHint} numberOfLines={1}>
            {user.email}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.resend, submitting && styles.resendDisabled]}
          onPress={() => void handleResend()}
          disabled={submitting}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Resend verification email"
          accessibilityState={{ disabled: submitting }}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
          ) : (
            <Text style={styles.resendText}>Resend</Text>
          )}
        </TouchableOpacity>
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
  resend: {
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    minHeight: 36,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
  },
  resendDisabled: {
    opacity: 0.6,
  },
  resendText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
