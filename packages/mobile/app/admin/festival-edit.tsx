import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';
import {
  ConfirmDialog,
  LabeledTextInput,
  ModalSelect,
  HexColorField,
  DateField,
  TimeField,
  isValidDate,
  isValidTime,
  type SelectOption,
} from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';
import {
  addStage as addStageReducer,
  removeStage as removeStageReducer,
  setStageField as setStageFieldReducer,
  addDay as addDayReducer,
  removeDay as removeDayReducer,
  setDayField as setDayFieldReducer,
  toggleDay as toggleDayReducer,
  addSet as addSetReducer,
  removeSet as removeSetReducer,
  setSetField as setSetFieldReducer,
  type StageRow,
  type SetRow,
  type DayRow,
  type FormState,
} from './festivalEditState';
import { amenityCount } from '@festie/shared/utils';
import type { FestivalMapConfig } from '@festie/shared/types';

/**
 * Admin — Festival editor (native UI parity for the web FestivalEditForm →
 * DayEditor → SetEditor chain, packages/web/src/components/admin). Lives under
 * app/admin/ so AuthGate (seg[0]==='admin') guards it; non-admins bounce to an
 * "Admins only" empty state.
 *
 * Pure native UI over the SAME shared api.* calls and the SAME payload shape the
 * web form posts — NO native modules, NO new backend logic. Every form control
 * is a token-styled primitive from components/admin (ModalSelect / DateField /
 * TimeField / HexColorField), so the whole surface stays OTA-able.
 *
 *   ?id=<festivalId> → edit (loads via GET /festivals/:id)
 *   no id            → create
 *
 * Save: POST /admin/festivals (create) or PUT /admin/festivals/:id (edit) with
 *       { name, location, timeZone, stages[], days[].sets[] }. The festival's
 *       date range is NOT a top-level field — the server derives start/end from
 *       the day dates (days[].date), matching festivalCreateSchema/festivalUpdateSchema.
 * Delete: DELETE /admin/festivals/:id — gated behind ConfirmDialog.
 * Backfill: POST /admin/festivals/:id/backfill-spotify — gated behind ConfirmDialog.
 *
 * Back-navigates to '/admin' on save / cancel / delete.
 */

// Common IANA zones offered in the editor — mirrors the web form's
// COMMON_TIME_ZONES. The festival's current value is merged in at render time so
// an existing custom zone is never dropped.
const COMMON_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
] as const;

const DEFAULT_STAGE_COLOR = '#6a6a88';

// Local editable shapes (StageRow / SetRow / DayRow / FormState) live in
// ./festivalEditState alongside the pure tree reducers they operate on.

// Detail response from GET /festivals/:id (depth=2). Loosely typed — we only
// read the fields the editor hydrates.
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

type DetailSet = NonNullable<NonNullable<FestivalDetail['days']>[number]['sets']>[number];

const EMPTY_FORM: FormState = {
  name: '',
  location: '',
  timeZone: '',
  stages: [],
  days: [],
  mapConfig: null,
};

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** True when a stage row carries a finite lat/lng pin. */
function stageIsPinned(s: StageRow): boolean {
  return typeof s.latitude === 'number' && typeof s.longitude === 'number';
}

/** First spotify/soundcloud link found on a set, for hydrating the link field. */
function setLink(s: DetailSet): string {
  const links = s.artists?.[0]?.links;
  return links?.spotify || links?.soundcloud || s.linkUrl || '';
}

export default function FestivalEditScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof id === 'string' && id.length > 0 ? id : null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(!!editingId);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'delete' | 'backfill' | null>(null);
  const [busy, setBusy] = useState(false);
  // Dirty flag: flipped by user edit handlers only (never by the initial load
  // hydration below), so Cancel can tell an untouched form from one with
  // unsaved edits. Simplest honest signal — no deep compare.
  const [touched, setTouched] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const updateForm = useCallback((updater: (f: FormState) => FormState) => {
    setTouched(true);
    setForm(updater);
  }, []);

  // ── Load (edit only) ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!editingId) return;
    setLoadError(false);
    try {
      const full = await api.get<FestivalDetail>(`/festivals/${editingId}`);
      const stages: StageRow[] = (full.stages || []).map((s) => ({
        id: s.id || uid('stage'),
        name: s.name || '',
        color: s.color || DEFAULT_STAGE_COLOR,
        latitude: typeof s.latitude === 'number' ? s.latitude : null,
        longitude: typeof s.longitude === 'number' ? s.longitude : null,
      }));
      const days: DayRow[] = (full.days || []).map((d) => ({
        id: d.id || uid('day'),
        label: d.label || '',
        date: d.date || '',
        sets: (d.sets || []).map((s) => ({
          id: s.id || uid('set'),
          artist: s.artist || s.artists?.[0]?.name || '',
          stageId: s.stageId || '',
          startTime: s.startTime || '',
          endTime: s.endTime || '',
          linkUrl: setLink(s),
        })),
      }));
      setForm({
        name: full.name || '',
        location: full.location || '',
        timeZone: full.timeZone || '',
        stages,
        days,
        mapConfig: full.mapConfig ?? null,
      });
      // Auto-expand all days so artists are visible immediately (web parity).
      setExpandedDays(new Set(days.map((d) => d.id)));
    } catch {
      setLoadError(true);
    }
  }, [editingId]);

  useEffect(() => {
    if (!isAdmin || !editingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins and the create path have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
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

  // ── Navigation ────────────────────────────────────────────────────────────
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  }, [router]);

  // Open the dedicated map editor for this festival. The map screen loads the
  // festival by id and persists stage pins + amenities itself, so geo authoring
  // is fully owned there (this text-form screen never needs the map). Edit-only.
  const goToMapEditor = useCallback(() => {
    if (!editingId) return;
    router.push({ pathname: '/admin/festival-map', params: { id: editingId } });
  }, [router, editingId]);

  // ── Stage editing ─────────────────────────────────────────────────────────
  const addStage = () =>
    updateForm((f) =>
      addStageReducer(f, { id: uid('stage'), name: '', color: DEFAULT_STAGE_COLOR, latitude: null, longitude: null }),
    );
  const removeStage = (stageId: string) => updateForm((f) => removeStageReducer(f, stageId));
  const setStageField = (stageId: string, field: 'name' | 'color', value: string) =>
    updateForm((f) => setStageFieldReducer(f, stageId, field, value));

  // ── Day editing ───────────────────────────────────────────────────────────
  const addDay = () => {
    const day: DayRow = { id: uid('day'), label: '', date: '', sets: [] };
    updateForm((f) => addDayReducer(f, day));
    setExpandedDays((prev) => new Set(prev).add(day.id));
  };
  const removeDay = (dayId: string) => updateForm((f) => removeDayReducer(f, dayId));
  const setDayField = (dayId: string, field: 'label' | 'date', value: string) =>
    updateForm((f) => setDayFieldReducer(f, dayId, field, value));
  const toggleDay = (dayId: string) => setExpandedDays((prev) => toggleDayReducer(prev, dayId));

  // ── Set editing (nested under each day) ───────────────────────────────────
  const addSet = (dayId: string) =>
    updateForm((f) =>
      addSetReducer(f, dayId, {
        id: uid('set'),
        artist: '',
        stageId: f.stages[0]?.id || '',
        startTime: '',
        endTime: '',
        linkUrl: '',
      }),
    );
  const removeSet = (dayId: string, setId: string) => updateForm((f) => removeSetReducer(f, dayId, setId));
  const setSetField = (dayId: string, setId: string, field: keyof SetRow, value: string) =>
    updateForm((f) => setSetFieldReducer(f, dayId, setId, field, value));

  // Stage options for the per-set ModalSelect.
  const stageOptions: SelectOption[] = form.stages.map((s) => ({
    label: s.name || 'Untitled stage',
    value: s.id,
  }));

  // Timezone options — merge the festival's current custom zone in if off-list.
  const timeZoneOptions: SelectOption[] = [
    { label: 'Device-local (no festival zone)', value: '' },
    ...Array.from(new Set([...COMMON_TIME_ZONES, ...(form.timeZone ? [form.timeZone] : [])])).map((tz) => ({
      label: tz,
      value: tz,
    })),
  ];

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Festival name is required.');
      return;
    }
    if (!form.location.trim()) {
      setFormError('Location is required.');
      return;
    }
    // Block obviously-malformed dates/times before hitting the server (the
    // fields show inline errors too; this is the gate before the write fires).
    const badDate = form.days.map((d) => d.date).some((d) => d.trim() !== '' && !isValidDate(d));
    if (badDate) {
      setFormError('One or more dates are invalid. Use YYYY-MM-DD.');
      return;
    }
    const badTime = form.days
      .flatMap((d) => d.sets)
      .flatMap((s) => [s.startTime, s.endTime])
      .some((tm) => tm.trim() !== '' && tm.trim().toLowerCase() !== 'tba' && !isValidTime(tm));
    if (badTime) {
      setFormError('One or more set times are invalid. Use HH:MM (24h) or leave blank.');
      return;
    }

    // Build the SAME payload shape the web form posts: stages[] + days[].sets[].
    // Empty/"TBA" times normalize to '' (the schema accepts an empty literal).
    const normTime = (v: string) => {
      const x = v.trim();
      return x === '' || x.toLowerCase() === 'tba' ? '' : x;
    };
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      location: form.location.trim(),
      timeZone: form.timeZone ? form.timeZone : null,
      // Preserve stage pin coords (authored in the map editor) so saving the
      // text fields here never silently drops a stage's location. null when
      // unpinned (Phase A contract: per-stage latitude/longitude).
      stages: form.stages.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        color: s.color,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      // Round-trip the festival map-config (amenities/center/etc, authored in the
      // map editor). Sending the loaded value back keeps it on save; explicit
      // null clears it (Phase A: omit=keep, null=clear, object=replace).
      mapConfig: form.mapConfig,
      days: form.days.map((d) => ({
        id: d.id,
        label: d.label.trim(),
        date: d.date.trim(),
        sets: d.sets.map((s) => ({
          id: s.id,
          artist: s.artist.trim(),
          stageId: s.stageId || null,
          startTime: normTime(s.startTime),
          endTime: normTime(s.endTime),
          linkUrl: s.linkUrl.trim() || null,
        })),
      })),
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.put<void>(`/admin/festivals/${editingId}`, payload);
      } else {
        await api.post<void>('/admin/festivals', payload);
      }
      goBack();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't save festival. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const doDelete = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await api.delete<void>(`/admin/festivals/${editingId}`);
      setConfirm(null);
      goBack();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't delete festival. Try again.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  // ── Backfill Spotify ──────────────────────────────────────────────────────
  const doBackfill = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await api.post<void>(`/admin/festivals/${editingId}/backfill-spotify`);
      setConfirm(null);
      // Re-load so freshly-attached links hydrate the set rows.
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't backfill Spotify links. Try again.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const headerTitle = editingId ? 'Edit festival' : 'Create festival';

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

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <LoadingState label="Loading festival" />
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[8], insets.bottom + t.spacing[6]) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Festival fields */}
          <SectionLabel>Festival</SectionLabel>
          <View style={styles.card}>
            <LabeledTextInput
              label="Name"
              value={form.name}
              onChangeText={(v) => updateForm((f) => ({ ...f, name: v }))}
              placeholder="Festival name"
              autoCapitalize="words"
            />
            <LabeledTextInput
              label="Location"
              value={form.location}
              onChangeText={(v) => updateForm((f) => ({ ...f, location: v }))}
              placeholder="City, venue"
              autoCapitalize="words"
            />
            <ModalSelect
              label="Time zone"
              value={form.timeZone}
              options={timeZoneOptions}
              onSelect={(v) => updateForm((f) => ({ ...f, timeZone: v }))}
              hint="Anchors set status & reminders in the festival's zone."
            />
          </View>

          {/* Stages */}
          <SectionLabel>Stages</SectionLabel>
          <View style={styles.card}>
            {form.stages.length === 0 ? (
              <Text style={styles.emptyHint}>No stages yet. Add one below.</Text>
            ) : (
              form.stages.map((stage) => (
                <View key={stage.id} style={styles.stageBlock}>
                  <View style={styles.stageHeader}>
                    <Text style={styles.stageHeaderText}>Stage</Text>
                    <TouchableOpacity
                      onPress={() => removeStage(stage.id)}
                      style={styles.removeBtn}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${stage.name || 'stage'}`}
                    >
                      <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                  <LabeledTextInput
                    label="Name"
                    value={stage.name}
                    onChangeText={(v) => setStageField(stage.id, 'name', v)}
                    placeholder="Main Stage"
                    autoCapitalize="words"
                  />
                  <HexColorField
                    label="Color"
                    value={stage.color}
                    onChangeText={(v) => setStageField(stage.id, 'color', v)}
                  />
                  {/* Pin status. Locations are AUTHORED on the map editor (it has
                      the actual map); here we only surface whether this stage is
                      pinned and link across to set/move it. */}
                  <View style={styles.locationRow}>
                    <Ionicons
                      name={stageIsPinned(stage) ? 'location' : 'location-outline'}
                      size={t.iconSize.sm}
                      color={stageIsPinned(stage) ? t.colors.accent.aqua : t.colors.text.muted}
                    />
                    <Text style={styles.locationText} numberOfLines={1}>
                      {stageIsPinned(stage)
                        ? `Pinned · ${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}`
                        : 'No location pinned'}
                    </Text>
                    {editingId ? (
                      <TouchableOpacity
                        onPress={goToMapEditor}
                        style={styles.locationBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Set location for ${stage.name || 'stage'} on the map`}
                      >
                        <Text style={styles.locationBtnText}>
                          {stageIsPinned(stage) ? 'Move' : 'Set location'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))
            )}
            <TouchableOpacity
              onPress={addStage}
              style={styles.addBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add stage"
            >
              <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
              <Text style={styles.addBtnText}>Add stage</Text>
            </TouchableOpacity>
            {/* Map editor link (edit only — the map screen loads the festival by
                id and persists stage pins + amenities itself). */}
            {editingId ? (
              <TouchableOpacity
                onPress={goToMapEditor}
                style={styles.toolBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Edit festival map"
              >
                <Ionicons name="map-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                <Text style={styles.toolBtnText}>
                  Edit map{amenityCount(form.mapConfig) > 0 ? ` · ${amenityCount(form.mapConfig)} amenities` : ''}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Days & Artists */}
          <SectionLabel>Days &amp; artists</SectionLabel>
          <View style={styles.card}>
            {form.days.length === 0 ? (
              <Text style={styles.emptyHint}>No days yet. Add one below.</Text>
            ) : (
              form.days.map((day) => {
                const isExpanded = expandedDays.has(day.id);
                return (
                  <View key={day.id} style={styles.dayBlock}>
                    <View style={styles.dayHeader}>
                      <TouchableOpacity
                        onPress={() => toggleDay(day.id)}
                        style={styles.chevronBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={isExpanded ? 'Collapse day' : 'Expand day'}
                        accessibilityState={{ expanded: isExpanded }}
                      >
                        <Ionicons
                          name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                          size={t.iconSize.md}
                          color={t.colors.text.secondary}
                        />
                      </TouchableOpacity>
                      <Text style={styles.dayTitle} numberOfLines={1}>
                        {day.label || 'Untitled day'}
                      </Text>
                      <Text style={styles.dayCount}>
                        {day.sets.length} {day.sets.length === 1 ? 'artist' : 'artists'}
                      </Text>
                      <TouchableOpacity
                        onPress={() => removeDay(day.id)}
                        style={styles.removeBtn}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${day.label || 'day'}`}
                      >
                        <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                      </TouchableOpacity>
                    </View>

                    {isExpanded ? (
                      <View style={styles.dayBody}>
                        <LabeledTextInput
                          label="Label"
                          value={day.label}
                          onChangeText={(v) => setDayField(day.id, 'label', v)}
                          placeholder="Day 1 / Friday"
                          autoCapitalize="words"
                        />
                        <DateField
                          label="Date"
                          value={day.date}
                          onChangeText={(v) => setDayField(day.id, 'date', v)}
                        />

                        {day.sets.length === 0 ? (
                          <Text style={styles.emptyHint}>No artists yet. Add one below.</Text>
                        ) : (
                          day.sets.map((s) => (
                            <View key={s.id} style={styles.setBlock}>
                              <View style={styles.setHeader}>
                                <Text style={styles.setHeaderText}>Artist set</Text>
                                <TouchableOpacity
                                  onPress={() => removeSet(day.id, s.id)}
                                  style={styles.removeBtn}
                                  activeOpacity={0.7}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Remove ${s.artist || 'artist'}`}
                                >
                                  <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                                </TouchableOpacity>
                              </View>
                              <LabeledTextInput
                                label="Artist"
                                value={s.artist}
                                onChangeText={(v) => setSetField(day.id, s.id, 'artist', v)}
                                placeholder="Artist name"
                                autoCapitalize="words"
                              />
                              <ModalSelect
                                label="Stage"
                                value={s.stageId || null}
                                options={stageOptions}
                                onSelect={(v) => setSetField(day.id, s.id, 'stageId', v)}
                                placeholder="— Stage —"
                              />
                              <View style={styles.datePair}>
                                <View style={styles.flex}>
                                  <TimeField
                                    label="Start"
                                    value={s.startTime}
                                    onChangeText={(v) => setSetField(day.id, s.id, 'startTime', v)}
                                  />
                                </View>
                                <View style={styles.flex}>
                                  <TimeField
                                    label="End"
                                    value={s.endTime}
                                    onChangeText={(v) => setSetField(day.id, s.id, 'endTime', v)}
                                  />
                                </View>
                              </View>
                              <LabeledTextInput
                                label="Link (optional)"
                                value={s.linkUrl}
                                onChangeText={(v) => setSetField(day.id, s.id, 'linkUrl', v)}
                                placeholder="https://open.spotify.com/…"
                                autoCapitalize="none"
                                keyboardType="url"
                                hint="Spotify or SoundCloud URL."
                              />
                            </View>
                          ))
                        )}
                        <TouchableOpacity
                          onPress={() => addSet(day.id)}
                          style={styles.addBtn}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Add artist"
                        >
                          <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
                          <Text style={styles.addBtnText}>Add artist</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
            <TouchableOpacity
              onPress={addDay}
              style={styles.addBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add day"
            >
              <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
              <Text style={styles.addBtnText}>Add day</Text>
            </TouchableOpacity>
          </View>

          {/* Spotify backfill (edit only) */}
          {editingId ? (
            <>
              <SectionLabel>Tools</SectionLabel>
              <View style={styles.card}>
                <TouchableOpacity
                  onPress={() => setConfirm('backfill')}
                  style={styles.toolBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Backfill Spotify links"
                >
                  <Ionicons name="musical-notes-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                  <Text style={styles.toolBtnText}>Backfill Spotify</Text>
                </TouchableOpacity>
                <Text style={styles.emptyHint}>
                  Auto-searches Spotify for each artist and attaches a link where one is found.
                </Text>
              </View>
            </>
          ) : null}

          {/* Form error */}
          {formError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          {/* Primary actions */}
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
              accessibilityLabel={editingId ? 'Update festival' : 'Create festival'}
            >
              <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.4}>
                {saving ? 'Saving…' : editingId ? 'Update festival' : 'Create festival'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Destructive: delete (edit only) */}
          {editingId ? (
            <TouchableOpacity
              onPress={() => setConfirm('delete')}
              style={styles.deleteBtn}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Delete festival"
            >
              <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
              <Text style={styles.deleteBtnText}>Delete festival</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirm === 'delete' && !busy}
        title="Delete this festival?"
        message="This soft-deletes the festival and hides it from users. Users with picks for it will lose access."
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        destructive
        onConfirm={() => void doDelete()}
        onCancel={() => !busy && setConfirm(null)}
      />
      <ConfirmDialog
        visible={confirm === 'backfill' && !busy}
        title="Backfill Spotify links?"
        message="Searches Spotify for every artist in this festival and attaches a link where a confident match is found. Existing links are preserved."
        confirmLabel={busy ? 'Working…' : 'Backfill'}
        destructive
        onConfirm={() => void doBackfill()}
        onCancel={() => !busy && setConfirm(null)}
      />
      <ConfirmDialog
        visible={showCancelConfirm}
        title="Discard changes?"
        message="You have unsaved edits. Leaving now discards them."
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
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[4],
  },
  datePair: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  emptyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Stages -------------------------------------------------------------------
  stageBlock: {
    gap: t.spacing[3],
    paddingBottom: t.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageHeaderText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  locationText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flex: 1,
  },
  locationBtn: {
    minHeight: 36,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  // Days ---------------------------------------------------------------------
  dayBlock: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 56,
  },
  chevronBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  dayCount: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  dayBody: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    padding: t.spacing[3],
    gap: t.spacing[4],
  },
  // Sets ---------------------------------------------------------------------
  setBlock: {
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setHeaderText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  // Buttons ------------------------------------------------------------------
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  addBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: t.spacing[2],
    justifyContent: 'center',
  },
  removeBtnText: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 48,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.primary,
  },
  toolBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  // Actions ------------------------------------------------------------------
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    minHeight: 48,
    marginTop: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
  },
  deleteBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.coral,
  },
}));
