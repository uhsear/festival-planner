import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@festie/shared/services';
import Button from '../components/Button';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Reset-password screen reached via the deep link festie.us/reset-password?token=…
 * (Android App Link now; iOS Universal Link once APPLE_TEAM_ID is set). Posts to
 * /auth/reset-password { token, newPassword, confirmPassword }. If opened without
 * a token (or the app isn't installed) the web page handles it as a fallback.
 */

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg.primary },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: t.spacing[6] },
  icon: { alignSelf: 'center' as const, marginBottom: t.spacing[3] },
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
    marginBottom: t.spacing[4],
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
    marginBottom: t.spacing[3],
  },
  passwordRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingRight: t.spacing[2],
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  eyeButton: { padding: t.spacing[2], minWidth: 44, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginTop: t.spacing[1],
    marginBottom: t.spacing[3],
  },
  // CTA layout only — fill/ink/disabled live in components/Button (F8).
  button: { marginTop: t.spacing[2] },
  linkButton: { marginTop: t.spacing[5], alignItems: 'center' as const },
  linkText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));

export default function ResetPasswordScreen() {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const confirmRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    Keyboard.dismiss();
    if (!token) {
      setError('This reset link is missing its token. Request a new link.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword, confirmPassword });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset your password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.inner}>
          <Ionicons name="checkmark-circle" size={56} color={t.colors.accent.aqua} style={styles.icon} />
          <Text style={styles.title}>Password reset</Text>
          <Text style={styles.subtitle}>Sign in with your new password.</Text>
          <Button
            label="Sign in"
            onPress={() => router.replace('/(auth)/login')}
            accessibilityLabel="Go to sign in"
            style={styles.button}
          />
        </View>
      </View>
    );
  }

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
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.subtitle}>Choose a new password for your account.</Text>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="New password"
            placeholderTextColor={t.colors.text.placeholder}
            accessibilityLabel="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showPw}
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={() => setShowPw((v) => !v)}
            style={styles.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
          >
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.colors.text.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>At least 8 characters. Avoid common passwords and your name.</Text>

        <TextInput
          ref={confirmRef}
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showPw}
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
        />

        <Button label="Reset password" onPress={handleSubmit} loading={busy} style={styles.button} />

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => router.replace('/(auth)/forgot-password')}
          accessibilityRole="link"
          accessibilityLabel="Request a new reset link"
        >
          <Text style={styles.linkText}>Need a new link?</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
