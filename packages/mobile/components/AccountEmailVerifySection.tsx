import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Email-verification status + resend action for the Account screen.
 *
 * Renders only when the signed-in user has an email on file that is not yet
 * verified. Email is OPTIONAL at signup, so this is a soft status indicator —
 * there is no lockout. Wired to the shared authStore.resendVerification action,
 * which POSTs /auth/resend-verification (authenticated). Mirrors web's
 * UserMenuAccountSection resend button.
 */
const RESEND_COOLDOWN_S = 30;

export default function AccountEmailVerifySection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const resendVerification = useAuthStore((s) => s.resendVerification);

  const [submitting, setSubmitting] = useState(false);
  // Throttle resends with a visible countdown so an impatient tap-tap-tap
  // doesn't spam the endpoint — and the user gets honest "sent" feedback.
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Soft indicator only — hidden entirely for email-less or already-verified users.
  if (!user?.email || user.emailVerified) return null;

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_S);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (submitting || cooldown > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await resendVerification();
      haptics.success();
      setSent(true);
      startCooldown();
    } catch (err) {
      haptics.warning();
      setError(err instanceof Error ? err.message : 'Could not send. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || cooldown > 0;
  const buttonLabel = submitting ? '' : cooldown > 0 ? `${cooldown}s` : sent ? 'Resend' : 'Verify';

  return (
    <View style={styles.card}>
      <View style={styles.accentBar} />
      <View style={styles.inner}>
        <View style={styles.row}>
          <View style={styles.rowIcon}>
            <Ionicons name="mail-unread-outline" size={20} color={t.colors.accent.amber} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Verify your email</Text>
            <Text style={styles.rowHint} numberOfLines={1} ellipsizeMode="middle">
              {user.email}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.resend, disabled && styles.resendDisabled]}
            onPress={() => void handleResend()}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              cooldown > 0 ? `Resend available in ${cooldown} seconds` : 'Resend verification email'
            }
            accessibilityState={{ disabled }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={t.colors.text.onLightAccent} />
            ) : (
              <Text style={styles.resendText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {buttonLabel}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {sent && !error ? (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={14} color={t.colors.status.verified} style={styles.noticeIcon} />
            <Text style={styles.noticeText}>Sent — check your inbox (and spam) for the link.</Text>
          </View>
        ) : (
          <Text style={styles.subHint}>Verify to secure your account and keep recovery options open.</Text>
        )}

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    flexDirection: 'row',
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.amberAlpha[20],
    overflow: 'hidden',
  },
  // Left accent rail marks this as an actionable nudge without shouting.
  accentBar: {
    width: 3,
    backgroundColor: t.colors.accent.amber,
  },
  inner: {
    flex: 1,
    paddingBottom: t.spacing[3],
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
  subHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[4],
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
  },
  noticeIcon: {
    marginRight: t.spacing[1],
  },
  noticeText: {
    ...typeStyle('caption'),
    color: t.colors.status.verified,
    flexShrink: 1,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[1],
  },
  resend: {
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.pill,
    minHeight: 36,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
  },
  resendDisabled: {
    opacity: 0.55,
  },
  resendText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
}));
