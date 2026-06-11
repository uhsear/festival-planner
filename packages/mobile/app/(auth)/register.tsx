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
  Linking,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import Button from '../../components/Button';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

// No in-app Terms route exists yet; open the canonical web Terms of Service,
// mirroring how the privacy screen links out to it.
const TERMS_URL = 'https://festie.us/terms.html';

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
  fieldError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    marginTop: -t.spacing[2],
    marginBottom: t.spacing[2],
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
  inputError: {
    borderColor: t.colors.text.danger,
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
    padding: t.spacing[2],
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginTop: -t.spacing[1],
    marginBottom: t.spacing[3],
  },
  tosRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  tosCheckbox: {
    paddingTop: t.spacing[1],
  },
  tosTextWrap: {
    flex: 1,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
  },
  tosText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  guestButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
  },
  // Create-account CTA layout only — fill/ink/disabled live in components/Button (F8).
  button: {
    marginTop: t.spacing[2],
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

export default function RegisterScreen() {
  const styles = useStyles();
  const t = useTokens();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // R25: gate hero reveal on reduce-motion preference
  const reduceMotion = useReduceMotion();
  const register = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // iOS lacks Android's input ripple, so give TextInputs an explicit focus
  // affordance: accent border + subtle aqua ring (paired per token note).
  const [focusedField, setFocusedField] = useState<'username' | 'email' | 'password' | 'confirm' | null>(null);
  const onFocusOf = (field: NonNullable<typeof focusedField>) => () => setFocusedField(field);
  const onBlurOf = (field: NonNullable<typeof focusedField>) => () => setFocusedField((f) => (f === field ? null : f));

  const handleRegister = async () => {
    Keyboard.dismiss();
    if (!username.trim() || !password.trim()) return;
    // F33: email is required on mobile (needed for password reset); show an
    // explicit inline error instead of silently ignoring a blank submission.
    if (!email.trim()) {
      setEmailError('Email is required for password reset');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!tosAccepted) {
      setError('Please accept the Terms of Service & Privacy Policy to continue');
      return;
    }
    setEmailError('');
    setError(null);
    try {
      await register({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        tosAccepted,
      });
    } catch {
      // Error is set in the store.
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
        {/* R25: hero staggered reveal — brand word then subtitle, gated on reduceMotion */}
        <Animated.Text style={styles.title} entering={reduceMotion ? undefined : FadeInDown.delay(300).duration(350)}>
          Festie
        </Animated.Text>
        <Animated.Text
          style={styles.subtitle}
          entering={reduceMotion ? undefined : FadeInDown.delay(360).duration(350)}
        >
          Create your account
        </Animated.Text>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        <TextInput
          style={[styles.input, focusedField === 'username' && styles.inputFocused]}
          placeholder="Username"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          textContentType="username"
          returnKeyType="next"
          onFocus={onFocusOf('username')}
          onBlur={onBlurOf('username')}
          onSubmitEditing={() => emailRef.current?.focus()}
          blurOnSubmit={false}
        />

        <TextInput
          ref={emailRef}
          style={[
            styles.input,
            focusedField === 'email' && styles.inputFocused,
            emailError ? styles.inputError : undefined,
          ]}
          // F33: placeholder explains WHY email is needed so the required field
          // isn't a surprise, matching the web label "Email (optional)" intent
          // but clarifying the mobile policy.
          placeholder="Email (for password reset)"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Email address, required for password reset"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (emailError) setEmailError('');
          }}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onFocus={onFocusOf('email')}
          onBlur={onBlurOf('email')}
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />
        {emailError ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {emailError}
          </Text>
        ) : null}

        <View style={[styles.passwordRow, focusedField === 'password' && styles.inputFocused]}>
          <TextInput
            ref={passwordRef}
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={t.colors.text.placeholder}
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            textContentType="newPassword"
            returnKeyType="next"
            onFocus={onFocusOf('password')}
            onBlur={onBlurOf('password')}
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
          style={[styles.input, focusedField === 'confirm' && styles.inputFocused]}
          placeholder="Confirm Password"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showPw}
          textContentType="newPassword"
          returnKeyType="go"
          onFocus={onFocusOf('confirm')}
          onBlur={onBlurOf('confirm')}
          onSubmitEditing={handleRegister}
        />

        <View style={styles.tosRow}>
          <TouchableOpacity
            onPress={() => setTosAccepted((v) => !v)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tosAccepted }}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            accessibilityHint="Toggles acceptance. The Terms of Service and Privacy Policy links are available separately."
            style={styles.tosCheckbox}
          >
            <Ionicons
              name={tosAccepted ? 'checkbox' : 'square-outline'}
              size={20}
              color={tosAccepted ? t.colors.accent.aqua : t.colors.text.secondary}
            />
          </TouchableOpacity>
          <View style={styles.tosTextWrap}>
            <Text style={styles.tosText}>I agree to the </Text>
            <TouchableOpacity
              onPress={() => void Linking.openURL(TERMS_URL)}
              accessibilityRole="link"
              accessibilityLabel="Read the Terms of Service, opens in browser"
            >
              <Text style={[styles.tosText, styles.linkTextAccent]}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.tosText}> &amp; </Text>
            <TouchableOpacity
              onPress={() => router.push('/privacy')}
              accessibilityRole="link"
              accessibilityLabel="Read the Privacy Policy"
            >
              <Text style={[styles.tosText, styles.linkTextAccent]}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Button
          label="Create account"
          onPress={handleRegister}
          loading={isLoading}
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
          style={styles.button}
        />

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="link"
            accessibilityLabel="Sign in to an existing account"
          >
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkTextAccent}>Sign in</Text>
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
