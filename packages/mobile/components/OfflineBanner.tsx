import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useUIStore } from '@festie/shared/stores';
import { drainQueue } from '@festie/shared/services';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Offline banner — the mobile analog of the web OfflineBanner. Subscribes to
 * NetInfo for connectivity and drives the shared uiStore.offlineMode (which web
 * drives from navigator.onLine), then shows a dismissible amber banner while
 * offline. Mounted once at the app root so it overlays every screen.
 */
export default function OfflineBanner() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const offlineMode = useUIStore((s) => s.offlineMode);
  const setOfflineMode = useUIStore((s) => s.setOfflineMode);
  const [dismissed, setDismissed] = useState(false);

  // Drive shared offline state from device connectivity.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      setOfflineMode(!online);
      // Back online: replay any pick/note mutations queued while offline.
      if (online) drainQueue().catch(() => {});
    });
    return () => unsubscribe();
  }, [setOfflineMode]);

  // Re-arm the banner for the next offline episode once back online.
  useEffect(() => {
    if (!offlineMode && dismissed) setDismissed(false);
  }, [offlineMode, dismissed]);

  if (!offlineMode || dismissed) return null;

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + t.spacing[2] }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={2}>
        You're offline — changes will sync when you reconnect
      </Text>
      <TouchableOpacity
        onPress={() => setDismissed(true)}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss offline notice"
      >
        <Ionicons name="close" size={18} color={t.colors.bg.primary} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
    backgroundColor: t.colors.accent.amber,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.bg.primary,
  },
  text: {
    ...typeStyle('caption'),
    fontWeight: '600',
    color: t.colors.bg.primary,
    flex: 1,
  },
  dismiss: {
    padding: t.spacing[1],
  },
}));
