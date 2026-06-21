import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  extractMeetingPointPins,
  extractStagePins,
  formatStaleness,
  isPeerStale,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';

/**
 * OfflineMap (web platform extension) — `expo export -p web` build.
 *
 * The native OfflineMap (`OfflineMap.tsx`) hosts MapLibre inside a
 * `react-native-webview`. On the web export that dependency resolves to a stub
 * that renders a red "does not support this platform" banner plus a permanent
 * loading spinner — a broken, dishonest UI. This `.web.tsx` is picked up by
 * metro's platform-extension resolution INSTEAD of `OfflineMap.tsx` whenever the
 * bundle target is web (the consumer's `import OfflineMap from
 * '../components/OfflineMap'` is unchanged), so the broken WebView path never
 * ships on web.
 *
 * What it renders: the same offline-honest meeting-points + live-peer + SOS list
 * that the native component falls back to when MapLibre can't load. It reuses the
 * shared pin extractors and staleness helpers so the data shape stays in parity
 * with both native and `packages/web`'s `CrewMap.tsx`. It never shows the red
 * stub or a stuck spinner.
 *
 * Why a list and not a real interactive map: web's `CrewMap.tsx` renders a live
 * MapLibre GL JS map, but `maplibre-gl` is NOT a `@festie/mobile` dependency (it
 * lives under `packages/web/node_modules`), and importing `@festie/web` from
 * mobile violates the package boundary (see packages/mobile/CLAUDE.md). So this
 * file deliberately ships the honest list rather than a broken map or a boundary
 * violation. To upgrade this to a real web map later, add `maplibre-gl` as a
 * mobile dependency and port `CrewMap.tsx`'s dynamic-import GL wrapper here.
 */

interface OfflineMapProps {
  meetingPoints: CrewMeetingPoint[];
  /** Live crew peers currently sharing (ephemeral; from liveLocationStore). */
  peers?: PeerLocation[];
  /** Active crew SOS, if any (ephemeral; from liveLocationStore). */
  sos?: SosEntry | null;
}

/** Up-to-two-letter initials for an avatar marker (fallback "?"). */
function initialsFor(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** A peer/SOS row resolved from live-location props (mirrors OfflineMap.tsx). */
interface LivePin {
  id: string;
  label: string;
  sublabel?: string;
  initial: string;
  latitude: number;
  longitude: number;
  kind: 'peer' | 'sos';
  stale?: boolean;
  age?: string;
}

export default function OfflineMap({ meetingPoints, peers, sos }: OfflineMapProps) {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset();

  const pins = useMemo(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  const stagePins = useMemo(() => extractStagePins(), []); // [] today — see mapPins TODO

  // `now` ticks via useNow so staleness recomputes without an impure Date.now()
  // in the memo factory (react-hooks/purity) — same pattern as OfflineMap.tsx.
  const now = useNow();
  const livePins = useMemo<LivePin[]>(() => {
    const items: LivePin[] = [];
    for (const p of peers ?? []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const age = formatStaleness(p.serverAt).replace(/^as of /, '');
      const stale = isPeerStale(p.serverAt, now);
      items.push({
        id: `peer:${p.userId}`,
        label: p.username || 'Crew member',
        sublabel: stale ? `last seen ${age}` : `live · ${age}`,
        initial: initialsFor(p.username),
        latitude: p.lat,
        longitude: p.lng,
        kind: 'peer',
        stale,
        age,
      });
    }
    if (sos?.position && Number.isFinite(sos.position.lat) && Number.isFinite(sos.position.lng)) {
      items.push({
        id: `sos:${sos.userId}`,
        label: `${sos.username} — SOS`,
        sublabel: sos.message || 'Needs help',
        initial: '!',
        latitude: sos.position.lat,
        longitude: sos.position.lng,
        kind: 'sos',
      });
    }
    return items;
  }, [peers, sos, now]);

  // Meeting points present but without coords — listed so they're never lost,
  // even though they can't be plotted.
  const uncoordedPoints = useMemo(
    () =>
      (meetingPoints ?? []).filter(
        (p) => p && p.active !== false && !(Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      ),
    [meetingPoints],
  );

  const coorded = pins;
  const livePeerPins = livePins.filter((p) => p.kind === 'peer');
  const hasAny = coorded.length > 0 || uncoordedPoints.length > 0 || livePins.length > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.fallbackContent, { paddingBottom: bottomPad }]}>
      <View style={styles.banner}>
        <Ionicons name="map-outline" size={18} color={t.colors.accent.aqua} />
        <Text style={styles.bannerText}>
          The interactive map is available in the Festie app. Showing your meeting points and live crew here.
        </Text>
      </View>

      {/* SOS first — safety-critical, even with no map. */}
      {sos ? (
        <View
          style={styles.sosRow}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={`SOS from ${sos.username}${sos.message ? ', ' + sos.message : ''}`}
        >
          <Ionicons name="warning" size={20} color={t.colors.accent.coral} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{sos.username} — SOS</Text>
            <Text style={styles.rowSub}>
              {sos.message || (sos.position ? 'Shared their location' : 'No location — reach them directly')}
            </Text>
            {sos.position ? (
              <Text style={styles.rowCoord}>
                {sos.position.lat.toFixed(5)}, {sos.position.lng.toFixed(5)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Live peers — honest "last seen N ago" with no map. */}
      {livePeerPins.map((p) => (
        <View
          key={p.id}
          style={styles.row}
          accessible
          // Non-interactive info row (no onPress) — 'text', not 'button', so
          // screen readers don't announce a phantom actionable control.
          accessibilityRole="text"
          accessibilityLabel={`${p.label}, ${p.sublabel}`}
          accessibilityHint={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}
        >
          <Ionicons name="navigate-circle" size={18} color={t.colors.accent.aqua} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{p.label}</Text>
            <Text style={styles.rowSub}>{p.sublabel}</Text>
            <Text style={styles.rowCoord}>
              {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
            </Text>
          </View>
        </View>
      ))}

      {!hasAny ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="location-outline" size={32} color={t.colors.text.muted} />
          <Text style={styles.emptyTitle}>No meeting points yet</Text>
          <Text style={styles.emptyMsg}>
            Add a meeting point with a location in the Crew tab and it'll show here.
          </Text>
        </View>
      ) : null}

      {coorded.map((pin) => (
        <View
          key={pin.id}
          style={styles.row}
          // a11y: announce the whole row as one meeting-point entry so the
          // coords read as metadata, not a separate flat list item.
          accessible={true}
          // Non-interactive info row (no onPress) — 'text', not 'button'.
          accessibilityRole="text"
          accessibilityLabel={`Meeting point: ${pin.label}${pin.sublabel ? ', ' + pin.sublabel : ''}`}
          accessibilityHint={`${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
        >
          <Ionicons name="location" size={18} color={t.colors.accent.coral} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{pin.label}</Text>
            {pin.sublabel ? <Text style={styles.rowSub}>{pin.sublabel}</Text> : null}
            <Text style={styles.rowCoord}>
              {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
            </Text>
          </View>
        </View>
      ))}

      {uncoordedPoints.map((p) => (
        <View
          key={p.id}
          style={styles.row}
          accessible={true}
          // Non-interactive info row (no onPress) — 'text', not 'button'.
          accessibilityRole="text"
          accessibilityLabel={`Meeting point: ${p.label}${p.location ? ', ' + p.location : ''}`}
          accessibilityHint="No coordinates pinned"
        >
          <Ionicons name="location-outline" size={18} color={t.colors.text.muted} />
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>{p.label}</Text>
            {p.location ? <Text style={styles.rowSub}>{p.location}</Text> : null}
            <Text style={styles.rowCoordMuted}>No pinned location</Text>
          </View>
        </View>
      ))}

      {/* Stages: no coords in the data model today (see mapPins TODO). */}
      {stagePins.length === 0 ? <Text style={styles.stageNote}>Stage locations aren't mapped yet.</Text> : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  fallbackContent: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  bannerText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[6],
  },
  emptyTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  emptyMsg: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  sosRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowLabel: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  rowSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  rowCoord: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  rowCoordMuted: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  stageNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
    paddingTop: t.spacing[2],
  },
}));
