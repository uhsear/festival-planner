import { useState, useRef } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@festie/shared/services';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';

/**
 * Reset-password screen reached via the deep link festie.us/reset-password?token=…
 * (Android App Link now; iOS Universal Link once APPLE_TEAM_ID is set). Posts to
 * /auth/reset-password { token, newPassword, confirmPassword }. If opened without
 * a token (or the app isn't installed) the web page handles it as a fallback.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
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
      setError(e instanceof Error ? e.message : 'Could not reset your password. The link may have expired.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Ionicons name="checkmark-circle" size={56} color={colors.accent.aqua} style={styles.icon} />
          <Text style={styles.title}>Password reset</Text>
          <Text style={styles.subtitle}>Sign in with your new password.</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(auth)/login')}
            accessibilityRole="button"
            accessibilityLabel="Go to sign in"
          >
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>
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
            placeholderTextColor={colors.text.placeholder}
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
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>At least 8 characters. Avoid common passwords and your name.</Text>

        <TextInput
          ref={confirmRef}
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showPw}
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
        />

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={busy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Reset password"
        >
          {busy ? (
            <ActivityIndicator color={colors.text.onAccent} />
          ) : (
            <Text style={styles.buttonText}>Reset Password</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => router.replace('/(auth)/forgot-password')}
          accessibilityRole="link"
          accessibilityLabel="Request a new reset link"
        >
          <Text style={styles.linkText}>Need a new link?</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing[6] },
  icon: { alignSelf: 'center', marginBottom: spacing[3] },
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
    marginBottom: spacing[4],
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
    marginBottom: spacing[3],
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.default,
    paddingRight: spacing[2],
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize[16],
    color: colors.text.primary,
  },
  eyeButton: { padding: spacing[2] },
  hint: {
    fontSize: fontSize[12],
    color: colors.text.muted,
    marginTop: spacing[1],
    marginBottom: spacing[3],
  },
  button: {
    backgroundColor: colors.accent.coral,
    borderRadius: radii.default,
    paddingVertical: spacing[3],
    alignItems: 'center',
    marginTop: spacing[2],
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: fontSize[16], fontWeight: '600', color: colors.text.onAccent },
  linkButton: { marginTop: spacing[5], alignItems: 'center' },
  linkText: { fontSize: fontSize[14], color: colors.accent.aqua, fontWeight: '600' },
});
