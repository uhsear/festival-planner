import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStorage } from '@festie/shared/platform';
import { configureApi, setAuthToken } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import * as Sentry from '@sentry/react-native';
import { UIProvider } from '../contexts/UIContext';
import OfflineBanner from '../components/OfflineBanner';

// Crash/error monitoring — mirrors the web's env-gated Sentry init. No-op
// until EXPO_PUBLIC_SENTRY_DSN is set (so it ships inert and activates once a
// mobile Sentry project DSN is provided at build time).
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.05),
  });
}

// Configure platform adapters before any store hydrates.
configureStorage(AsyncStorage);

// Wire up 401 handling: attempt a token refresh, then logout on failure.
configureApi({
  baseUrl: 'https://festie.us/api/v1',
  authMode: 'bearer',
  onUnauthorized: async () => {
    try {
      await useAuthStore.getState().refreshToken();
      return true;
    } catch {
      await useAuthStore.getState().logout();
      return false;
    }
  },
});

function AuthGate() {
  const user = useAuthStore((s) => s.user);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const checkSession = useAuthStore((s) => s.checkSession);
  const segments = useSegments();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  // Wait for Zustand persist to rehydrate from AsyncStorage, then restore
  // the bearer token into the API client's in-memory state so that
  // checkSession (and all subsequent requests) include the Authorization
  // header.
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      const token = useAuthStore.getState().userToken;
      if (token) {
        setAuthToken(token);
      }
      setHydrated(true);
    });

    // If hydration already completed synchronously (e.g. noop storage)
    if (useAuthStore.persist.hasHydrated()) {
      const token = useAuthStore.getState().userToken;
      if (token) {
        setAuthToken(token);
      }
      setHydrated(true);
    }

    return unsub;
  }, []);

  // Once hydrated, validate the session against the server.
  useEffect(() => {
    if (hydrated) {
      checkSession();
    }
  }, [hydrated, checkSession]);

  // Redirect based on auth state once the session has been checked.
  useEffect(() => {
    if (!sessionChecked) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, sessionChecked, segments, router]);

  // Show a splash loading indicator while hydration + session check run.
  if (!hydrated || !sessionChecked) {
    return (
      <View style={styles.splash}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#FF6B6B" />
      </View>
    );
  }

  return (
    <View style={styles.appShell}>
      <StatusBar style="light" />
      <OfflineBanner />
      <View style={styles.appShell}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="set/[setId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="privacy" options={{ presentation: 'card', headerShown: false }} />
        </Stack>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0E1A',
  },
  appShell: {
    flex: 1,
  },
});

function RootLayout() {
  return (
    <SafeAreaProvider>
      <UIProvider>
        <AuthGate />
      </UIProvider>
    </SafeAreaProvider>
  );
}

// Sentry.wrap adds the error boundary + perf instrumentation; it's a safe
// pass-through when Sentry isn't initialized (no DSN configured).
export default Sentry.wrap(RootLayout);
