import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@festie/shared/hooks';
import { useAuthStore, useNotificationPrefsStore } from '@festie/shared/stores';
import ScreenHeader from '../../components/ScreenHeader';
import SectionLabel from '../../components/SectionLabel';
import AccountAvatarSection from '../../components/AccountAvatarSection';
import AccountDisplayNameSection from '../../components/AccountDisplayNameSection';
import AccountPaymentHandlesSection from '../../components/AccountPaymentHandlesSection';
import AccountPasswordSection from '../../components/AccountPasswordSection';
import AccountEmailVerifySection from '../../components/AccountEmailVerifySection';
import AccountNotificationsSection from '../../components/AccountNotificationsSection';
import AccountNotificationPrefsSection from '../../components/AccountNotificationPrefsSection';
import AccountHistorySection from '../../components/AccountHistorySection';
import AccountDataSection from '../../components/AccountDataSection';
import AccountDangerSection from '../../components/AccountDangerSection';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useHaptics } from '../../hooks/useHaptics';

/**
 * Account screen — mirrors packages/web/src/routes/account.tsx.
 *
 * Shows the signed-in identity, the avatar manager (upload/remove), a password
 * change form, the read-only device preferences that map to shared state today,
 * and a Logout action — all wired to platform-neutral shared store methods.
 *
 * Display-name change and account deletion are wired to platform-neutral shared
 * actions (authStore.updateDisplayName / authStore.deleteAccount) via dedicated
 * sections. The username is the permanent @handle and is not user-editable.
 *
 * Data export (GDPR) is wired via AccountDataSection (GET /account/export →
 * expo-file-system + expo-sharing).
 *
 * Push notifications are wired via AccountNotificationsSection (FCM token →
 * POST /notifications/token). Requires a real build — Expo Go can't obtain an
 * FCM device token.
 *
 * Theme / display is intentionally not built — it's not a web feature either.
 */
export default function AccountScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const haptics = useHaptics();
  // Bottom inset keeps the Danger Zone clear of the iPhone home indicator.
  const insets = useSafeAreaInsets();

  // Identity comes straight off the auth store (single source of truth).
  const user = useAuthStore((s) => s.user);
  // Admin entry is gated on the derived isAdmin flag (role-based).
  const isAdmin = useAuthStore((s) => s.isAdmin);
  // Logout is exposed via the shared useAuth hook per the contract.
  const { logout } = useAuth();

  // Reduce-motion reflects the OS accessibility setting; read-only on device.
  const reduceMotion = useReduceMotion();

  const [loggingOut, setLoggingOut] = useState(false);
  // Pull-to-refresh: a bump signal re-pulls the History card, and we reload
  // notification prefs in parallel so a swipe refreshes everything live.
  const [refreshing, setRefreshing] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);

  const avatarUrl = user?.avatar ?? user?.avatarUrl;
  const displayName = user?.name ?? user?.username ?? 'Account';
  const emailVerified = !!user?.emailVerified;
  const hasEmail = !!user?.email;
  const appVersion = Constants.expoConfig?.version ?? null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptics.tap();
    setHistoryReload((n) => n + 1);
    try {
      if (user) await useNotificationPrefsStore.getState().loadPrefs();
    } catch {
      // best-effort refresh — the History card surfaces its own error/retry.
    } finally {
      setRefreshing(false);
    }
  }, [haptics, user]);

  const confirmLogout = () => {
    haptics.warning();
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => void handleLogout(),
      },
    ]);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/(auth)/login');
    } catch {
      // logout clears local state even if the network call fails; still route out.
      router.replace('/(auth)/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const go = (path: '/wrap' | '/privacy' | '/admin') => {
    haptics.tap();
    router.push(path);
  };

  const IdentityCard = reduceMotion ? View : Animated.View;

  return (
    // KAV is dropped: behavior='padding' is a no-op on Android, and on iOS it
    // doesn't scroll the focused field into view when it's deep in the list.
    // automaticallyAdjustKeyboardInsets on the ScrollView handles both platforms
    // correctly (same pattern as app/set/[setId].tsx).
    <View style={styles.container}>
      <ScreenHeader title="Account" subtitle="Settings & preferences" icon="person-circle-outline" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={t.colors.accent.aqua}
            colors={[t.colors.accent.aqua]}
            progressBackgroundColor={t.colors.bg.secondary}
          />
        }
      >
        {/* Identity */}
        <IdentityCard
          entering={reduceMotion ? undefined : FadeInDown.duration(260)}
          style={styles.identity}
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`Signed in as ${displayName}${user?.username ? `, at ${user.username}` : ''}${
            hasEmail ? `, email ${emailVerified ? 'verified' : 'not verified'}` : ''
          }`}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              accessibilityIgnoresInvertColors
              accessibilityLabel={`${displayName} avatar`}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="person" size={36} color={t.colors.accent.aqua} />
            </View>
          )}
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {displayName}
            </Text>
            {user?.username ? (
              <Text style={styles.handle} numberOfLines={1}>
                @{user.username}
              </Text>
            ) : null}
            {hasEmail ? (
              <View style={styles.identityMeta}>
                <Text style={styles.email} numberOfLines={1} ellipsizeMode="middle">
                  {user?.email}
                </Text>
              </View>
            ) : null}
            <View style={styles.chips}>
              {hasEmail ? (
                <View
                  style={[styles.chip, emailVerified ? styles.chipVerified : styles.chipUnverified]}
                  accessibilityRole="text"
                  accessibilityLabel={emailVerified ? 'Email verified' : 'Email not verified'}
                >
                  <Ionicons
                    name={emailVerified ? 'checkmark-circle' : 'alert-circle'}
                    size={12}
                    color={emailVerified ? t.colors.status.verified : t.colors.accent.amber}
                    style={styles.chipIcon}
                  />
                  <Text
                    style={[styles.chipText, emailVerified ? styles.chipTextVerified : styles.chipTextUnverified]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    numberOfLines={1}
                  >
                    {emailVerified ? 'Verified' : 'Unverified'}
                  </Text>
                </View>
              ) : null}
              {isAdmin ? (
                <View style={[styles.chip, styles.chipAdmin]} accessibilityRole="text" accessibilityLabel="Administrator">
                  <Ionicons name="shield-half" size={12} color={t.colors.accent.aqua} style={styles.chipIcon} />
                  <Text style={[styles.chipText, styles.chipTextAdmin]} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
                    Admin
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </IdentityCard>

        {/* Profile photo — the AccountAvatarSection card carries its own
            "Profile Photo" title, so no separate section heading here. */}
        <AccountAvatarSection />

        {/* Profile */}
        <SectionLabel>Profile</SectionLabel>
        <AccountDisplayNameSection />
        <AccountPaymentHandlesSection />

        {/* Security */}
        <SectionLabel>Security</SectionLabel>
        <AccountEmailVerifySection />
        <AccountPasswordSection />

        {/* Preferences */}
        <SectionLabel>Preferences</SectionLabel>
        <AccountNotificationsSection />
        <AccountNotificationPrefsSection />

        {/* Festival */}
        <SectionLabel>Festival</SectionLabel>
        <View style={styles.card}>
          <LinkRow
            icon="sparkles-outline"
            title="Festival Wrap"
            hint="Your stats & top sets after the festival"
            onPress={() => go('/wrap')}
            accessibilityLabel="Open your festival wrap"
          />
        </View>

        {/* History — cross-festival year-over-year (M3) */}
        <SectionLabel>History</SectionLabel>
        <AccountHistorySection refreshSignal={historyReload} />

        {/* Data */}
        <SectionLabel>Data</SectionLabel>
        <AccountDataSection />

        {/* Legal */}
        <SectionLabel>Legal</SectionLabel>
        <View style={styles.card}>
          <LinkRow
            icon="shield-checkmark-outline"
            title="Privacy Policy"
            hint="How we handle your data"
            onPress={() => go('/privacy')}
            accessibilityLabel="Open the privacy policy"
          />
        </View>

        {/* Admin — only visible to administrators (read-only dashboard) */}
        {isAdmin ? (
          <>
            <SectionLabel>Admin</SectionLabel>
            <View style={styles.card}>
              <LinkRow
                icon="speedometer-outline"
                iconTint={t.colors.accent.aqua}
                title="Admin"
                hint="Dashboard, activity & festivals"
                onPress={() => go('/admin')}
                accessibilityLabel="Open the admin dashboard"
              />
            </View>
          </>
        ) : null}

        {/* Account actions */}
        <SectionLabel>Account</SectionLabel>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={confirmLogout}
            disabled={loggingOut}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Sign out of your account"
            accessibilityState={{ disabled: loggingOut }}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="log-out-outline" size={20} color={t.colors.text.danger} />
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, styles.dangerText]}>Sign Out</Text>
            </View>
            {loggingOut ? (
              <ActivityIndicator size="small" color={t.colors.text.danger} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={t.colors.text.placeholder} />
            )}
          </TouchableOpacity>
        </View>

        {/* Danger zone */}
        <SectionLabel>Danger Zone</SectionLabel>
        <AccountDangerSection onDeleted={() => router.replace('/(auth)/login')} />

        {/* App version footer — a quiet build stamp for support/debugging. */}
        {appVersion ? (
          <Text style={styles.version} accessibilityLabel={`App version ${appVersion}`}>
            Festie · v{appVersion}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * A single navigational row inside a card (Festival Wrap, Privacy, Admin).
 * Centralizes the icon + title + hint + chevron + light haptic so the three
 * link rows stay pixel-identical instead of drifting copy-paste.
 */
function LinkRow({
  icon,
  iconTint,
  title,
  hint,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconTint?: string;
  title: string;
  hint: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={iconTint ?? t.colors.text.secondary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.text.placeholder} />
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    // Centered, capped content width so cards don't span edge-to-edge on
    // tablets / large screens. On phones (< 600pt) this is a no-op and the
    // content simply fills the available width.
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[4],
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[4],
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.colors.bg.primary,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  identityText: {
    flex: 1,
    gap: t.spacing[1],
  },
  name: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  handle: {
    ...typeStyle('body'),
    color: t.colors.accent.aqua,
  },
  identityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  email: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[2],
    paddingVertical: 3,
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    ...typeStyle('micro'),
  },
  chipVerified: {
    backgroundColor: t.colors.status.verifiedBg,
    borderColor: t.colors.status.verifiedBg,
  },
  chipTextVerified: {
    color: t.colors.status.verified,
  },
  chipUnverified: {
    backgroundColor: t.colors.amberAlpha[12],
    borderColor: t.colors.amberAlpha[20],
  },
  chipTextUnverified: {
    color: t.colors.accent.amber,
  },
  chipAdmin: {
    backgroundColor: t.colors.aquaAlpha[10],
    borderColor: t.colors.aquaAlpha[20],
  },
  chipTextAdmin: {
    color: t.colors.accent.aqua,
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  dangerText: {
    color: t.colors.text.danger,
  },
  statusPill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    // Floor the pill width so "Off" never clips to "O" if the label is
    // measured a hair narrow (Android text-measure rounding).
    minWidth: 48,
    alignItems: 'center',
  },
  statusPillOn: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  statusText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statusTextOn: {
    color: t.colors.text.onLightAccent,
  },
  version: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
    marginTop: t.spacing[2],
  },
}));
