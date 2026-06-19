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
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import Button from '../../components/Button';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

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
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  passwordRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    marginBottom: t.spacing[3],
    paddingRight: t.spacing[2],
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  eyeButton: {
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  guestButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
  },
  // Sign-in CTA layout only — fill/ink/disabled live in components/Button (F8).
  button: {
    marginTop: t.spacing[2],
  },
  forgotButton: {
    marginTop: t.spacing[4],
    alignItems: 'center' as const,
  },
  linkButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
  },
  linkText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  linkTextAccent: {
    // Re-spread at 600 so the SemiBold cut loads (bare fontWeight fake-bolds
    // on Android over the weighted base family).
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));

export default function LoginScreen() {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // R25: gate hero reveal on reduce-motion preference
  const reduceMotion = useReduceMotion();
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Scroll the form so the top fields stay reachable on small phones and
          when the keyboard is up; flexGrow:1 keeps it vertically centered when
          there's room. Insets ride on the content so nothing hides under the
          status bar / home indicator. */}
      <ScrollView
        contentContainerStyle={[
          styles.inner,
          { paddingTop: insets.top + t.spacing[6], paddingBottom: insets.bottom + t.spacing[6] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* R25: hero staggered reveal — brand word (300ms) then subtitle (360ms).
            FadeInDown gives translateY+fade per spec. Gated on reduceMotion. */}
        <Animated.Text style={styles.title} entering={reduceMotion ? undefined : FadeInDown.delay(300).duration(350)}>
          Festie
        </Animated.Text>
        <Animated.Text
          style={styles.subtitle}
          entering={reduceMotion ? undefined : FadeInDown.delay(360).duration(350)}
        >
          Sign in to your account
        </Animated.Text>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        <TextInput
          testID="login-username-input"
          style={[styles.input, focusedField === 'username' && styles.inputFocused]}
          placeholder="Username"
          placeholderTextColor={t.colors.text.placeholder}
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
            placeholderTextColor={t.colors.text.placeholder}
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
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <Button
          label="Sign in"
          onPress={handleLogin}
          loading={isLoading}
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
          style={styles.button}
        />

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity style={styles.forgotButton} accessibilityRole="link" accessibilityLabel="Forgot password?">
            <Text style={styles.linkText}>Forgot password?</Text>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
