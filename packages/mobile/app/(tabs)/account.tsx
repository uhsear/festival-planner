import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@festie/shared/hooks';
import { useAuthStore } from '@festie/shared/stores';
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
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';

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
  // Bottom inset keeps the Danger Zone clear of the iPhone home indicator.
  const insets = useSafeAreaInsets();

  // Identity comes straight off the auth store (single source of truth).
  const user = useAuthStore((s) => s.user);
  // Logout is exposed via the shared useAuth hook per the contract.
  const { logout } = useAuth();

  // Reduce-motion reflects the OS accessibility setting; read-only on device.
  const reduceMotion = useReduceMotion();

  const [loggingOut, setLoggingOut] = useState(false);

  const avatarUrl = user?.avatar ?? user?.avatarUrl;
  const displayName = user?.name ?? user?.username ?? 'Account';

  const confirmLogout = () => {
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

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="Account" subtitle="Settings & preferences" icon="person-circle-outline" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Identity */}
        <View style={styles.identity}>
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
            <Text style={styles.name} numberOfLines={1}>
              {displayName}
            </Text>
            {user?.username ? (
              <Text style={styles.handle} numberOfLines={1}>
                @{user.username}
              </Text>
            ) : null}
            {user?.email ? (
              <Text style={styles.email} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>

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
        <View style={styles.card}>
          <View
            style={styles.row}
            accessibilityRole="text"
            accessibilityLabel={`Reduce motion is ${reduceMotion ? 'on' : 'off'} (controlled in system settings)`}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="accessibility-outline" size={20} color={t.colors.text.secondary} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Reduce Motion</Text>
              <Text style={styles.rowHint}>Follows your system accessibility setting</Text>
            </View>
            <View style={[styles.statusPill, reduceMotion && styles.statusPillOn]}>
              <Text style={[styles.statusText, reduceMotion && styles.statusTextOn]}>
                {reduceMotion ? 'On' : 'Off'}
              </Text>
            </View>
          </View>
        </View>

        {/* Festival */}
        <SectionLabel>Festival</SectionLabel>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/wrap')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Open your festival wrap"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="sparkles-outline" size={20} color={t.colors.text.secondary} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Festival Wrap</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                Your stats & top sets after the festival
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.colors.text.placeholder} />
          </TouchableOpacity>
        </View>

        {/* History — cross-festival year-over-year (M3) */}
        <SectionLabel>History</SectionLabel>
        <AccountHistorySection />

        {/* Data */}
        <SectionLabel>Data</SectionLabel>
        <AccountDataSection />

        {/* Legal */}
        <SectionLabel>Legal</SectionLabel>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/privacy')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Open the privacy policy"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="shield-checkmark-outline" size={20} color={t.colors.text.secondary} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Privacy Policy</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                How we handle your data
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.colors.text.placeholder} />
          </TouchableOpacity>
        </View>

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
      </ScrollView>
    </KeyboardAvoidingView>
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
  email: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
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
}));
