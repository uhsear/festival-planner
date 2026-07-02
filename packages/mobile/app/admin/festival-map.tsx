import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import {
  amenityGlyph,
  amenityCount,
  buildAmenityFeature,
  appendAmenity,
  removeAmenity,
  stageCoordFromTap,
  AMENITY_PALETTE,
  humanizeAmenityType,
  buildZoneFeature,
  appendZone,
  removeZone,
  zoneCount,
  extractZones,
  ZONE_PALETTE,
  buildSiteplan,
  setSiteplan,
  removeSiteplan,
  extractSiteplan,
  isHttpsUrl,
  clampOpacity,
  SITEPLAN_DEFAULT_OPACITY,
  SITEPLAN_CORNER_LABELS,
  SITEPLAN_CORNER_COUNT,
} from '@festie/shared/utils';
import type { AmenityType, Festival, FestivalMapConfig, Stage } from '@festie/shared/types';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';
import { ConfirmDialog, LabeledTextInput } from '../../components/admin';
import OfflineMap from '../../components/OfflineMap';
import type { AuthoringMode } from '../../lib/webviewBridge';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — Festival MAP editor (Phase D). The geo-authoring counterpart to
 * festival-edit.tsx: it owns placing/moving stage pins and dropping amenity
 * markers on the actual map, then persists via the SAME PUT /admin/festivals/:id
 * write path (per-stage latitude/longitude on stageRows + festival.mapConfig).
 *
 * Lives under app/admin/ so the root AuthGate (seg[0]==='admin') guards it; a
 * non-admin who reaches it sees the "Admins only" empty state (mirrors
 * festival-edit's guard).
 *
 * The map is the OfflineMap WebView in authoring mode. Authoring REUSES the
 * existing tap-to-place path: arming a target puts the map in placement mode, the
 * next single tap reports its coordinate via onMapPress, and we apply it to the
 * armed target (a stage pin, or a new amenity of the selected palette type). No
 * new tap channel, CSP, host-allowlist, or serializer change — see webviewBridge.
 *
 *   ?id=<festivalId>  (required — there's nothing to map without a festival)
 *
 * Save: PUT /admin/festivals/:id with the festival's existing text fields
 * preserved verbatim + the edited stage coords + mapConfig. We load the FULL
 * festival (stages/days/timeZone) and round-trip the non-geo fields so saving the
 * map never drops lineup data.
 */

// Detail response from GET /festivals/:id — loosely typed; we read what we need
// to (a) author geo and (b) round-trip the text fields on save.
interface FestivalDetail {
  id: string;
  name?: string;
  location?: string;
  timeZone?: string | null;
  mapConfig?: FestivalMapConfig | null;
  stages?: { id?: string; name?: string; color?: string; latitude?: number | null; longitude?: number | null }[];
  days?: {
    id?: string;
    label?: string;
    date?: string;
    sets?: {
      id?: string;
      artist?: string;
      stageId?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      linkUrl?: string | null;
      artists?: { name?: string; links?: Record<string, string> }[];
    }[];
  }[];
}

// Local editable stage shape (carries the pin). Mirrors festivalEditState.StageRow.
interface StageEdit {
  id: string;
  name: string;
  color: string;
  latitude: number | null;
  longitude: number | null;
}

const DEFAULT_STAGE_COLOR = '#6a6a88';

// Discrete opacity steps for the site-plan overlay. React Native has no
// `<input type=range>` and Festie ships no slider native module, so the editor
// offers preset chips (pure JS, OTA-safe) instead of a continuous slider — the
// default (SITEPLAN_DEFAULT_OPACITY = 0.6) is one of the stops.
const SITEPLAN_OPACITY_PRESETS = [0.3, 0.45, 0.6, 0.75, 0.9] as const;

// What the next placement tap will do. null = idle (no target armed).
type ArmedTarget =
  | { kind: 'stage'; stageId: string }
  | { kind: 'amenity'; amenityType: AmenityType }
  | { kind: 'zone' }
  | { kind: 'siteplan' }
  | null;

/** A single tapped vertex while drawing a zone (geo.ts {latitude, longitude}). */
type Vertex = { latitude: number; longitude: number };

export default function FestivalMapEditorScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof id === 'string' && id.length > 0 ? id : null;

  const [name, setName] = useState('');
  const [stages, setStages] = useState<StageEdit[]>([]);
  const [mapConfig, setMapConfig] = useState<FestivalMapConfig | null>(null);
  // Non-geo fields we must round-trip verbatim on save (the server merges by id).
  const [detail, setDetail] = useState<FestivalDetail | null>(null);

  const [loading, setLoading] = useState(!!editingId);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Dirty flag: flipped by the geo edit handlers only (never by the initial
  // load hydration), so Cancel can tell an untouched map from one with
  // unsaved pin/zone/amenity/siteplan edits. Simplest honest signal — no deep compare.
  const [touched, setTouched] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const updateStages = useCallback((updater: (prev: StageEdit[]) => StageEdit[]) => {
    setTouched(true);
    setStages(updater);
  }, []);
  const updateMapConfig = useCallback((updater: (prev: FestivalMapConfig | null) => FestivalMapConfig | null) => {
    setTouched(true);
    setMapConfig(updater);
  }, []);
  const [armed, setArmed] = useState<ArmedTarget>(null);
  // New-amenity label buffer (used when an amenity target is armed).
  const [amenityLabel, setAmenityLabel] = useState('');
  // Zone drawing (Phase 4A): in-progress polygon vertices + chosen color/label.
  const [draftVertices, setDraftVertices] = useState<Vertex[]>([]);
  const [zoneColor, setZoneColor] = useState<string>(ZONE_PALETTE[0].color);
  const [zoneLabel, setZoneLabel] = useState('');
  const isDrawingZone = armed?.kind === 'zone';
  // Site-plan overlay (Phase 4B): https image URL + opacity are typed fields; the
  // 4 corners are tapped on the map (TL, TR, BR, BL) while armed. Committed
  // corners live in mapConfig.siteplan.
  const [siteplanUrl, setSiteplanUrl] = useState('');
  const [siteplanOpacity, setSiteplanOpacity] = useState<number>(SITEPLAN_DEFAULT_OPACITY);
  const [draftCorners, setDraftCorners] = useState<Vertex[]>([]);
  const isPlacingSiteplan = armed?.kind === 'siteplan';

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!editingId) return;
    setLoadError(false);
    try {
      const full = await api.get<FestivalDetail>(`/festivals/${editingId}`);
      setDetail(full);
      setName(full.name || '');
      setStages(
        (full.stages || []).map((s) => ({
          id: s.id || `stage-${Date.now()}`,
          name: s.name || '',
          color: s.color || DEFAULT_STAGE_COLOR,
          latitude: typeof s.latitude === 'number' ? s.latitude : null,
          longitude: typeof s.longitude === 'number' ? s.longitude : null,
        })),
      );
      setMapConfig(full.mapConfig ?? null);
      // Hydrate the site-plan URL + opacity fields from the existing config (the
      // corners stay committed in mapConfig until the admin re-taps them).
      const existingSp = extractSiteplan(full.mapConfig ?? null);
      setSiteplanUrl(existingSp?.imageUrl ?? '');
      setSiteplanOpacity(existingSp?.opacity ?? SITEPLAN_DEFAULT_OPACITY);
    } catch {
      setLoadError(true);
    }
  }, [editingId]);

  useEffect(() => {
    if (!isAdmin || !editingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: nothing to fetch for non-admins / missing id; clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, editingId, load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  }, [router]);

  // Fold the live stages into a Festival-shaped object so OfflineMap can plot the
  // stage + amenity pins as they're authored (live preview). The cast is safe:
  // OfflineMap only reads stages[] + mapConfig off this object.
  // The config the PREVIEW renders: committed config, plus the in-progress zone
  // (once it has ≥3 vertices) appended as a draft so the organizer watches the
  // polygon take shape. The draft is never saved — only committed zones persist.
  const previewConfig = useMemo(() => {
    let cfg = mapConfig;
    if (isDrawingZone && draftVertices.length >= 3) {
      const draft = buildZoneFeature(draftVertices, { color: zoneColor, label: zoneLabel || 'Drawing…' }, 'zone-draft');
      if (draft) cfg = appendZone(cfg, draft);
    }
    // While placing corners, preview the site plan once all 4 are tapped and the
    // URL is a valid https image (the draft is never saved on its own).
    if (isPlacingSiteplan && draftCorners.length === SITEPLAN_CORNER_COUNT && isHttpsUrl(siteplanUrl)) {
      const sp = buildSiteplan(siteplanUrl, draftCorners, siteplanOpacity);
      if (sp) cfg = setSiteplan(cfg, sp);
    }
    return cfg;
  }, [isDrawingZone, draftVertices, zoneColor, zoneLabel, mapConfig, isPlacingSiteplan, draftCorners, siteplanUrl, siteplanOpacity]);

  const mapFestival = useMemo(() => {
    return {
      id: editingId ?? 'draft',
      name,
      mapConfig: previewConfig,
      stages: stages as unknown as Stage[],
    } as Festival & { stages?: Stage[] };
  }, [editingId, name, previewConfig, stages]);

  // The WebView authoring mode follows the armed target ('stage' / 'amenity' /
  // 'off'). Cosmetic on the WebView side; the tap still flows through onMapPress.
  const authoringMode: AuthoringMode = armed?.kind ?? 'off';

  // In-progress zone vertices / site-plan corners → per-tap dots on the map. Below
  // the polygon (3+) / overlay (4 corners) render threshold the preview shows
  // nothing, so these give the admin immediate "your tap landed here" feedback.
  const draftPoints = useMemo(
    () => (isDrawingZone ? draftVertices : isPlacingSiteplan ? draftCorners : []),
    [isDrawingZone, isPlacingSiteplan, draftVertices, draftCorners],
  );

  // ── Placement: a map tap landed ─────────────────────────────────────────────
  const handleMapPress = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      if (!armed) return;
      // Zone drawing: each tap appends a vertex and STAYS armed (multi-tap),
      // unlike the one-shot stage/amenity placement below.
      if (armed.kind === 'zone') {
        setDraftVertices((prev) => [...prev, { latitude: coord.latitude, longitude: coord.longitude }]);
        return;
      }
      // Site-plan: collect up to 4 corners (TL, TR, BR, BL). Stays armed (multi-
      // tap); extra taps beyond 4 are ignored until the admin re-starts.
      if (armed.kind === 'siteplan') {
        setDraftCorners((prev) =>
          prev.length >= SITEPLAN_CORNER_COUNT
            ? prev
            : [...prev, { latitude: coord.latitude, longitude: coord.longitude }],
        );
        return;
      }
      if (armed.kind === 'stage') {
        const next = stageCoordFromTap(coord);
        updateStages((prev) =>
          prev.map((s) => (s.id === armed.stageId ? { ...s, latitude: next.latitude, longitude: next.longitude } : s)),
        );
      } else {
        const feature = buildAmenityFeature(coord, armed.amenityType, amenityLabel);
        if (feature) updateMapConfig((prev) => appendAmenity(prev, feature));
        setAmenityLabel('');
      }
      // One-shot: disarm after a placement (matches the WebView's one-shot tap).
      setArmed(null);
    },
    [armed, amenityLabel, updateStages, updateMapConfig],
  );

  const armStage = (stageId: string) =>
    setArmed((prev) => (prev?.kind === 'stage' && prev.stageId === stageId ? null : { kind: 'stage', stageId }));
  const armAmenity = (amenityType: AmenityType) =>
    setArmed((prev) =>
      prev?.kind === 'amenity' && prev.amenityType === amenityType ? null : { kind: 'amenity', amenityType },
    );

  const clearStagePin = (stageId: string) =>
    updateStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, latitude: null, longitude: null } : s)));
  const removeAmenityById = (amenityId: string) => updateMapConfig((prev) => removeAmenity(prev, amenityId));

  // ── Zone drawing controls ───────────────────────────────────────────────────
  const startZone = () => {
    setDraftVertices([]);
    setArmed({ kind: 'zone' });
  };
  const undoVertex = () => setDraftVertices((prev) => prev.slice(0, -1));
  const cancelZone = () => {
    setDraftVertices([]);
    setArmed(null);
  };
  const finishZone = () => {
    const feature = buildZoneFeature(draftVertices, { color: zoneColor, label: zoneLabel });
    if (feature) updateMapConfig((prev) => appendZone(prev, feature));
    setDraftVertices([]);
    setZoneLabel('');
    setArmed(null);
  };
  const removeZoneById = (zoneId: string) => updateMapConfig((prev) => removeZone(prev, zoneId));

  // ── Site-plan overlay controls (Phase 4B) ──────────────────────────────────
  // The committed site plan (corners + url + opacity), if any. The URL is an
  // admin-provided https link — Festie hosts no arbitrary uploads, so this REUSES
  // the same link-out pattern as crew photo albums (crewPhotoAlbumSchema), which
  // siteplanSchema was explicitly built to mirror. The 4 corners are tapped on
  // the map (same one-shot placement path as stage/amenity/zone authoring).
  const committedSiteplan = useMemo(() => extractSiteplan(mapConfig), [mapConfig]);
  // Convert stored [lng,lat] corners back to {latitude,longitude} for re-commits.
  const cornersToLatLng = (corners: [number, number][]) =>
    corners.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  // Re-commit a site plan through the shared validator; no-op if it doesn't build.
  const recommitSiteplan = (url: string, corners: Vertex[], opacity: number) => {
    const sp = buildSiteplan(url, corners, opacity);
    if (sp) updateMapConfig((prev) => setSiteplan(prev, sp));
    return !!sp;
  };
  const startSiteplanCorners = () => {
    setDraftCorners([]);
    setArmed({ kind: 'siteplan' });
  };
  const undoCorner = () => setDraftCorners((prev) => prev.slice(0, -1));
  const cancelSiteplanCorners = () => {
    setDraftCorners([]);
    setArmed(null);
  };
  const applySiteplanCorners = () => {
    if (recommitSiteplan(siteplanUrl, draftCorners, siteplanOpacity)) {
      setDraftCorners([]);
      setArmed(null);
    }
  };
  const onSiteplanUrlChange = (v: string) => {
    setSiteplanUrl(v);
    // Live-update a committed overlay's image when the URL stays valid.
    if (committedSiteplan && isHttpsUrl(v)) {
      recommitSiteplan(v, cornersToLatLng(committedSiteplan.corners), siteplanOpacity);
    }
  };
  const onSiteplanOpacityChange = (v: number) => {
    const op = clampOpacity(v);
    setSiteplanOpacity(op);
    if (committedSiteplan) recommitSiteplan(committedSiteplan.imageUrl, cornersToLatLng(committedSiteplan.corners), op);
  };
  const removeSiteplanOverlay = () => {
    updateMapConfig((prev) => removeSiteplan(prev));
    setDraftCorners([]);
    setArmed((prev) => (prev?.kind === 'siteplan' ? null : prev));
  };

  const amenityFeatures = mapConfig?.amenities?.features ?? [];
  // Committed zones (the draft preview renders separately via previewConfig).
  const placedZones = useMemo(() => extractZones(mapConfig), [mapConfig]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!editingId || !detail) return;
    setFormError(null);
    // Round-trip the text fields verbatim; only the geo bits changed here.
    const normTime = (v: string | null | undefined) => {
      const x = (v ?? '').trim();
      return x === '' || x.toLowerCase() === 'tba' ? '' : x;
    };
    const payload: Record<string, unknown> = {
      name: detail.name?.trim() || name.trim(),
      location: detail.location?.trim() || '',
      timeZone: detail.timeZone ? detail.timeZone : null,
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        color: s.color,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      days: (detail.days || []).map((d) => ({
        id: d.id,
        label: (d.label || '').trim(),
        date: (d.date || '').trim(),
        sets: (d.sets || []).map((s) => ({
          id: s.id,
          artist: (s.artist || s.artists?.[0]?.name || '').trim(),
          stageId: s.stageId || null,
          startTime: normTime(s.startTime),
          endTime: normTime(s.endTime),
          linkUrl: (s.linkUrl || '').trim() || null,
        })),
      })),
      // object = replace, null = clear (Phase A write path).
      mapConfig: mapConfig,
    };

    setSaving(true);
    try {
      await api.put<void>(`/admin/festivals/${editingId}`, payload);
      goBack();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't save the map. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = 'Edit festival map';

  // Non-admins never reach the editor (AuthGate also blocks the route).
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  if (!editingId) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="map-outline"
          title="No festival selected"
          message="Open a festival in the editor, then choose Edit map."
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <LoadingState label="Loading festival map" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load festival"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: headerTitle, headerShown: true }} />

      {/* The map — half the screen; the toolbar scrolls beneath it. Authoring
          mode follows the armed target; a tap applies to that target. */}
      <View style={styles.mapWrap}>
        <OfflineMap
          meetingPoints={[]}
          festival={mapFestival}
          authoringMode={authoringMode}
          draftPoints={draftPoints}
          onMapPress={handleMapPress}
        />
        {armed ? (
          <View style={styles.armedBanner} pointerEvents="none">
            <Ionicons name="locate-outline" size={14} color={t.colors.text.onAccent} />
            <Text style={styles.armedBannerText} numberOfLines={1}>
              {armed.kind === 'stage'
                ? 'Tap the map to set this stage’s location'
                : armed.kind === 'amenity'
                  ? `Tap the map to drop a ${humanizeAmenityType(armed.amenityType)} marker`
                  : armed.kind === 'siteplan'
                    ? draftCorners.length >= SITEPLAN_CORNER_COUNT
                      ? 'All 4 corners set — apply them below'
                      : `Tap the ${SITEPLAN_CORNER_LABELS[draftCorners.length]} corner (${draftCorners.length}/${SITEPLAN_CORNER_COUNT})`
                    : `Tap the map to add zone points (${draftVertices.length} added — need 3+)`}
            </Text>
          </View>
        ) : null}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[8], insets.bottom + t.spacing[6]) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Stage locations */}
          <SectionLabel>Stage locations</SectionLabel>
          <View style={styles.card}>
            {stages.length === 0 ? (
              <Text style={styles.emptyHint}>This festival has no stages. Add stages in the festival editor first.</Text>
            ) : (
              stages.map((stage) => {
                const pinned = typeof stage.latitude === 'number' && typeof stage.longitude === 'number';
                const isArmed = armed?.kind === 'stage' && armed.stageId === stage.id;
                return (
                  <View key={stage.id} style={styles.stageRow}>
                    <View style={[styles.swatch, { backgroundColor: stage.color }]} />
                    <View style={styles.stageBody}>
                      <Text style={styles.stageName} numberOfLines={1}>
                        {stage.name || 'Untitled stage'}
                      </Text>
                      <Text style={styles.stageCoord} numberOfLines={1}>
                        {pinned ? `${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}` : 'No location'}
                      </Text>
                    </View>
                    {pinned ? (
                      <TouchableOpacity
                        onPress={() => clearStagePin(stage.id)}
                        style={styles.miniBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Clear ${stage.name || 'stage'} location`}
                      >
                        <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => armStage(stage.id)}
                      style={[styles.armBtn, isArmed ? styles.armBtnActive : null]}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isArmed }}
                      accessibilityLabel={
                        isArmed ? 'Cancel placing this stage' : `${pinned ? 'Move' : 'Set'} ${stage.name || 'stage'} location`
                      }
                    >
                      <Text style={[styles.armBtnText, isArmed ? styles.armBtnTextActive : null]}>
                        {isArmed ? 'Cancel' : pinned ? 'Move' : 'Set'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>

          {/* Zones (camping / VIP / no-go / parking) */}
          <SectionLabel>Zones</SectionLabel>
          <View style={styles.card}>
            <Text style={styles.emptyHint}>
              Pick a color, name the area, then tap the map to drop points. Finish with 3 or more.{' '}
              {zoneCount(mapConfig)} drawn.
            </Text>
            <LabeledTextInput
              label="Zone name"
              value={zoneLabel}
              onChangeText={setZoneLabel}
              placeholder="e.g. Camping, VIP, No-go"
              autoCapitalize="sentences"
              hint="Shown as the zone's label tag."
            />
            <View style={styles.palette}>
              {ZONE_PALETTE.map((preset) => {
                const selected = zoneColor === preset.color;
                return (
                  <TouchableOpacity
                    key={preset.color}
                    onPress={() => {
                      setZoneColor(preset.color);
                      if (!zoneLabel.trim()) setZoneLabel(preset.label);
                    }}
                    style={[styles.paletteItem, selected ? { borderColor: preset.color, borderWidth: 2 } : null]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Use ${preset.label} color`}
                  >
                    <View style={[styles.zoneSwatch, { backgroundColor: preset.color }]} />
                    <Text style={styles.paletteLabel} numberOfLines={1}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {isDrawingZone ? (
              <View style={styles.zoneControls}>
                <Text style={styles.zonePointCount}>
                  {draftVertices.length} {draftVertices.length === 1 ? 'point' : 'points'}
                </Text>
                <TouchableOpacity
                  onPress={undoVertex}
                  disabled={draftVertices.length === 0}
                  style={[styles.zoneBtn, draftVertices.length === 0 ? styles.btnDisabled : null]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Undo last zone point"
                >
                  <Text style={styles.zoneBtnText}>Undo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={finishZone}
                  disabled={draftVertices.length < 3}
                  style={[styles.zoneBtnPrimary, draftVertices.length < 3 ? styles.btnDisabled : null]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Finish zone"
                >
                  <Text style={styles.zoneBtnPrimaryText}>Finish</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={cancelZone}
                  style={styles.zoneBtnDanger}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel drawing this zone"
                >
                  <Text style={styles.zoneBtnDangerText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={startZone}
                style={[styles.armBtn, styles.zoneStartBtn]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Draw a zone"
              >
                <Text style={styles.armBtnText}>Draw a zone</Text>
              </TouchableOpacity>
            )}

            {placedZones.length > 0 ? (
              <View style={styles.placedList}>
                {placedZones.map((z) => (
                  <View key={z.id} style={styles.placedRow}>
                    <View style={[styles.zoneSwatch, { backgroundColor: z.color }]} />
                    <Text style={styles.placedLabel} numberOfLines={1}>
                      {z.label || 'Unnamed zone'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => removeZoneById(z.id)}
                      style={styles.miniBtn}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${z.label || 'zone'}`}
                    >
                      <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* Site plan overlay */}
          <SectionLabel>Site plan overlay</SectionLabel>
          <View style={styles.card}>
            <Text style={styles.emptyHint}>
              Underlay the organizer’s map image. Paste an https image link, then tap the four corners
              (top-left, top-right, bottom-right, bottom-left) to georeference it.
            </Text>
            <LabeledTextInput
              label="Site-plan image URL"
              value={siteplanUrl}
              onChangeText={onSiteplanUrlChange}
              placeholder="https://…/site-plan.png"
              keyboardType="url"
              autoCapitalize="none"
              maxLength={2048}
              error={siteplanUrl.trim() !== '' && !isHttpsUrl(siteplanUrl) ? 'Image link must start with https://' : null}
              hint="Link to the organizer's site-plan image (Festie hosts no uploads)."
            />

            {isPlacingSiteplan ? (
              <View style={styles.zoneControls}>
                <Text style={styles.zonePointCount}>
                  {draftCorners.length}/{SITEPLAN_CORNER_COUNT} corners
                </Text>
                <TouchableOpacity
                  onPress={undoCorner}
                  disabled={draftCorners.length === 0}
                  style={[styles.zoneBtn, draftCorners.length === 0 ? styles.btnDisabled : null]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Undo last corner"
                >
                  <Text style={styles.zoneBtnText}>Undo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={applySiteplanCorners}
                  disabled={draftCorners.length !== SITEPLAN_CORNER_COUNT || !isHttpsUrl(siteplanUrl)}
                  style={[
                    styles.zoneBtnPrimary,
                    draftCorners.length !== SITEPLAN_CORNER_COUNT || !isHttpsUrl(siteplanUrl) ? styles.btnDisabled : null,
                  ]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Apply the four corners"
                >
                  <Text style={styles.zoneBtnPrimaryText}>Apply</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={cancelSiteplanCorners}
                  style={styles.zoneBtnDanger}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel placing corners"
                >
                  <Text style={styles.zoneBtnDangerText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={startSiteplanCorners}
                disabled={!isHttpsUrl(siteplanUrl)}
                style={[styles.armBtn, styles.zoneStartBtn, !isHttpsUrl(siteplanUrl) ? styles.btnDisabled : null]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={committedSiteplan ? 'Re-place site-plan corners' : 'Set site-plan corners'}
              >
                <Text style={styles.armBtnText}>{committedSiteplan ? 'Re-place corners' : 'Set corners'}</Text>
              </TouchableOpacity>
            )}

            {/* Opacity presets — only meaningful once an overlay is committed. */}
            {committedSiteplan ? (
              <View style={styles.opacityBlock}>
                <Text style={styles.zonePointCount}>Opacity: {Math.round(siteplanOpacity * 100)}%</Text>
                <View style={styles.palette}>
                  {SITEPLAN_OPACITY_PRESETS.map((op) => {
                    const selected = Math.round(siteplanOpacity * 100) === Math.round(op * 100);
                    return (
                      <TouchableOpacity
                        key={op}
                        onPress={() => onSiteplanOpacityChange(op)}
                        style={[styles.opacityChip, selected ? styles.opacityChipOn : null]}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Set overlay opacity to ${Math.round(op * 100)} percent`}
                      >
                        <Text style={[styles.opacityChipText, selected ? styles.opacityChipTextOn : null]}>
                          {Math.round(op * 100)}%
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {committedSiteplan ? (
              <View style={styles.placedList}>
                <View style={styles.placedRow}>
                  <Text style={styles.placedLabel} numberOfLines={1}>
                    Overlay set ({SITEPLAN_CORNER_COUNT} corners)
                  </Text>
                  <TouchableOpacity
                    onPress={removeSiteplanOverlay}
                    style={styles.miniBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Remove site-plan overlay"
                  >
                    <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>

          {/* Amenities */}
          <SectionLabel>Amenities</SectionLabel>
          <View style={styles.card}>
            <Text style={styles.emptyHint}>
              Pick a type, optionally name it, then tap the map to drop it. {amenityCount(mapConfig)} placed.
            </Text>
            <LabeledTextInput
              label="Label (optional)"
              value={amenityLabel}
              onChangeText={setAmenityLabel}
              placeholder="e.g. North water station"
              autoCapitalize="sentences"
              hint="Used for the marker's popup. Blank uses the type name."
            />
            <View style={styles.palette}>
              {AMENITY_PALETTE.map((type) => {
                const { glyph, color } = amenityGlyph(type);
                const isArmed = armed?.kind === 'amenity' && armed.amenityType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => armAmenity(type)}
                    style={[styles.paletteItem, isArmed ? { borderColor: color, borderWidth: 2 } : null]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isArmed }}
                    accessibilityLabel={`${isArmed ? 'Cancel placing' : 'Place'} ${humanizeAmenityType(type)}`}
                  >
                    <View style={[styles.paletteGlyph, { backgroundColor: color }]}>
                      <Text style={styles.paletteGlyphText}>{glyph}</Text>
                    </View>
                    <Text style={styles.paletteLabel} numberOfLines={1}>
                      {humanizeAmenityType(type)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Placed amenities list (remove individual markers). */}
            {amenityFeatures.length > 0 ? (
              <View style={styles.placedList}>
                {amenityFeatures.map((f) => {
                  const { glyph, color } = amenityGlyph(f.properties.amenityType);
                  return (
                    <View key={f.properties.id} style={styles.placedRow}>
                      <View style={[styles.placedGlyph, { backgroundColor: color }]}>
                        <Text style={styles.paletteGlyphText}>{glyph}</Text>
                      </View>
                      <Text style={styles.placedLabel} numberOfLines={1}>
                        {f.properties.label}
                      </Text>
                      <TouchableOpacity
                        onPress={() => removeAmenityById(f.properties.id)}
                        style={styles.miniBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${f.properties.label}`}
                      >
                        <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>

          {formError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => (touched ? setShowCancelConfirm(true) : goBack())}
              style={[styles.actionBtn, styles.cancelBtn]}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleSave()}
              style={[styles.actionBtn, styles.saveBtn, saving && styles.btnDisabled]}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save map"
            >
              <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.4}>
                {saving ? 'Saving…' : 'Save map'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={showCancelConfirm}
        title="Discard changes?"
        message="You have unsaved map edits. Leaving now discards them."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setShowCancelConfirm(false);
          goBack();
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  flex: {
    flex: 1,
  },
  mapWrap: {
    height: 300,
    width: '100%',
  },
  armedBanner: {
    position: 'absolute',
    top: t.spacing[3],
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    maxWidth: '90%',
  },
  armedBannerText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  emptyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Stage rows -----------------------------------------------------------------
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  stageBody: {
    flex: 1,
    gap: 2,
  },
  stageName: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  stageCoord: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  armBtn: {
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  armBtnActive: {
    backgroundColor: t.colors.accent.aqua,
  },
  armBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  armBtnTextActive: {
    color: t.colors.text.onAccent,
  },
  miniBtn: {
    minHeight: 40,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Amenity palette ------------------------------------------------------------
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  paletteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
    minHeight: 40,
  },
  paletteGlyph: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  paletteGlyphText: {
    fontSize: 13,
    lineHeight: 16,
  },
  paletteLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  // Zone drawing ---------------------------------------------------------------
  zoneSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  zoneStartBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[4],
  },
  zoneControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  zonePointCount: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  zoneBtn: {
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  zoneBtnPrimary: {
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBtnPrimaryText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.onLightAccent,
  },
  zoneBtnDanger: {
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBtnDangerText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.coral,
  },
  // Site-plan opacity presets --------------------------------------------------
  opacityBlock: {
    gap: t.spacing[2],
  },
  opacityChip: {
    minHeight: 40,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opacityChipOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.accent.aqua,
  },
  opacityChipText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  opacityChipTextOn: {
    color: t.colors.text.onLightAccent,
  },
  // Placed amenities -----------------------------------------------------------
  placedList: {
    gap: t.spacing[2],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  placedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  placedGlyph: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  placedLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
  },
  // Actions --------------------------------------------------------------------
  formError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[1],
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
  },
  cancelBtn: {
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  cancelBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  saveBtn: {
    backgroundColor: t.colors.accent.aqua,
  },
  saveBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
  btnDisabled: {
    opacity: 0.6,
  },
}));
