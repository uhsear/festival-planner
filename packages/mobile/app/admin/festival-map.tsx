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
} from '@festie/shared/utils';
import type { AmenityType, Festival, FestivalMapConfig, Stage } from '@festie/shared/types';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';
import { LabeledTextInput } from '../../components/admin';
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

// What the next placement tap will do. null = idle (no target armed).
type ArmedTarget = { kind: 'stage'; stageId: string } | { kind: 'amenity'; amenityType: AmenityType } | null;

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
  const [armed, setArmed] = useState<ArmedTarget>(null);
  // New-amenity label buffer (used when an amenity target is armed).
  const [amenityLabel, setAmenityLabel] = useState('');

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
  const mapFestival = useMemo(() => {
    return {
      id: editingId ?? 'draft',
      name,
      mapConfig,
      stages: stages as unknown as Stage[],
    } as Festival & { stages?: Stage[] };
  }, [editingId, name, mapConfig, stages]);

  // The WebView authoring mode follows the armed target ('stage' / 'amenity' /
  // 'off'). Cosmetic on the WebView side; the tap still flows through onMapPress.
  const authoringMode: AuthoringMode = armed?.kind ?? 'off';

  // ── Placement: a map tap landed ─────────────────────────────────────────────
  const handleMapPress = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      if (!armed) return;
      if (armed.kind === 'stage') {
        const next = stageCoordFromTap(coord);
        setStages((prev) =>
          prev.map((s) => (s.id === armed.stageId ? { ...s, latitude: next.latitude, longitude: next.longitude } : s)),
        );
      } else {
        const feature = buildAmenityFeature(coord, armed.amenityType, amenityLabel);
        if (feature) setMapConfig((prev) => appendAmenity(prev, feature));
        setAmenityLabel('');
      }
      // One-shot: disarm after a placement (matches the WebView's one-shot tap).
      setArmed(null);
    },
    [armed, amenityLabel],
  );

  const armStage = (stageId: string) =>
    setArmed((prev) => (prev?.kind === 'stage' && prev.stageId === stageId ? null : { kind: 'stage', stageId }));
  const armAmenity = (amenityType: AmenityType) =>
    setArmed((prev) =>
      prev?.kind === 'amenity' && prev.amenityType === amenityType ? null : { kind: 'amenity', amenityType },
    );

  const clearStagePin = (stageId: string) =>
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, latitude: null, longitude: null } : s)));
  const removeAmenityById = (amenityId: string) => setMapConfig((prev) => removeAmenity(prev, amenityId));

  const amenityFeatures = mapConfig?.amenities?.features ?? [];

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
          onMapPress={handleMapPress}
        />
        {armed ? (
          <View style={styles.armedBanner} pointerEvents="none">
            <Ionicons name="locate-outline" size={14} color={t.colors.text.onAccent} />
            <Text style={styles.armedBannerText} numberOfLines={1}>
              {armed.kind === 'stage'
                ? 'Tap the map to set this stage’s location'
                : `Tap the map to drop a ${humanizeAmenityType(armed.amenityType)} marker`}
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
              onPress={goBack}
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
