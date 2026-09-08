import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineReadinessStore, useCrewStore } from '@festie/shared/stores';
import type { ReadinessSection, SectionReadiness } from '@festie/shared/stores';
import { timeAgo } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { basemapCacheInfo, ensureBasemapCached } from '../lib/basemapCache';

interface Props {
  festivalId: string;
  /**
   * The festival's offline vector basemap archive, when it has one (read from
   * `mapConfig.offlineBasemap.pmtilesUrl` via `hasOfflineBasemap`). When null —
   * which is every festival an archive has not been authored for — the map step
   * is ABSENT rather than shown as a permanently disabled row, because there is
   * nothing the user could do to make it ready.
   */
  pmtilesUrl?: string | null;
}

const IDLE: SectionReadiness = { status: 'idle', syncedAt: null };

/**
 * The offline-map step. Deliberately NOT part of the shared readiness store:
 *
 *  - the mechanism is `expo-file-system`, which `@festie/shared` cannot import
 *    (shared also runs in the browser, where the module is a no-op stub), and
 *  - that store is zustand-persisted, while the archive lives in `Paths.cache`
 *    which the OS may evict at any time. A remembered "ready" would keep
 *    promising a map whose bytes are gone.
 *
 * So this status is READ FROM THE FILESYSTEM on mount and after every attempt.
 */
function sectionFromDisk(pmtilesUrl: string | null | undefined): SectionReadiness {
  const info = basemapCacheInfo(pmtilesUrl);
  return info.cached ? { status: 'ready', syncedAt: info.syncedAt } : IDLE;
}

function useOfflineMapSection(pmtilesUrl: string | null) {
  // Seed from disk during the first render rather than setting state inside an
  // effect: the cache is readable synchronously, so an effect would render IDLE
  // once and immediately re-render, and it trips react-hooks/set-state-in-effect.
  const [section, setSection] = useState<SectionReadiness>(() => sectionFromDisk(pmtilesUrl));

  const readFromDisk = useCallback(() => {
    setSection(sectionFromDisk(pmtilesUrl));
  }, [pmtilesUrl]);

  // Re-read only when the festival's archive URL changes; the initialiser above
  // covers the first render.
  const seenUrl = useRef(pmtilesUrl);
  useEffect(() => {
    if (seenUrl.current === pmtilesUrl) return;
    seenUrl.current = pmtilesUrl;
    readFromDisk();
  }, [pmtilesUrl, readFromDisk]);

  const download = useCallback(async () => {
    if (!pmtilesUrl) return;
    setSection({ status: 'syncing', syncedAt: null });
    // ensureBasemapCached never throws and never publishes a short archive when
    // the server reports a length, so a failure here is simply "still not
    // downloaded" — the map keeps working online, and Retry re-runs this.
    await ensureBasemapCached(pmtilesUrl);
    const info = basemapCacheInfo(pmtilesUrl);
    setSection(
      info.cached ? { status: 'ready', syncedAt: info.syncedAt } : { status: 'error', syncedAt: Date.now() },
    );
  }, [pmtilesUrl]);

  return { section, download };
}

// Ordered step list — matches store section order (schedule must finish first).
const SECTIONS: { key: ReadinessSection; label: string }[] = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'picks', label: 'My picks' },
  { key: 'crew', label: 'Crew plan' },
  { key: 'weather', label: 'Weather' },
  { key: 'art', label: 'Artist art' },
];

// R18: Animated aqua dot for the active/syncing state.
// Pulse: opacity 1 -> 0.45 -> 1 at 900ms. Skips animation when reduce-motion is on.
function ActiveDot() {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.7;
      return;
    }
    opacity.value = withRepeat(withTiming(0.45, { duration: 450, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduceMotion, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[dotStyles.activeDot, animStyle]} />;
}

const dotStyles = StyleSheet.create({
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: '#00e8d0',
  },
});

// R18: per-step row.
function StepRow({
  label,
  section,
  tick,
  onRetry,
}: {
  label: string;
  section: SectionReadiness;
  tick: number;
  onRetry?: () => void;
}) {
  // tick forces re-render so "synced N ago" advances from the device clock.
  void tick;

  const t = useTokens();
  const styles = useRowStyles();

  const isPending = section.status === 'idle';
  const isActive = section.status === 'syncing';
  const isDone = section.status === 'ready';
  const isError = section.status === 'error';

  const timeLabel =
    isDone && section.syncedAt != null
      ? `synced ${timeAgo(section.syncedAt)}`
      : isDone
        ? 'ready'
        : isError && section.syncedAt != null
          ? `failed · ${timeAgo(section.syncedAt)}`
          : isError
            ? 'failed'
            : null;

  return (
    <View
      style={styles.row}
      accessibilityRole="none"
      accessibilityLabel={`${label}: ${isActive ? 'downloading' : isDone ? 'ready' : isError ? 'error' : 'not downloaded'}`}
    >
      {/* Step indicator */}
      <View style={styles.indicator}>
        {isDone ? (
          <Ionicons name="checkmark-circle" size={16} color={t.colors.accent.aqua} />
        ) : isError ? (
          <Ionicons name="alert-circle" size={16} color={t.colors.accent.coral} />
        ) : isActive ? (
          <ActiveDot />
        ) : (
          <View style={styles.pendingDot} />
        )}
      </View>

      {/* Step label */}
      <Text
        style={[
          styles.label,
          isDone && styles.labelDone,
          isActive && styles.labelActive,
          isPending && styles.labelPending,
          isError && styles.labelError,
        ]}
      >
        {label}
      </Text>

      {/* Right-side: time label or retry */}
      {isError && onRetry ? (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={`Retry ${label}`}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      ) : timeLabel ? (
        <Text style={[styles.timeLabel, isError && styles.timeLabelError]} numberOfLines={1}>
          {timeLabel}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * R18: Mobile multi-step loader for the festival offline-download sync.
 *
 * Renders the five store-driven download sections (schedule / picks / crew /
 * weather / art) as a vertical step list with per-step state: pending dot,
 * active shimmer, done aqua check, error coral text + retry. Festivals that
 * have an offline basemap archive get a sixth "Offline map" step, driven by the
 * mobile-local basemap cache rather than the store (see useOfflineMapSection).
 *
 * Drives from offlineReadinessStore + lib/basemapCache; no store changes.
 *
 * Used in the picks tab (mobile mirror of web's OfflineReadinessCard) so the
 * crew can download before heading to the festival. No new dependencies.
 */
export default function OfflineReadinessCard({ festivalId, pmtilesUrl = null }: Props) {
  const t = useTokens();
  const styles = useCardStyles();

  const readiness = useOfflineReadinessStore((s) => s.byFestival[festivalId]);
  const downloadingFestivalId = useOfflineReadinessStore((s) => s.downloadingFestivalId);
  const downloadForOffline = useOfflineReadinessStore((s) => s.downloadForOffline);
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);

  // expo-file-system has no web implementation (downloadFileAsync warns and
  // resolves without writing), so the Expo web export shows NO map step rather
  // than one that could never go ready.
  const mapUrl = Platform.OS === 'web' ? null : pmtilesUrl;
  const { section: mapSection, download: downloadMap } = useOfflineMapSection(mapUrl);

  const isDownloading = downloadingFestivalId === festivalId || mapSection.status === 'syncing';

  // 30s tick so "synced N ago" keeps advancing from the device clock.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const hasDownloaded = !!readiness && SECTIONS.some(({ key }) => readiness[key]?.status === 'ready');

  const handleDownload = () => {
    void downloadForOffline(festivalId, activeCrewId ?? undefined);
    void downloadMap();
  };
  const handleRetry = () => void downloadForOffline(festivalId, activeCrewId ?? undefined);

  // The store's five sections, plus the map step when this festival has an
  // archive to download at all.
  const steps: { key: string; label: string; section: SectionReadiness; onRetry: () => void }[] = SECTIONS.map(
    ({ key, label }) => ({ key, label, section: readiness?.[key] ?? IDLE, onRetry: handleRetry }),
  );
  if (mapUrl) {
    steps.push({ key: 'map', label: 'Offline map', section: mapSection, onRetry: () => void downloadMap() });
  }

  return (
    <View style={styles.card} accessibilityRole="none" accessibilityLabel="Download festival for offline">
      {/* Header row: title + download button */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Download for offline</Text>
          <Text style={styles.subtitle}>
            {mapUrl
              ? 'Cache the schedule, picks, crew plan, weather, art, and the offline map basemap for no-signal use.'
              : 'Cache the schedule, picks, crew plan, weather, and art for no-signal use.'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleDownload}
          disabled={isDownloading}
          accessibilityRole="button"
          accessibilityLabel={
            isDownloading ? 'Downloading' : hasDownloaded ? 'Update offline cache' : 'Download for offline'
          }
          style={[styles.button, isDownloading && styles.buttonBusy]}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isDownloading ? 'cloud-download-outline' : 'download-outline'}
            size={14}
            color={t.colors.text.onLightAccent}
          />
          <Text style={styles.buttonText}>
            {isDownloading ? 'Downloading…' : hasDownloaded ? 'Update' : 'Download'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* R18: vertical step list */}
      <View style={styles.stepList} accessibilityRole="list">
        {steps.map(({ key, label, section, onRetry }, i) => (
          <View key={key} style={i < steps.length - 1 ? styles.stepBorder : undefined}>
            <StepRow
              label={label}
              section={section}
              tick={tick}
              onRetry={section.status === 'error' ? onRetry : undefined}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const useCardStyles = makeStyles((t) => ({
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
  },
  headerText: {
    flex: 1,
    gap: t.spacing[1],
  },
  title: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  subtitle: {
    ...typeStyle('micro'),
    color: t.colors.text.secondary,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.sm,
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    flexShrink: 0,
    minHeight: 44,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    ...typeStyle('micro', 600),
    color: t.colors.text.onLightAccent,
  },
  stepList: {
    marginTop: t.spacing[3],
  },
  stepBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
}));

const useRowStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  indicator: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: '#3a3a3a',
  },
  label: {
    ...typeStyle('caption'),
    flex: 1,
    color: t.colors.text.primary,
  },
  labelDone: {
    color: t.colors.text.primary,
  },
  labelActive: {
    color: t.colors.text.secondary,
  },
  labelPending: {
    color: t.colors.text.muted,
  },
  labelError: {
    color: t.colors.accent.coral,
  },
  timeLabel: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    flexShrink: 0,
  },
  timeLabelError: {
    color: t.colors.accent.coral,
  },
  retryButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    ...typeStyle('micro', 600),
    color: t.colors.accent.coral,
  },
}));
