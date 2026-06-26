import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Linking, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCrewStore } from '@festie/shared/stores';
import { meetingTimeDisplay, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { CrewMeetingPoint, Festival, FestivalDay } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import Button from './Button';

// F4: capture the device's current GPS position via expo-location to fill
// latitude/longitude on create/edit, mirroring the web MeetingPointsTab. Permission
// denial gracefully falls back to the existing free-text location field (coords
// stay null). Map-pick is deferred to the offline-map slice. The shared
// CrewMeetingPoint type, crewStore optimistic placeholder, schema, and backend
// already accept latitude/longitude.

interface CrewMeetingPointsProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
  /** Active festival — supplies the zone so a recurring point's wall-clock is festival-framed. */
  festival?: Festival | null;
  /** Festival days — a recurring point resolves to one occurrence per day. */
  days?: readonly FestivalDay[];
  /**
   * Tap-to-create coords from the map's long-press (deep-linked here). When a new
   * pair arrives, the create form opens prefilled with these coords — the user
   * still fills the label and confirms "Add", so no write happens automatically.
   */
  prefillCoords?: { lat: number; lng: number } | null;
}

// Server enum (lib/constants MEETING_POINT_TYPES) with mobile-facing labels.
const TYPES = [
  { key: 'pre-show', label: 'Pre-show' },
  { key: 'during', label: 'During' },
  { key: 'post-show', label: 'Post-show' },
  { key: 'post-event', label: 'After' },
  { key: 'emergency', label: 'Emergency' },
  { key: 'general', label: 'General' },
] as const;

function typeLabel(type: string): string {
  return TYPES.find((entry) => entry.key === type)?.label ?? 'During';
}

/**
 * Crew meeting points — list the crew's saved meeting spots and add new ones
 * (label + location + type, mirroring the server schema). Creators and owners
 * may remove a point. Uses the shared crewStore actions; the screen owns load.
 */
export default function CrewMeetingPoints({
  crewId,
  currentUserId,
  isOwner,
  festival,
  days = [],
  prefillCoords = null,
}: CrewMeetingPointsProps) {
  const t = useTokens();
  const styles = useStyles();

  // Anchor a recurring point's time-of-day in the festival's zone when known,
  // else the device-local frame (resolveFestivalTimeZone returns undefined).
  const timeZone = resolveFestivalTimeZone(festival);

  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const createMeetingPoint = useCrewStore((s) => s.createMeetingPoint);
  const updateMeetingPoint = useCrewStore((s) => s.updateMeetingPoint);
  const deleteMeetingPoint = useCrewStore((s) => s.deleteMeetingPoint);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  const [stageRef, setStageRef] = useState('');
  const [type, setType] = useState<string>('during');
  // 055: when on, the point repeats every festival day at its time-of-day.
  const [recursDaily, setRecursDaily] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  // F4: optional captured GPS coords. null = no coord (free-text only).
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [focusedField, setFocusedField] = useState<'label' | 'location' | 'stage' | null>(null);

  const reset = () => {
    setLabel('');
    setLocation('');
    setStageRef('');
    setType('during');
    setRecursDaily(false);
    setCoords(null);
    setLocating(false);
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (point: CrewMeetingPoint) => {
    setEditingId(point.id);
    setLabel(point.label);
    setLocation(point.location);
    setStageRef(point.stage_reference ?? '');
    setType(point.type);
    setRecursDaily(!!point.recurs_daily);
    // F4: pre-fill captured coords on edit (null for legacy free-text points).
    setCoords(
      typeof point.latitude === 'number' && typeof point.longitude === 'number'
        ? { lat: point.latitude, lng: point.longitude }
        : null,
    );
    setShowForm(true);
  };

  // Tap-to-create: when the map deep-links a new long-press coordinate, open a
  // fresh create form prefilled with those coords. Keyed off the lat,lng string
  // so the same pair only applies once (a re-render with unchanged params is a
  // no-op); a new tap re-opens. The user still types a label and taps "Add" —
  // the write stays user-gated.
  const lastPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!prefillCoords) return;
    const key = `${prefillCoords.lat},${prefillCoords.lng}`;
    if (lastPrefillRef.current === key) return;
    lastPrefillRef.current = key;
    setEditingId(null);
    setLabel('');
    setLocation('');
    setStageRef('');
    setType('during');
    setRecursDaily(false);
    setCoords({ lat: prefillCoords.lat, lng: prefillCoords.lng });
    setShowForm(true);
  }, [prefillCoords]);

  // F4: capture the device's current position via expo-location. Requests
  // foreground permission; graceful denial keeps the typed free-text location
  // (coords stay null). Mirrors the web MeetingPointsTab captureLocation.
  const captureLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location permission denied',
          'Using the typed location instead. You can enable location access in Settings.',
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert('Location unavailable', "Couldn't get your location — using the typed location instead.");
    } finally {
      setLocating(false);
    }
  };

  // Prefer the point's saved GPS coords (q=lat,lng routes to the exact pin) over
  // the free-text location string, which a maps search can geocode wrongly.
  const openDirections = (point: CrewMeetingPoint) => {
    const q =
      typeof point.latitude === 'number' &&
      typeof point.longitude === 'number' &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude)
        ? `${point.latitude},${point.longitude}`
        : point.location;
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(q)}`).catch(() => {});
  };

  const handleCreate = async () => {
    const l = label.trim();
    const loc = location.trim();
    if (!l || !loc || createBusy) return;
    setCreateBusy(true);
    try {
      const stageReference = stageRef.trim() || null;
      // F4: send captured coords, or null to clear them on edit.
      const latitude = coords ? coords.lat : null;
      const longitude = coords ? coords.lng : null;
      if (editingId) {
        await updateMeetingPoint(crewId, editingId, {
          label: l,
          location: loc,
          type,
          stageReference,
          latitude,
          longitude,
          recursDaily,
        });
      } else {
        await createMeetingPoint(crewId, {
          label: l,
          location: loc,
          type,
          stageReference,
          latitude,
          longitude,
          recursDaily,
        });
      }
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleRemove = (point: CrewMeetingPoint) => {
    Alert.alert('Remove meeting point', `Remove "${point.label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteMeetingPoint(crewId, point.id).catch(() => {});
        },
      },
    ]);
  };

  const canCreate = !!label.trim() && !!location.trim();

  return (
    <View style={styles.container}>
      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{editingId ? 'Edit meeting point' : 'New meeting point'}</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new meeting point"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.typeGrid}>
            {TYPES.map((entry) => {
              const active = type === entry.key;
              return (
                <TouchableOpacity
                  key={entry.key}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  onPress={() => setType(entry.key)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Meeting point type ${entry.label}`}
                >
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{entry.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            testID="mp-label-input"
            style={[styles.input, focusedField === 'label' && styles.inputFocused]}
            placeholder="Label (e.g. Main entrance)"
            placeholderTextColor={t.colors.text.placeholder}
            value={label}
            onChangeText={setLabel}
            maxLength={100}
            onFocus={() => setFocusedField('label')}
            onBlur={() => setFocusedField((f) => (f === 'label' ? null : f))}
            accessibilityLabel="Meeting point label"
          />
          <TextInput
            testID="mp-location-input"
            style={[styles.input, focusedField === 'location' && styles.inputFocused]}
            placeholder="Location (e.g. Near the food court)"
            placeholderTextColor={t.colors.text.placeholder}
            value={location}
            onChangeText={setLocation}
            maxLength={200}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
            onFocus={() => setFocusedField('location')}
            onBlur={() => setFocusedField((f) => (f === 'location' ? null : f))}
            accessibilityLabel="Meeting point location"
          />
          <TextInput
            testID="mp-stage-input"
            style={[styles.input, focusedField === 'stage' && styles.inputFocused]}
            placeholder="Near stage (optional, e.g. Main Stage)"
            placeholderTextColor={t.colors.text.placeholder}
            value={stageRef}
            onChangeText={setStageRef}
            maxLength={100}
            onFocus={() => setFocusedField('stage')}
            onBlur={() => setFocusedField((f) => (f === 'stage' ? null : f))}
            accessibilityLabel="Meeting point stage reference"
          />
          {/* F4: optional GPS capture. Falls back to free-text on denial. */}
          <View style={styles.captureRow}>
            <Button
              variant="utility"
              size="sm"
              icon="locate-outline"
              label="Use my location"
              loadingLabel="Locating…"
              loading={locating}
              onPress={captureLocation}
            />
            {coords ? (
              <View style={styles.coordChip} accessibilityLabel="Captured location">
                <Ionicons name="checkmark" size={12} color={t.colors.accent.aqua} />
                <Text style={styles.coordChipText}>
                  {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                </Text>
                <TouchableOpacity
                  onPress={() => setCoords(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear captured location"
                >
                  <Ionicons name="close" size={12} color={t.colors.accent.aqua} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* 055: daily-recurrence toggle. On → the point repeats every festival
              day at its time-of-day (rendered "daily 3:00 PM"). */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleBody}>
              <Text style={styles.toggleTitle}>Repeats daily</Text>
              <Text style={styles.toggleHint} numberOfLines={2}>
                Meet here at the same time every festival day.
              </Text>
            </View>
            <Switch
              value={recursDaily}
              onValueChange={setRecursDaily}
              trackColor={{ false: t.colors.border.default, true: t.colors.accent.aqua }}
              thumbColor={t.colors.text.onAccent}
              accessibilityLabel="Repeats daily"
            />
          </View>

          <Button
            label={editingId ? 'Save' : 'Add'}
            loading={createBusy}
            loadingLabel={editingId ? 'Saving…' : 'Adding…'}
            disabled={!canCreate}
            onPress={handleCreate}
            accessibilityLabel="Add meeting point"
          />
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setShowForm(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add a meeting point"
        >
          <Ionicons name="location-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Add meeting point</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {meetingPoints.length === 0 ? (
        <Text style={styles.empty}>No meeting points yet — drop a pin so your crew knows where to meet.</Text>
      ) : (
        meetingPoints.map((point) => {
          const canRemove = point.created_by === currentUserId || isOwner;
          const isEmergency = point.type === 'emergency';
          // 055: resolve the point's display time honoring daily recurrence.
          // Recurring → "daily 3:00 PM"; one-shot → "Sat 3:00 PM"; no meetAt → ''.
          const timeDisplay = meetingTimeDisplay(point.meet_at, point.recurs_daily, days, new Date(), timeZone);
          return (
            <View key={point.id} style={[styles.pointRow, isEmergency && styles.pointRowEmergency]}>
              <View style={styles.pointInfo}>
                <View style={styles.pointTitleRow}>
                  <Text style={styles.pointLabel} numberOfLines={1}>
                    {point.label}
                  </Text>
                  <Text style={styles.pointType}>{typeLabel(point.type)}</Text>
                  {point.recurs_daily ? (
                    <View style={styles.recurBadge} accessibilityLabel="Repeats daily">
                      <Ionicons name="repeat" size={11} color={t.colors.accent.aqua} />
                      <Text style={styles.recurBadgeText}>Daily</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.pointLocation} numberOfLines={1}>
                  {point.location}
                </Text>
                {point.stage_reference ? (
                  <Text style={styles.pointStage} numberOfLines={1}>
                    Near {point.stage_reference}
                  </Text>
                ) : null}
                {timeDisplay.label ? (
                  <View style={styles.pointTimeRow}>
                    <Ionicons name="time-outline" size={12} color={t.colors.accent.aqua} />
                    <Text style={styles.pointTime} numberOfLines={1}>
                      {timeDisplay.label}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  onPress={() => openDirections(point)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Directions to ${point.label}`}
                >
                  <Ionicons name="navigate-outline" size={18} color={t.colors.accent.aqua} />
                </TouchableOpacity>
                {canRemove ? (
                  <>
                    <TouchableOpacity
                      onPress={() => startEdit(point)}
                      style={styles.iconButton}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit meeting point ${point.label}`}
                    >
                      <Ionicons name="create-outline" size={18} color={t.colors.accent.aqua} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemove(point)}
                      style={styles.iconButton}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove meeting point ${point.label}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={t.colors.text.danger} />
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  toggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  formBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  typeChip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  typeChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  typeChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  typeChipTextActive: {
    color: t.colors.accent.aqua,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  coordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.ring.aqua,
  },
  coordChipText: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[1],
  },
  toggleBody: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  toggleHint: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  pointRowEmergency: {
    borderColor: t.colors.accent.coral,
  },
  pointInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  pointTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  pointLabel: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  pointType: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textTransform: 'uppercase',
  },
  recurBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.ring.aqua,
  },
  recurBadgeText: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
  },
  pointLocation: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  pointStage: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
  },
  pointTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  pointTime: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
}));
