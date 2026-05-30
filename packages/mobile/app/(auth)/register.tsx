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
import { Link } from 'expo-router';
import { useAuthStore } from '@festie/shared/stores';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';

export default function RegisterScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const register = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleRegister = async () => {
    Keyboard.dismiss();
    if (!username.trim() || !email.trim() || !password.trim()) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    try {
      await register({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        tosAccepted: true,
      });
    } catch {
      // Error is set in the store.
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Festie</Text>
        <Text style={styles.subtitle}>Create your account</Text>

        {error ? (
          <Text
            style={styles.error}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {error}
          </Text>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          blurOnSubmit={false}
        />

        <TextInput
          ref={emailRef}
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />

        <TextInput
          ref={passwordRef}
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          blurOnSubmit={false}
        />

        <TextInput
          ref={confirmRef}
          style={styles.input}
          placeholder="Confirm Password"
          placeholderTextColor={colors.text.placeholder}
          accessibilityLabel="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleRegister}
        />

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
            <ActivityIndicator color={colors.text.onAccent} />
          ) : (
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="link"
            accessibilityLabel="Sign in to an existing account"
          >
            <Text style={styles.linkText}>
              Already have an account?{' '}
              <Text style={styles.linkTextAccent}>Sign in</Text>
            </Text>
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
