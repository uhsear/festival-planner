import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { useUIStore } from '@festie/shared/stores';
import type { FailedSyncItem } from '@festie/shared/stores';
import * as offlineQueue from '@festie/shared/services/offlineQueue';
import { drainQueue, refreshPendingCount } from '@festie/shared/services';
import { timeAgo } from '@festie/shared/utils';
import { decideFlap } from '../lib/connectivityHysteresis';
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
interface OfflineBannerProps {
  /**
   * Reports whether a bar is currently rendered (any of FAILED / OFFLINE /
   * SYNCING). The chrome uses this to tell ScreenHeader the top safe-area inset
   * is already consumed by the banner, so the header doesn't double-apply it.
   */
  onActiveChange?: (active: boolean) => void;
}

export default function OfflineBanner({ onActiveChange }: OfflineBannerProps = {}) {
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

  // Bounded retry timer for a drain that leaves items queued while we're
  // still online (e.g. a transient 5xx) — the only other drain triggers are
  // NetInfo transitions and AppState foreground, neither of which fires again
  // on their own if the device never goes offline in between.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(15_000); // 15s, doubling to a 60s cap

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    backoffRef.current = 15_000;
  };

  const scheduleRetry = () => {
    if (retryTimerRef.current) return; // already scheduled
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      runDrain();
    }, backoffRef.current);
    backoffRef.current = Math.min(backoffRef.current * 2, 60_000);
  };

  // Single entry point for every drain trigger (NetInfo, AppState, retry
  // timer) so drain logic itself stays in the shared queue module.
  const runDrain = () => {
    drainQueue()
      .catch((e) => Sentry.captureException(e))
      .finally(() => {
        const { offlineMode: stillOffline, pendingSync: stillPending } = useUIStore.getState();
        if (!stillOffline && stillPending > 0) scheduleRetry();
        else clearRetryTimer();
      });
  };

  // Connectivity hysteresis: a reported transition must hold before it reaches
  // the store, because OfflineMap tears its WebView down on offlineMode (see
  // lib/connectivityHysteresis.ts for the delays and why they differ).
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the most recent NetInfo event reported. An armed offline flip is a
  // FLOOR that no later event restarts, so it can outlive the condition that
  // armed it; this is what the timer re-checks before committing.
  const lastReportedOnlineRef = useRef<boolean | null>(null);
  const pendingOnlineRef = useRef<boolean | null>(null);
  const firstNetEventRef = useRef(true);

  const cancelFlip = () => {
    if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    flipTimerRef.current = null;
    pendingOnlineRef.current = null;
  };

  // Drive shared offline state from device connectivity.
  useEffect(() => {
    refreshPendingCount().catch((e) => Sentry.captureException(e));

    // The drain has to run on the COMMIT, not on the raw event: drainQueue()
    // early-returns while uiStore still reads offline, so draining during the
    // confirm window would be a no-op and the queue would sit until the next
    // NetInfo event or foreground.
    const commit = (online: boolean) => {
      setOfflineMode(!online);
      if (online) runDrain();
    };

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      lastReportedOnlineRef.current = online;
      const firstEvent = firstNetEventRef.current;
      firstNetEventRef.current = false;
      const action = decideFlap({
        online,
        currentOffline: useUIStore.getState().offlineMode,
        pendingOnline: pendingOnlineRef.current,
        firstEvent,
      });
      if (action.type === 'ignore') {
        // Includes the online blip that arrives while an offline flip is armed.
        // The flip deliberately stays armed (see decideFlap), but a queue
        // stranded by a transient 5xx still relies on a duplicate online event
        // to drain, exactly as the 'cancel' path below does.
        if (online) runDrain();
        return;
      }
      cancelFlip();
      if (action.type === 'cancel') {
        // Already where this event says we should be. Still drain: this is the
        // path a duplicate online event took before hysteresis existed, and a
        // queue stranded by a transient 5xx relies on it.
        if (online) runDrain();
        return;
      }
      if (action.type === 'commit') {
        commit(online);
        return;
      }
      pendingOnlineRef.current = online;
      flipTimerRef.current = setTimeout(() => {
        // Cleared BEFORE the write so unmount-during-flush can't leave a live
        // handle, and so the commit sees no pending target.
        flipTimerRef.current = null;
        pendingOnlineRef.current = null;
        // The floor has elapsed, but the radio may have recovered inside it and
        // this flip was deliberately not cancelled. Commit only if the last
        // thing NetInfo said still agrees, so a single handover blip cannot
        // tear the map down 5s after it ended.
        if (lastReportedOnlineRef.current !== null && lastReportedOnlineRef.current !== online) return;
        commit(online);
      }, action.delayMs);
    });
    return () => {
      unsubscribe();
      // Unsubscribing stops new events but not an already-armed flip -- without
      // this, a timer fired after unmount writes stale connectivity into the
      // shared store.
      cancelFlip();
      clearRetryTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runDrain/cancelFlip close over refs only, stable across renders
  }, [setOfflineMode]);

  // Re-drain on foreground: a transient failure or a dropped background
  // reconnect can otherwise strand "Syncing N…" until the next NetInfo flip.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !offlineMode && pendingSync > 0) runDrain();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runDrain closes over refs only, stable across renders
  }, [offlineMode, pendingSync]);

  // Re-arm the offline banner for the next offline episode once back online.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- event-driven re-arm: once connectivity returns, clear the user's manual dismissal so the banner can show again on the next offline episode. Not derivable — `dismissed` is user intent that must persist within an episode.
    if (!offlineMode && dismissed) setDismissed(false);
  }, [offlineMode, dismissed]);

  // ── State resolution (FAILED > OFFLINE > SYNCING) ─────────────────
  const showFailed = failedCount > 0;
  const showOffline = offlineMode && !dismissed;
  const showSyncing = !offlineMode && pendingSync > 0;
  const active = showFailed || showOffline || showSyncing;

  // Report the bar's live presence to the chrome so the top safe-area inset is
  // applied exactly once (banner when shown, ScreenHeader otherwise). Reset to
  // false on unmount so a stale "active" can't strand the header inset.
  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

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
          <View
            style={[styles.sheet, { paddingBottom: insets.bottom + t.spacing[3] }]}
            accessibilityViewIsModal
          >
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
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 44,
    justifyContent: 'center',
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
    minHeight: 44,
    justifyContent: 'center',
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
