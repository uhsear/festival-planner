import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Linking,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';

// No in-app Terms route exists yet; open the canonical web Terms of Service,
// mirroring how the privacy screen links out to it.
const TERMS_URL = 'https://festie.us/terms.html';

export default function RegisterScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    if (!username.trim() || !email.trim() || !password.trim()) return;
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
          { paddingTop: insets.top + spacing[6], paddingBottom: insets.bottom + spacing[6] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Festie</Text>
        <Text style={styles.subtitle}>Create your account</Text>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        <TextInput
          style={[styles.input, focusedField === 'username' && styles.inputFocused]}
          placeholder="Username"
          placeholderTextColor={colors.text.placeholder}
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
          style={[styles.input, focusedField === 'email' && styles.inputFocused]}
          placeholder="Email"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onFocus={onFocusOf('email')}
          onBlur={onBlurOf('email')}
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />

        <View style={[styles.passwordRow, focusedField === 'password' && styles.inputFocused]}>
          <TextInput
            ref={passwordRef}
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={colors.text.placeholder}
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
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>At least 8 characters. Avoid common passwords and your name.</Text>

        <TextInput
          ref={confirmRef}
          style={[styles.input, focusedField === 'confirm' && styles.inputFocused]}
          placeholder="Confirm Password"
          placeholderTextColor={colors.text.placeholder}
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
              color={tosAccepted ? colors.accent.aqua : colors.text.secondary}
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

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.text.onLightAccent} />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </TouchableOpacity>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  inner: {
    flexGrow: 1,
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
    padding: spacing[2],
  },
  hint: {
    fontSize: fontSize[12],
    color: colors.text.muted,
    marginTop: -spacing[1],
    marginBottom: spacing[3],
  },
  tosRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  tosCheckbox: {
    paddingTop: spacing[1],
  },
  tosTextWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  tosText: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
  },
  guestButton: {
    marginTop: spacing[5],
    alignItems: 'center',
  },
  button: {
    // PRIMARY CTA = aqua fill + dark ink per the accent rule (coral = danger/SOS only).
    backgroundColor: colors.accent.aqua,
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
    color: colors.text.onLightAccent,
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
