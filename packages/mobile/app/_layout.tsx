// MUST be first: configures AsyncStorage before any store module is imported
// (and thus before zustand-persist hydrates). See bootstrap.ts.
import '../bootstrap';
import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { configureApi, setAuthToken } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { colors, fontSize } from '@festie/shared/tokens';
import { useFonts, Syncopate_400Regular, Syncopate_700Bold } from '@expo-google-fonts/syncopate';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UIProvider } from '../contexts/UIContext';
import OfflineBanner from '../components/OfflineBanner';
import FirstRunIntro from '../components/FirstRunIntro';
import ErrorBoundary from '../components/ErrorBoundary';
import { useLocalReminders } from '../hooks/useLocalReminders';
import { ensureAndroidChannels } from '../hooks/useMobilePush';

// Hold the native splash until fonts + hydration + session check complete.
// hideAsync is called when `loading` flips false inside AuthGate; the existing
// 4-second bootTimedOut ceiling is the forced-hide backstop so the app never
// wedges. preventAutoHideAsync must run at module scope (before any render).
SplashScreen.preventAutoHideAsync().catch(() => {});

// First-run intro flag — mirrors the web key for parity.
const INTRO_KEY = 'festie_onboarding_completed';

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
    // GUEST GUARD: with no session there is nothing to refresh and nothing to
    // log out. Without this, any guest request that hits an authenticated
    // endpoint (e.g. an eagerly-mounted account section) 401s, the refresh
    // 401s too, and logout() -> resetAllStores() wipes the guest's festival
    // selection — the "festival opens then closes" bug.
    if (!useAuthStore.getState().userToken) {
      return false;
    }
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
  // null = still reading the flag; false = show intro; true = already seen.
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  // Brand typography (Stagelight): Syncopate for display roles, Space Grotesk
  // for body roles. Registered here so typeStyle()'s fontFamily faces exist
  // before any screen renders; the splash overlay below stays up until these
  // load so the app never flashes the system font then reflows into the brand
  // face. Weight-specific cuts mirror the role→weight map in useTokens.ts.
  const [fontsLoaded, fontError] = useFonts({
    Syncopate_400Regular,
    Syncopate_700Bold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Boot safety valve. The splash below covers the whole window with
  // pointerEvents="auto" while `loading` is true — so anything that pins
  // `loading` (a useFonts() call that never resolves on a prod/OTA build, or a
  // checkSession() that hangs with no signal at a festival) would leave the app
  // rendered but completely untappable / unscrollable. Force the splash down
  // after a hard ceiling so the UI is ALWAYS reachable; fonts swap in and the
  // session reconciles a frame later if/when they arrive. Normal boot resolves
  // in well under this, so users never see the timeout.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setBootTimedOut(true), 4000);
    return () => clearTimeout(id);
  }, []);

  // Ensure Android notification channels exist BEFORE any notification is
  // scheduled. useLocalReminders targets channelId 'updates' which must exist
  // even if the user never visits the Account screen (where useMobilePush
  // previously created them on first register).
  useEffect(() => {
    ensureAndroidChannels().catch(() => {});
  }, []);

  // Navigate when the user taps a push notification. Without this listener,
  // tapping a notification opens the app but never deep-links to the relevant
  // screen. The data payload from FCM/APNs includes a `deepLink` or `setId`
  // field that maps to an expo-router path.
  const notificationResponseRef = useRef<Notifications.Subscription | null>(null);
  useEffect(() => {
    notificationResponseRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.deepLink && typeof data.deepLink === 'string') {
        router.push(data.deepLink as any);
      } else if (data?.setId && typeof data.setId === 'string') {
        router.push(`/set/${data.setId}`);
      }
    });
    return () => {
      notificationResponseRef.current?.remove();
    };
  }, [router]);

  // M1: pre-computed on-device set reminders. Reconciles local notifications
  // whenever picks/reminders change (fires even in airplane mode); FCM stays the
  // at-home backstop. Mounted at the root so it tracks the active profile across
  // every screen.
  useLocalReminders();

  useEffect(() => {
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => setIntroSeen(v === 'true'))
      .catch(() => setIntroSeen(true)); // on error, don't block with the intro
  }, []);

  const dismissIntro = () => {
    setIntroSeen(true);
    AsyncStorage.setItem(INTRO_KEY, 'true').catch(() => {});
  };

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
      // Guests may browse the schedule, set detail, festival-mode, privacy, and
      // the picks/crew tabs (which render their own sign-in CTA). Only the
      // account tab and the full-screen wrap are gated — bounce a signed-out
      // user to login there; everything else stays mounted so cold deep-links
      // and casual browsing work without forcing an account first.
      const seg = segments as string[];
      const guestBlocked = seg[0] === 'wrap' || seg[1] === 'account';
      if (!user && guestBlocked && !inAuthGroup) {
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
  // Fonts are cosmetic — never let a font failure hard-block interaction; treat
  // a useFonts() error as "ready" so it can't pin the splash. The bootTimedOut
  // ceiling is the final backstop for any other hang (e.g. offline session
  // check).
  const fontsReady = fontsLoaded || !!fontError;
  const loading = (!hydrated || !sessionChecked || !fontsReady) && !bootTimedOut;

  // Dismiss the native splash as soon as loading resolves. The overlay below
  // stays as a fallback (same #080810 bg) so any frame gap is invisible. The
  // 4s bootTimedOut ceiling already triggers `loading = false`, so hideAsync
  // is always called eventually even if fonts or session check hang.
  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  return (
    <View style={styles.appShell}>
      {/* Light status bar is intentional: the whole app sits on a dark bg and
          every header is dark (enforced by design), so dark icons would clash. */}
      <StatusBar style="light" />
      {!loading && <OfflineBanner />}
      <View style={styles.appShell}>
        <ErrorBoundary>
          {/*
            Default headerShown:false — tabs/auth manage their own chrome. But
            several pushed routes (map, compass, plan-share, crew-plan,
            crew-compare, festival-mode, wrap) flip headerShown:true with just a
            title; these dark header defaults ensure that WHEN a header shows it
            matches the app's dark background instead of the native white bar.
            contentStyle keeps the screen body dark so there's no white flash
            between transitions. The StatusBar is intentionally light-content
            because every header in the app is dark (enforced by design).
          */}
          <Stack
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: colors.bg.secondary },
              headerTintColor: colors.text.primary,
              headerTitleStyle: {
                color: colors.text.primary,
                fontWeight: '600',
                fontSize: fontSize[18],
              },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg.primary },
              // Enable the iOS left-edge swipe-back gesture on every pushed
              // route (set detail, map, compass, crew-plan, etc.). It's the
              // platform-expected way to dismiss a screen on iOS; no-op on
              // Android (which uses the system back button / predictive back).
              gestureEnabled: true,
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen
              name="set/[setId]"
              options={{
                // Native form sheet (SDK 56): real grabber + peek/expand detents,
                // so the screen's own faux drag handle is removed. Half-height
                // peek lets users glance a set without losing their lineup scroll.
                presentation: 'formSheet',
                sheetAllowedDetents: [0.5, 1.0],
                sheetGrabberVisible: true,
                headerShown: false,
                headerTintColor: colors.text.primary,
              }}
            />
            <Stack.Screen
              name="privacy"
              options={{ presentation: 'card', headerShown: true, title: 'Privacy Policy' }}
            />
            <Stack.Screen name="reset-password" options={{ presentation: 'card', headerShown: false }} />
          </Stack>
        </ErrorBoundary>
      </View>
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.splash]} pointerEvents="auto">
          <ActivityIndicator size="large" color={colors.accent.aqua} />
        </View>
      )}
      {!loading && introSeen === false && <FirstRunIntro onDone={dismissIntro} />}
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg.primary,
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
