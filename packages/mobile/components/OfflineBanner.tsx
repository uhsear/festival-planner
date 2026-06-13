import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { useUIStore } from '@festie/shared/stores';
import type { FailedSyncItem } from '@festie/shared/stores';
import * as offlineQueue from '@festie/shared/services/offlineQueue';
import { drainQueue, refreshPendingCount } from '@festie/shared/services';
import { timeAgo } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Retry a single failed mutation via the shared queue helper, which re-enqueues
 * it, clears it from failedSync, and drains immediately when back online.
 */
function retryFailed(item: FailedSyncItem): void {
  Promise.resolve(offlineQueue.retryFailed(item)).catch((e) => Sentry.captureException(e));
}

/**
 * Offline banner — the mobile analog of the web OfflineBanner. Subscribes to
 * NetInfo for connectivity and drives the shared uiStore.offlineMode, then
 * surfaces three states (priority order):
 *
 *  1. FAILED  — failedSync.length > 0: a coral bar "{n} couldn't sync" that
 *     opens a modal listing each item with Retry / Dismiss.
 *  2. OFFLINE — offlineMode: amber "you're offline" + pending count.
 *  3. SYNCING — online with pendingSync > 0: "Syncing {n}…".
 *
 * Mounted once at the app root so it overlays every screen.
 */
export default function OfflineBanner() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const offlineMode = useUIStore((s) => s.offlineMode);
  const setOfflineMode = useUIStore((s) => s.setOfflineMode);
  const pendingSync = useUIStore((s) => s.pendingSync);
  const failedSync = useUIStore((s) => s.failedSync);
  const dismissFailedSync = useUIStore((s) => s.dismissFailedSync);
  const clearFailedSync = useUIStore((s) => s.clearFailedSync);
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const failedCount = failedSync.length;

  // Drive shared offline state from device connectivity.
  useEffect(() => {
    refreshPendingCount().catch((e) => Sentry.captureException(e));
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setOfflineMode(!online);
      if (online) drainQueue().catch((e) => Sentry.captureException(e));
    });
    return () => unsubscribe();
  }, [setOfflineMode]);

  // Re-arm the offline banner for the next offline episode once back online.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- event-driven re-arm: once connectivity returns, clear the user's manual dismissal so the banner can show again on the next offline episode. Not derivable — `dismissed` is user intent that must persist within an episode.
    if (!offlineMode && dismissed) setDismissed(false);
  }, [offlineMode, dismissed]);

  // ── State resolution (FAILED > OFFLINE > SYNCING) ─────────────────
  const showFailed = failedCount > 0;
  const showOffline = offlineMode && !dismissed;
  const showSyncing = !offlineMode && pendingSync > 0;

  const renderBar = () => {
    if (showFailed) {
      return (
        <TouchableOpacity
          style={[styles.banner, styles.bannerFailed, { paddingTop: insets.top + t.spacing[2] }]}
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${failedCount} change${failedCount === 1 ? '' : 's'} couldn't sync — review`}
        >
          <Ionicons name="warning" size={16} color={t.colors.bg.primary} />
          <Text style={styles.text} numberOfLines={2}>
            {failedCount} change{failedCount === 1 ? '' : 's'} couldn&apos;t sync — tap to review
          </Text>
          <Ionicons name="chevron-forward" size={18} color={t.colors.bg.primary} />
        </TouchableOpacity>
      );
    }
    if (showOffline) {
      return (
        <View
          style={[styles.banner, { paddingTop: insets.top + t.spacing[2] }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.dot} />
          <Text style={styles.text} numberOfLines={2}>
            {pendingSync > 0
              ? `You're offline — showing your saved schedule · ${pendingSync} change${pendingSync === 1 ? '' : 's'} will sync when you reconnect`
              : "You're offline — showing your saved schedule"}
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
    if (showSyncing) {
      return (
        <View
          style={[styles.banner, styles.bannerSyncing, { paddingTop: insets.top + t.spacing[2] }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.dot} />
          <Text style={styles.text} numberOfLines={2}>
            Syncing {pendingSync} change{pendingSync === 1 ? '' : 's'}…
          </Text>
        </View>
      );
    }
    return null;
  };

  return (
    <>
      {renderBar()}

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalDismissArea} activeOpacity={1} onPress={() => setSheetOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + t.spacing[3] }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {failedCount} change{failedCount === 1 ? '' : 's'} couldn&apos;t sync
              </Text>
              <TouchableOpacity
                onPress={() => setSheetOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.dismiss}
              >
                <Ionicons name="close" size={20} color={t.colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetList}>
              {failedSync.map((item) => (
                <View key={item.clientId} style={styles.failedRow}>
                  <View style={styles.failedInfo}>
                    <Text style={styles.failedLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.failedMeta} numberOfLines={1}>
                      <Text style={styles.failedError}>{item.error}</Text> · {timeAgo(item.at)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => retryFailed(item)}
                    style={styles.retryBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry ${item.label}`}
                  >
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => dismissFailedSync(item.clientId)}
                    style={styles.dismissBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss ${item.label}`}
                  >
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                onPress={() => clearFailedSync()}
                style={styles.dismissBtn}
                accessibilityRole="button"
                accessibilityLabel="Dismiss all"
              >
                <Text style={styles.dismissText}>Dismiss all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => failedSync.forEach(retryFailed)}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel="Retry all"
              >
                <Text style={styles.retryText}>Retry all</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  bannerFailed: {
    backgroundColor: t.colors.accent.coral,
  },
  bannerSyncing: {
    backgroundColor: t.colors.accent.aqua,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.bg.primary,
  },
  text: {
    ...typeStyle('caption', 600),
    color: t.colors.bg.primary,
    flex: 1,
  },
  dismiss: {
    padding: t.spacing[1],
  },
  // ── Failed-items modal ──────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: t.colors.shade[9], // modal scrim (rgba(0,0,0,0.45))
  },
  modalDismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: t.colors.bg.secondary,
    borderTopLeftRadius: t.radii.lg,
    borderTopRightRadius: t.radii.lg,
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    maxHeight: '70%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: t.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  sheetTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  sheetList: {
    marginVertical: t.spacing[2],
  },
  failedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.light,
  },
  failedInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  failedLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  failedMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  failedError: {
    color: t.colors.accent.coral,
  },
  retryBtn: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.aquaAlpha[15],
  },
  retryText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  dismissBtn: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  dismissText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  sheetFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingTop: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
}));
