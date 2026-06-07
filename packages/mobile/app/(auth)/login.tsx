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
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);

  const passwordRef = useRef<TextInput>(null);

  // iOS lacks Android's input ripple, so give TextInputs an explicit focus
  // affordance: accent border + subtle aqua ring (paired per token note).
  const [focusedField, setFocusedField] = useState<'username' | 'password' | null>(null);

  const handleLogin = async () => {
    Keyboard.dismiss();
    if (!username.trim() || !password.trim()) return;
    setError(null);
    try {
      await login({ username: username.trim(), password });
    } catch {
      // Error is set in the store.
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Festie</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        <TextInput
          testID="login-username-input"
          style={[styles.input, focusedField === 'username' && styles.inputFocused]}
          placeholder="Username"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          textContentType="username"
          returnKeyType="next"
          onFocus={() => setFocusedField('username')}
          onBlur={() => setFocusedField((f) => (f === 'username' ? null : f))}
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />

        <View style={[styles.passwordRow, focusedField === 'password' && styles.inputFocused]}>
          <TextInput
            testID="login-password-input"
            ref={passwordRef}
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={colors.text.placeholder}
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            textContentType="password"
            returnKeyType="go"
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField((f) => (f === 'password' ? null : f))}
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            testID="login-toggle-password"
            onPress={() => setShowPw((v) => !v)}
            style={styles.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
          >
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.text.onAccent} />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity style={styles.forgotButton} accessibilityRole="link" accessibilityLabel="Forgot password?">
            <Text style={styles.linkTextAccent}>Forgot password?</Text>
          </TouchableOpacity>
        </Link>

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="link"
            accessibilityLabel="Sign up for an account"
          >
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkTextAccent}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </Link>

        <TouchableOpacity
          style={styles.guestButton}
          onPress={() => router.replace('/(tabs)')}
          accessibilityRole="button"
          accessibilityLabel="Browse without an account"
        >
          <Text style={styles.linkText}>Browse without an account</Text>
        </TouchableOpacity>
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
  inputFocused: {
    borderColor: colors.accent.aqua,
    backgroundColor: colors.ring.aqua,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.input,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.default,
    marginBottom: spacing[3],
    paddingRight: spacing[2],
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize[16],
    color: colors.text.primary,
  },
  eyeButton: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  guestButton: {
    marginTop: spacing[5],
    alignItems: 'center',
  },
  button: {
    backgroundColor: colors.accent.coral,
    borderRadius: radii.default,
    paddingVertical: spacing[3],
    alignItems: 'center',
    marginTop: spacing[2],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: fontSize[16],
    fontWeight: '600',
    color: colors.text.onAccent,
  },
  forgotButton: {
    marginTop: spacing[4],
    alignItems: 'center',
  },
  linkButton: {
    marginTop: spacing[5],
    alignItems: 'center',
  },
  linkText: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
  },
  linkTextAccent: {
    color: colors.accent.aqua,
    fontWeight: '600',
  },
});
