// MUST be first: configures AsyncStorage before any store module is imported
// (and thus before zustand-persist hydrates). See bootstrap.ts.
import '../bootstrap';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureApi, setAuthToken } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { UIProvider } from '../contexts/UIContext';
import OfflineBanner from '../components/OfflineBanner';

// @sentry/react-native is a third-party NATIVE module not present in the Expo
// Go runtime — calling init()/wrap() there warns and degrades. Detect Expo Go
// and skip Sentry so the app runs cleanly in Expo Go for quick UI iteration.
// (Full crash reporting still works in dev/preview/production builds.)
const isExpoGo = Constants.appOwnership === 'expo';

// Crash/error monitoring — mirrors the web's env-gated Sentry init. No-op
// until EXPO_PUBLIC_SENTRY_DSN is set (so it ships inert without a DSN). The
// @sentry/react-native Expo plugin IS configured in app.json (org festi-jn /
// project festie); release source maps upload during the EAS build via the
// SENTRY_AUTH_TOKEN env secret + scripts/install-sentry-cli.cjs (which provides
// the @sentry/cli binary that pnpm v10's build-script gating otherwise skips).
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN && !isExpoGo) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.05),
  });
}

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
  const navState = useRootNavigationState();
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

  // Redirect based on auth state once the session has been checked. Calling
  // router.replace before the navigator is mounted throws "Attempted to navigate
  // before mounting the Root Layout component" and wedges the app on the native
  // splash. Guarding on navState.key alone is NOT enough — that key is populated
  // a tick before navigationRef.isReady() returns true, so a replace fired from
  // this commit's passive-effect phase still hits the assertIsReady check.
  // Deferring to the next frame pushes the navigation past mount, by which point
  // the navigator is genuinely ready.
  useEffect(() => {
    if (!navState?.key) return;
    if (!sessionChecked) return;

    const raf = requestAnimationFrame(() => {
      const inAuthGroup = segments[0] === '(auth)';
      if (!user && !inAuthGroup) {
        router.replace('/(auth)/login');
      } else if (user && inAuthGroup) {
        router.replace('/(tabs)');
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [user, sessionChecked, segments, router, navState?.key]);

  // The navigator (Stack) MUST be mounted on the very first render so the
  // redirect effect above can navigate safely. So rather than swapping the
  // whole tree for a bare splash View while hydration + session check run
  // (which leaves no navigator mounted), keep the Stack mounted and lay the
  // splash spinner over it until we're ready.
  const loading = !hydrated || !sessionChecked;

  return (
    <View style={styles.appShell}>
      <StatusBar style="light" />
      {!loading && <OfflineBanner />}
      <View style={styles.appShell}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="set/[setId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="privacy" options={{ presentation: 'card', headerShown: false }} />
        </Stack>
      </View>
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.splash]} pointerEvents="auto">
          <ActivityIndicator size="large" color="#FF6B6B" />
        </View>
      )}
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
// pass-through when Sentry isn't initialized (no DSN configured). Skip it in
// Expo Go where the native module is absent.
export default isExpoGo ? RootLayout : Sentry.wrap(RootLayout);
