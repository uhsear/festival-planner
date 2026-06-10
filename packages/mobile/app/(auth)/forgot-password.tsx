import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

const EMAIL_RE = /^\S+@\S+\.[a-zA-Z]{2,}$/;

/**
 * Forgot-password screen — mobile mirror of the web /forgot-password page.
 * Collects an email and calls the shared authStore.forgotPassword, then shows
 * a "check your email" confirmation. The reset link itself is completed via the
 * emailed link (the backend handles the reset); this screen only requests it.
 */

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[6],
  },
  title: {
    // display-lg = Syncopate 700 — brand wordmark, first impression screen.
    ...typeStyle('display-lg'),
    color: t.colors.text.primary,
    textAlign: 'center',
    marginBottom: t.spacing[1],
  },
  subtitle: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    marginBottom: t.spacing[8],
  },
  error: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
    textAlign: 'center',
    marginBottom: t.spacing[3],
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
    marginBottom: t.spacing[2],
  },
  helper: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
    marginBottom: t.spacing[4],
  },
  button: {
    // PRIMARY CTA = aqua + dark ink per the accent rule (coral on white failed
    // WCAG AA ~3.55:1; coral reserved for danger/SOS). Matches login/register.
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center' as const,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...typeStyle('label'),
    fontWeight: '600' as const,
    color: t.colors.text.onLightAccent,
  },
  successBox: {
    alignItems: 'center' as const,
    gap: t.spacing[3],
    padding: t.spacing[5],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  successTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  successBody: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  successHint: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    alignItems: 'center' as const,
    alignSelf: 'stretch' as const,
    marginTop: t.spacing[2],
  },
  secondaryButtonText: {
    ...typeStyle('label'),
    fontWeight: '600' as const,
    color: t.colors.accent.aqua,
  },
  linkButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
  },
  linkTextAccent: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    fontWeight: '600' as const,
  },
}));

export default function ForgotPasswordScreen() {
  const styles = useStyles();
  const t = useTokens();
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[
          styles.inner,
          { paddingTop: insets.top + t.spacing[6], paddingBottom: insets.bottom + t.spacing[6] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
              placeholderTextColor={t.colors.text.placeholder}
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
                <ActivityIndicator color={t.colors.text.onLightAccent} />
              ) : (
                <Text style={styles.buttonText}>Send reset link</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.successBox} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={48} color={t.colors.accent.aqua} />
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
