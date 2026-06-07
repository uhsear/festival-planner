import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';

const EMAIL_RE = /^\S+@\S+\.[a-zA-Z]{2,}$/;

/**
 * Forgot-password screen — mobile mirror of the web /forgot-password page.
 * Collects an email and calls the shared authStore.forgotPassword, then shows
 * a "check your email" confirmation. The reset link itself is completed via the
 * emailed link (the backend handles the reset); this screen only requests it.
 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);

  const handleSubmit = async () => {
    Keyboard.dismiss();
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email is required');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Invalid email address');
      return;
    }
    setEmailError('');
    setError(null);
    try {
      await forgotPassword({ email: trimmed });
      setSubmitted(true);
    } catch {
      // Error is set in the store and surfaced below.
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Festie</Text>
        <Text style={styles.subtitle}>Reset your password</Text>

        {!submitted ? (
          <>
            {error ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {error}
              </Text>
            ) : null}

            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.text.placeholder}
              accessibilityLabel="Email address"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) setEmailError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
            {emailError ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {emailError}
              </Text>
            ) : null}
            <Text style={styles.helper}>We'll send you a link to reset your password.</Text>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={isLoading}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Send reset link"
              accessibilityState={{ disabled: isLoading, busy: isLoading }}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.text.onAccent} />
              ) : (
                <Text style={styles.buttonText}>Send reset link</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.successBox} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={48} color={colors.accent.aqua} />
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successBody}>We've sent a password reset link to {email.trim()}.</Text>
            <Text style={styles.successHint}>
              The link expires in 1 hour. If you don't see it, check your spam folder.
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setSubmitted(false);
                setEmail('');
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Try a different email"
            >
              <Text style={styles.secondaryButtonText}>Try a different email</Text>
            </TouchableOpacity>
          </View>
        )}

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkTextAccent}>Back to sign in</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  title: {
    fontSize: fontSize[32],
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing[1],
  },
  subtitle: {
    fontSize: fontSize[16],
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing[8],
  },
  error: {
    fontSize: fontSize[14],
    color: colors.text.danger,
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  input: {
    backgroundColor: colors.bg.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.default,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize[16],
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  helper: {
    fontSize: fontSize[14],
    color: colors.text.muted,
    marginBottom: spacing[4],
  },
  button: {
    backgroundColor: colors.accent.coral,
    borderRadius: radii.default,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: fontSize[16],
    fontWeight: '600',
    color: colors.text.onAccent,
  },
  successBox: {
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[5],
    borderRadius: radii.default,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
  },
  successTitle: {
    fontSize: fontSize[18],
    fontWeight: '600',
    color: colors.text.primary,
  },
  successBody: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
    textAlign: 'center',
  },
  successHint: {
    fontSize: fontSize[14],
    color: colors.text.muted,
    textAlign: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.accent.aqua,
    borderRadius: radii.default,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: spacing[2],
  },
  secondaryButtonText: {
    fontSize: fontSize[14],
    fontWeight: '600',
    color: colors.accent.aqua,
  },
  linkButton: {
    marginTop: spacing[5],
    alignItems: 'center',
  },
  linkTextAccent: {
    fontSize: fontSize[14],
    color: colors.accent.aqua,
    fontWeight: '600',
  },
});
