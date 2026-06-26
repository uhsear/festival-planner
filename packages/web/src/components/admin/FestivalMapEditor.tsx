import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@festie/shared/services/api';
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
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';

// CrewMap is heavy (MapLibre); lazy-load it exactly like the crew surface does so
// it never lands in the admin bundle until the map editor opens.
const CrewMap = lazy(() => import('../crew/CrewMap'));

/**
 * Admin — web festival MAP editor (Phase D parity with the mobile
 * app/admin/festival-map.tsx screen).
 *
 * Places/moves stage pins and drops amenity markers on the real web CrewMap
 * (MapLibre directly — no WebView bridge, that's mobile-only), then persists via
 * the SAME PUT /admin/festivals/:id write path: per-stage latitude/longitude on
 * the stage rows + festival.mapConfig. All authoring math is the shared pure
 * `@festie/shared` mapAuthoring helpers, so web + mobile stay in parity.
 *
 * Loads the FULL festival (stages/days/timeZone) and round-trips the non-geo
 * fields on save so editing the map never drops lineup data.
 */

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

interface StageEdit {
  id: string;
  name: string;
  color: string;
  latitude: number | null;
  longitude: number | null;
}

const DEFAULT_STAGE_COLOR = '#6a6a88';

type ArmedTarget =
  | { kind: 'stage'; stageId: string }
  | { kind: 'amenity'; amenityType: AmenityType }
  | { kind: 'zone' }
  | { kind: 'siteplan' }
  | null;

/** A single tapped vertex while drawing a zone (geo.ts {latitude, longitude}). */
type Vertex = { latitude: number; longitude: number };

export interface FestivalMapEditorProps {
  festivalId: string;
  /** Back to the festival list/edit view. */
  onClose: () => void;
}

export default function FestivalMapEditor({ festivalId, onClose }: FestivalMapEditorProps) {
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [stages, setStages] = useState<StageEdit[]>([]);
  const [mapConfig, setMapConfig] = useState<FestivalMapConfig | null>(null);
  const [detail, setDetail] = useState<FestivalDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState<ArmedTarget>(null);
  const [amenityLabel, setAmenityLabel] = useState('');
  // Zone drawing (Phase 4A): the in-progress polygon vertices + the chosen
  // color/label. Committed on "Finish"; the preview shows the draft live.
  const [draftVertices, setDraftVertices] = useState<Vertex[]>([]);
  const [zoneColor, setZoneColor] = useState<string>(ZONE_PALETTE[0].color);
  const [zoneLabel, setZoneLabel] = useState('');
  const isDrawingZone = armed?.kind === 'zone';
  // Site-plan overlay (Phase 4B): the https image URL + opacity are edited fields;
  // the 4 corners are tapped on the map (TL, TR, BR, BL) while armed. The
  // committed corners live in mapConfig.siteplan.
  const [siteplanUrl, setSiteplanUrl] = useState('');
  const [siteplanOpacity, setSiteplanOpacity] = useState<number>(SITEPLAN_DEFAULT_OPACITY);
  const [draftCorners, setDraftCorners] = useState<Vertex[]>([]);
  const isPlacingSiteplan = armed?.kind === 'siteplan';

  const load = useCallback(async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const full = await api.get<FestivalDetail>(`/festivals/${festivalId}`);
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
    } finally {
      setLoading(false);
    }
  }, [festivalId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The config the PREVIEW renders: the committed config, plus the in-progress
  // zone (once it has ≥3 vertices) appended as a draft so the organizer sees the
  // polygon take shape as they tap. The draft is never saved — only committed
  // zones live in `mapConfig`.
  const previewConfig = useMemo(() => {
    let cfg = mapConfig;
    if (isDrawingZone && draftVertices.length >= 3) {
      const draft = buildZoneFeature(draftVertices, { color: zoneColor, label: zoneLabel || 'Drawing…' }, 'zone-draft');
      if (draft) cfg = appendZone(cfg, draft);
    }
    // While placing corners, preview the site plan as soon as all 4 are tapped and
    // the URL is a valid https image (the draft is never saved on its own).
    if (isPlacingSiteplan && draftCorners.length === SITEPLAN_CORNER_COUNT && isHttpsUrl(siteplanUrl)) {
      const sp = buildSiteplan(siteplanUrl, draftCorners, siteplanOpacity);
      if (sp) cfg = setSiteplan(cfg, sp);
    }
    return cfg;
  }, [isDrawingZone, draftVertices, zoneColor, zoneLabel, mapConfig, isPlacingSiteplan, draftCorners, siteplanUrl, siteplanOpacity]);

  // Fold stages into a Festival-shaped object for the live CrewMap preview. The
  // cast is safe: CrewMap reads only stages[] + mapConfig off this object.
  const mapFestival = useMemo(
    () =>
      ({
        id: festivalId,
        name,
        mapConfig: previewConfig,
        stages: stages as unknown as Stage[],
      }) as Festival & { stages?: Stage[] },
    [festivalId, name, previewConfig, stages],
  );

  // A click on the map applies to the armed target (one-shot: disarms after).
  const handleMapClick = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      if (!armed) return;
      // Zone drawing: each click appends a vertex and STAYS armed (multi-tap),
      // unlike the one-shot stage/amenity placement below.
      if (armed.kind === 'zone') {
        setDraftVertices((prev) => [...prev, { latitude: coord.latitude, longitude: coord.longitude }]);
        return;
      }
      // Site-plan: collect up to 4 corners (TL, TR, BR, BL). Stays armed (multi-
      // tap); extra taps beyond 4 are ignored until the admin re-starts.
      if (armed.kind === 'siteplan') {
        setDraftCorners((prev) =>
          prev.length >= SITEPLAN_CORNER_COUNT ? prev : [...prev, { latitude: coord.latitude, longitude: coord.longitude }],
        );
        return;
      }
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
    if (feature) setMapConfig((prev) => appendZone(prev, feature));
    setDraftVertices([]);
    setZoneLabel('');
    setArmed(null);
  };
  const removeZoneById = (zoneId: string) => setMapConfig((prev) => removeZone(prev, zoneId));

  // ── Site-plan overlay controls (Phase 4B) ──────────────────────────────────
  // The committed site plan (corners + url + opacity), if any.
  const committedSiteplan = useMemo(() => extractSiteplan(mapConfig), [mapConfig]);
  // Convert stored [lng,lat] corners back to {latitude,longitude} for re-commits.
  const cornersToLatLng = (corners: [number, number][]) =>
    corners.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  // Re-commit a site plan through the shared validator; no-op if it doesn't build.
  const recommitSiteplan = (url: string, corners: Vertex[], opacity: number) => {
    const sp = buildSiteplan(url, corners, opacity);
    if (sp) setMapConfig((prev) => setSiteplan(prev, sp));
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
    setMapConfig((prev) => removeSiteplan(prev));
    setDraftCorners([]);
    setArmed((prev) => (prev?.kind === 'siteplan' ? null : prev));
  };

  const amenityFeatures = mapConfig?.amenities?.features ?? [];
  // Committed zones (the draft preview is rendered separately via previewConfig).
  const placedZones = useMemo(() => extractZones(mapConfig), [mapConfig]);

  const handleSave = async () => {
    if (!detail) return;
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
      mapConfig,
    };

    setSaving(true);
    try {
      await api.put<void>(`/admin/festivals/${festivalId}`, payload);
      toast('Festival map saved', 'success');
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't save the map. Try again.", 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading festival map…</div>;
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-text-secondary">Couldn’t load this festival.</p>
        <button
          onClick={() => void load()}
          className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="type-label text-text-primary">Festival map — {name || 'Untitled'}</h2>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md bg-bg-primary border border-glass-border text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          Back
        </button>
      </div>

      {/* Live map preview. Clicking the map applies to the armed target. */}
      <div className="relative">
        <Suspense fallback={<div className="h-72 flex-center text-text-muted">Loading map…</div>}>
          <CrewMap meetingPoints={[]} festival={mapFestival} onMapClick={armed ? handleMapClick : undefined} />
        </Suspense>
        {armed && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-[1] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-aqua text-bg-primary text-xs font-medium shadow-lg pointer-events-none"
            role="status"
          >
            {armed.kind === 'stage'
              ? 'Click the map to set this stage’s location'
              : armed.kind === 'amenity'
                ? `Click the map to drop a ${humanizeAmenityType(armed.amenityType)} marker`
                : armed.kind === 'siteplan'
                  ? draftCorners.length >= SITEPLAN_CORNER_COUNT
                    ? 'All 4 corners set — apply them below'
                    : `Click the ${SITEPLAN_CORNER_LABELS[draftCorners.length]} corner (${draftCorners.length}/${SITEPLAN_CORNER_COUNT})`
                  : `Click the map to add zone points (${draftVertices.length} added — need 3+)`}
          </div>
        )}
      </div>

      {/* Stage locations */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
        <h3 className="type-label text-text-primary mb-3">Stage locations</h3>
        {stages.length === 0 ? (
          <p className="text-sm text-text-muted">
            This festival has no stages. Add stages in the festival editor first.
          </p>
        ) : (
          <div className="space-y-2">
            {stages.map((stage) => {
              const pinned = typeof stage.latitude === 'number' && typeof stage.longitude === 'number';
              const isArmed = armed?.kind === 'stage' && armed.stageId === stage.id;
              return (
                <div key={stage.id} className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-full border border-glass-border shrink-0"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{stage.name || 'Untitled stage'}</p>
                    <p className="text-xs text-text-muted truncate">
                      {pinned
                        ? `${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}`
                        : 'No location pinned'}
                    </p>
                  </div>
                  {pinned && (
                    <button
                      onClick={() => clearStagePin(stage.id)}
                      className="px-2 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                      aria-label={`Clear ${stage.name || 'stage'} location`}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => armStage(stage.id)}
                    aria-pressed={isArmed}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      isArmed
                        ? 'bg-accent-aqua text-bg-primary border-accent-aqua'
                        : 'bg-accent-aqua/20 text-accent-aqua border-transparent hover:bg-accent-aqua/30',
                    )}
                  >
                    {isArmed ? 'Cancel' : pinned ? 'Move' : 'Set location'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Zones (camping / VIP / no-go / parking) */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
        <h3 className="type-label text-text-primary">Zones</h3>
        <p className="text-xs text-text-muted">
          Pick a color, name the area, then click the map to drop points. Finish with 3 or more.{' '}
          {zoneCount(mapConfig)} drawn.
        </p>

        {/* Color presets + label input */}
        <input
          type="text"
          aria-label="Zone label"
          placeholder="Zone name — e.g. Camping, VIP, No-go"
          value={zoneLabel}
          onChange={(e) => setZoneLabel(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <div className="flex flex-wrap gap-2">
          {ZONE_PALETTE.map((preset) => {
            const selected = zoneColor === preset.color;
            return (
              <button
                key={preset.color}
                type="button"
                onClick={() => {
                  setZoneColor(preset.color);
                  if (!zoneLabel.trim()) setZoneLabel(preset.label);
                }}
                aria-pressed={selected}
                aria-label={`Use ${preset.label} color`}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-full border bg-bg-primary text-sm transition-colors',
                  selected ? 'border-2' : 'border-glass-border hover:border-accent-aqua',
                )}
                style={selected ? { borderColor: preset.color } : undefined}
              >
                <span
                  className="w-5 h-5 rounded-full border border-white"
                  style={{ backgroundColor: preset.color }}
                  aria-hidden="true"
                />
                <span className="text-text-primary">{preset.label}</span>
              </button>
            );
          })}
        </div>

        {/* Draw controls */}
        {isDrawingZone ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-secondary">
              {draftVertices.length} {draftVertices.length === 1 ? 'point' : 'points'}
            </span>
            <button
              type="button"
              onClick={undoVertex}
              disabled={draftVertices.length === 0}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-glass-border text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              Undo point
            </button>
            <button
              type="button"
              onClick={finishZone}
              disabled={draftVertices.length < 3}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-aqua text-bg-primary disabled:opacity-50"
            >
              Finish zone
            </button>
            <button
              type="button"
              onClick={cancelZone}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startZone}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-aqua/20 text-accent-aqua border border-transparent hover:bg-accent-aqua/30"
          >
            Draw a zone
          </button>
        )}

        {/* Placed zones list */}
        {placedZones.length > 0 && (
          <div className="space-y-2 border-t border-glass-border pt-3">
            {placedZones.map((z) => (
              <div key={z.id} className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full border border-white shrink-0"
                  style={{ backgroundColor: z.color }}
                  aria-hidden="true"
                />
                <span className="text-sm text-text-primary flex-1 truncate">{z.label || 'Unnamed zone'}</span>
                <button
                  onClick={() => removeZoneById(z.id)}
                  className="px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                  aria-label={`Remove ${z.label || 'zone'}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Site plan overlay */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
        <h3 className="type-label text-text-primary">Site plan overlay</h3>
        <p className="text-xs text-text-muted">
          Underlay the organizer’s map image. Paste an https image link, then click the four corners
          (top-left, top-right, bottom-right, bottom-left) to georeference it.
        </p>
        <input
          type="url"
          inputMode="url"
          aria-label="Site-plan image URL"
          placeholder="https://…/site-plan.png"
          value={siteplanUrl}
          onChange={(e) => onSiteplanUrlChange(e.target.value)}
          maxLength={2048}
          className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        {siteplanUrl.trim() !== '' && !isHttpsUrl(siteplanUrl) && (
          <p className="text-xs text-[var(--color-text-danger)]">Image link must start with https://</p>
        )}

        {/* Corner placement */}
        {isPlacingSiteplan ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-secondary">
              {draftCorners.length}/{SITEPLAN_CORNER_COUNT} corners
            </span>
            <button
              type="button"
              onClick={undoCorner}
              disabled={draftCorners.length === 0}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-glass-border text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              Undo corner
            </button>
            <button
              type="button"
              onClick={applySiteplanCorners}
              disabled={draftCorners.length !== SITEPLAN_CORNER_COUNT || !isHttpsUrl(siteplanUrl)}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-aqua text-bg-primary disabled:opacity-50"
            >
              Apply corners
            </button>
            <button
              type="button"
              onClick={cancelSiteplanCorners}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startSiteplanCorners}
            disabled={!isHttpsUrl(siteplanUrl)}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-aqua/20 text-accent-aqua border border-transparent hover:bg-accent-aqua/30 disabled:opacity-50"
          >
            {committedSiteplan ? 'Re-place corners' : 'Set corners'}
          </button>
        )}

        {/* Opacity slider — only meaningful once an overlay is committed. */}
        {committedSiteplan && (
          <div className="space-y-1">
            <label htmlFor="siteplan-opacity" className="text-xs text-text-secondary">
              Opacity: {Math.round(siteplanOpacity * 100)}%
            </label>
            <input
              id="siteplan-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={siteplanOpacity}
              onChange={(e) => onSiteplanOpacityChange(parseFloat(e.target.value))}
              className="w-full accent-accent-aqua"
            />
          </div>
        )}

        {committedSiteplan && (
          <div className="flex items-center gap-2 border-t border-glass-border pt-3">
            <span className="text-sm text-text-primary flex-1 truncate">Overlay set ({SITEPLAN_CORNER_COUNT} corners)</span>
            <button
              onClick={removeSiteplanOverlay}
              className="px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
              aria-label="Remove site-plan overlay"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Amenities */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
        <h3 className="type-label text-text-primary">Amenities</h3>
        <p className="text-xs text-text-muted">
          Pick a type, optionally name it, then click the map to drop it. {amenityCount(mapConfig)} placed.
        </p>
        <input
          type="text"
          aria-label="Amenity label (optional)"
          placeholder="Label (optional) — e.g. North water station"
          value={amenityLabel}
          onChange={(e) => setAmenityLabel(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <div className="flex flex-wrap gap-2">
          {AMENITY_PALETTE.map((type) => {
            const { glyph, color } = amenityGlyph(type);
            const isArmed = armed?.kind === 'amenity' && armed.amenityType === type;
            return (
              <button
                key={type}
                onClick={() => armAmenity(type)}
                aria-pressed={isArmed}
                aria-label={`${isArmed ? 'Cancel placing' : 'Place'} ${humanizeAmenityType(type)}`}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-full border bg-bg-primary text-sm transition-colors',
                  isArmed ? 'border-2' : 'border-glass-border hover:border-accent-aqua',
                )}
                style={isArmed ? { borderColor: color } : undefined}
              >
                <span
                  className="w-6 h-6 rounded-full flex-center text-[13px] leading-none border border-white"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                >
                  {glyph}
                </span>
                <span className="text-text-primary">{humanizeAmenityType(type)}</span>
              </button>
            );
          })}
        </div>

        {amenityFeatures.length > 0 && (
          <div className="space-y-2 border-t border-glass-border pt-3">
            {amenityFeatures.map((f) => {
              const { glyph, color } = amenityGlyph(f.properties.amenityType);
              return (
                <div key={f.properties.id} className="flex items-center gap-2">
                  <span
                    className="w-6 h-6 rounded-full flex-center text-[13px] leading-none border border-white shrink-0"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  >
                    {glyph}
                  </span>
                  <span className="text-sm text-text-primary flex-1 truncate">{f.properties.label}</span>
                  <button
                    onClick={() => removeAmenityById(f.properties.id)}
                    className="px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                    aria-label={`Remove ${f.properties.label}`}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save map'}
        </button>
      </div>
    </div>
  );
}
