import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCrewStore } from '@festie/shared/stores';
import { etaMinutes, formatStaleness } from '@festie/shared/utils';
import type { CrewMemberStatus } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

interface CrewStatusProps {
  crewId: string;
  currentUserId: string;
}

// Status enum → user-facing label + icon. `null` clears the status.
const STATUS_OPTIONS = [
  { key: 'on-my-way', label: 'On my way', icon: 'walk-outline' },
  { key: 'here', label: "I'm here", icon: 'checkmark-circle-outline' },
  { key: 'delayed', label: 'Running late', icon: 'time-outline' },
] as const;

type StatusKey = (typeof STATUS_OPTIONS)[number]['key'];

function statusMeta(status: string | null): { label: string; icon: keyof typeof Ionicons.glyphMap } {
  const found = STATUS_OPTIONS.find((o) => o.key === status);
  return found
    ? { label: found.label, icon: found.icon as keyof typeof Ionicons.glyphMap }
    : { label: '', icon: 'location-outline' };
}

/**
 * Crew member status (M5) — last-synced "On my way to [meeting point] · ETA ~N
 * min" action + a crew status list with HONEST staleness.
 *
 * CARDINAL RULE: this is offline-DEGRADED-SYNCS, NOT live GPS. Every row is a
 * snapshot the member set (often offline) that delivered on the next signal
 * blip. The copy ALWAYS says "as of N ago" (formatStaleness) and "sent when
 * signal returns" — it NEVER implies a live, moving position.
 *
 * Offline path: updateMyStatus queues the PUT with a deterministic clientId so
 * repeated toggles collapse, optimistically upserts my row, and reconciles on
 * reconnect. ETA is computed (etaMinutes from @festie/shared) from the device's
 * captured position to the target meeting point's saved coord when both exist;
 * otherwise the member types a manual estimate. Mirrors the web CrewStatus.
 */
export default function CrewStatus({ crewId, currentUserId }: CrewStatusProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const statuses = useCrewStore((s) => s.crewStatuses);
  const loadStatuses = useCrewStore((s) => s.loadStatuses);
  const updateMyStatus = useCrewStore((s) => s.updateMyStatus);

  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState<StatusKey>('on-my-way');
  const [targetId, setTargetId] = useState<string>('');
  const [manualEta, setManualEta] = useState<string>('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load once per crew. Offline this resolves from the persisted read-cache.
  useEffect(() => {
    if (crewId) loadStatuses(crewId).catch(() => {});
  }, [crewId, loadStatuses]);

  // Realtime crew:status-updated patching is wired centrally (single shared
  // socket), so this component just reads crewStore.crewStatuses.

  const target = useMemo(() => meetingPoints.find((m) => m.id === targetId) ?? null, [meetingPoints, targetId]);

  // Geo-computed ETA: device position → target coord. null when either is
  // missing (no coord target, or no captured position) — then the manual
  // estimate is used.
  const computedEta = useMemo(() => {
    if (!coords || !target || typeof target.latitude !== 'number' || typeof target.longitude !== 'number') {
      return null;
    }
    return etaMinutes(
      { latitude: coords.lat, longitude: coords.lng },
      { latitude: target.latitude, longitude: target.longitude },
    );
  }, [coords, target]);

  const effectiveEta = computedEta ?? (manualEta.trim() ? Number(manualEta.trim()) : null);

  const reset = () => {
    setStatus('on-my-way');
    setTargetId('');
    setManualEta('');
    setNote('');
    setCoords(null);
    setLocating(false);
    setShowForm(false);
  };

  // Capture the device position via expo-location for a distance-based ETA to
  // the target meeting point's saved coord. Permission denial gracefully falls
  // back to the manual estimate.
  const captureLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        Alert.alert('Location permission denied', 'Type an ETA estimate instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert('Location unavailable', "Couldn't get your location — type an ETA estimate instead.");
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const eta = effectiveEta != null && Number.isFinite(effectiveEta) ? Math.round(effectiveEta) : null;
      await updateMyStatus(
        crewId,
        {
          status,
          targetMeetingPointId: targetId || null,
          etaMinutes: eta != null && eta >= 0 ? Math.min(eta, 1440) : null,
          note: note.trim() || null,
        },
        currentUserId,
      );
      haptics.success();
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  const clearMine = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateMyStatus(
        crewId,
        { status: null, targetMeetingPointId: null, etaMinutes: null, note: null },
        currentUserId,
      );
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusy(false);
    }
  };

  const mine = statuses.find((s) => s.user_id === currentUserId && s.status);
  const labelFor = (id: string | null) => (id ? (meetingPoints.find((m) => m.id === id)?.label ?? null) : null);
  const activeStatuses = statuses.filter((s) => s.status);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="navigate-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.headerTitle}>Crew status</Text>
        </View>
        {!showForm ? (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowForm(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={mine ? 'Update my status' : 'Share that you are on my way'}
          >
            <Text style={styles.headerButtonText}>{mine ? 'Update mine' : 'On my way…'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Honesty banner: this is NEVER live. */}
      <Text style={styles.banner}>
        Last-synced positions, not live tracking. Sent when signal returns; shown “as of” when each crewmate last
        synced.
      </Text>

      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Share my status</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel status"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          {/* Status radios */}
          <View style={styles.statusGrid}>
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.statusChip, active && styles.statusChipActive]}
                  onPress={() => setStatus(opt.key)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={opt.label}
                >
                  <Ionicons
                    name={opt.icon as keyof typeof Ionicons.glyphMap}
                    size={16}
                    color={active ? t.colors.accent.aqua : t.colors.text.secondary}
                  />
                  <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ETA target: a meeting point. Coordless points still work (manual ETA). */}
          <Text style={styles.fieldLabel}>Heading to</Text>
          <View style={styles.typeGrid}>
            <TouchableOpacity
              style={[styles.targetChip, !targetId && styles.targetChipActive]}
              onPress={() => setTargetId('')}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: !targetId }}
              accessibilityLabel="No specific point"
            >
              <Text style={[styles.targetChipText, !targetId && styles.targetChipTextActive]}>No specific point</Text>
            </TouchableOpacity>
            {meetingPoints.map((m) => {
              const active = targetId === m.id;
              const hasCoord = typeof m.latitude === 'number' && typeof m.longitude === 'number';
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.targetChip, active && styles.targetChipActive]}
                  onPress={() => setTargetId(m.id)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Heading to ${m.label}`}
                >
                  {hasCoord ? (
                    <Ionicons name="location" size={12} color={active ? t.colors.accent.aqua : t.colors.text.muted} />
                  ) : null}
                  <Text style={[styles.targetChipText, active && styles.targetChipTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Location capture → geo ETA, or manual estimate. */}
          <View style={styles.captureRow}>
            <TouchableOpacity
              style={[styles.captureButton, locating && styles.buttonDisabled]}
              onPress={captureLocation}
              disabled={locating}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Use my location for ETA"
            >
              <Ionicons name="locate-outline" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.captureButtonText}>{locating ? 'Locating…' : 'Use my location'}</Text>
            </TouchableOpacity>
            {computedEta != null ? (
              <Text style={styles.etaText}>ETA ~{computedEta} min</Text>
            ) : (
              <TextInput
                style={styles.etaInput}
                placeholder="ETA min"
                placeholderTextColor={t.colors.text.placeholder}
                keyboardType="number-pad"
                value={manualEta}
                onChangeText={setManualEta}
                maxLength={4}
                accessibilityLabel="ETA in minutes"
              />
            )}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Note (optional, e.g. grabbing water first)"
            placeholderTextColor={t.colors.text.placeholder}
            value={note}
            onChangeText={setNote}
            maxLength={280}
            accessibilityLabel="Status note"
          />

          <TouchableOpacity
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={submit}
            disabled={busy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share status"
          >
            <Text style={styles.primaryButtonText}>
              {busy
                ? 'Sharing…'
                : target && status === 'on-my-way'
                  ? `On my way to ${target.label}${effectiveEta != null ? ` · ETA ~${Math.round(effectiveEta)} min` : ''}`
                  : 'Share status'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.sendHint}>Sent when signal returns.</Text>
        </View>
      ) : null}

      {/* Crew status list with HONEST staleness. */}
      {activeStatuses.length > 0 ? (
        <View style={styles.list}>
          {activeStatuses.map((s: CrewMemberStatus) => {
            const meta = statusMeta(s.status);
            const isMe = s.user_id === currentUserId;
            const targetLabel = labelFor(s.target_meeting_point_id);
            return (
              <View key={s.user_id} style={styles.statusRow}>
                <Ionicons name={meta.icon} size={18} color={t.colors.accent.aqua} style={styles.statusRowIcon} />
                <View style={styles.statusRowBody}>
                  <View style={styles.statusRowTitle}>
                    <Text style={styles.statusRowName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                      {isMe ? 'You' : s.name || s.username || 'Crewmate'}
                    </Text>
                    <Text style={styles.statusRowState} numberOfLines={1}>
                      {meta.label}
                    </Text>
                  </View>
                  {targetLabel ? (
                    <Text style={styles.statusRowTarget} numberOfLines={1}>
                      → {targetLabel}
                      {typeof s.eta_minutes === 'number' ? ` · ETA ~${s.eta_minutes} min` : ''}
                    </Text>
                  ) : typeof s.eta_minutes === 'number' ? (
                    <Text style={styles.statusRowTarget}>ETA ~{s.eta_minutes} min</Text>
                  ) : null}
                  {s.note ? (
                    <Text style={styles.statusRowNote} numberOfLines={2}>
                      {s.note}
                    </Text>
                  ) : null}
                  {/* Honest staleness — the cardinal rule. */}
                  <Text style={styles.staleness}>{formatStaleness(s.updated_at)}</Text>
                </View>
                {isMe ? (
                  <TouchableOpacity
                    onPress={clearMine}
                    disabled={busy}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear my status"
                  >
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  headerTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  headerButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  headerButtonText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  banner: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
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
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  statusChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  statusChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statusChipTextActive: {
    color: t.colors.accent.aqua,
  },
  fieldLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  targetChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  targetChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  targetChipTextActive: {
    color: t.colors.accent.aqua,
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  captureButtonText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  etaText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  etaInput: {
    width: 96,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    ...typeStyle('body'),
    color: t.colors.text.primary,
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
  primaryButton: {
    // accent rule: aqua primary + dark ink (coral = danger/SOS only; coral-on-white failed AA)
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typeStyle('label'),
    // accent rule: aqua primary + dark ink (coral = danger/SOS only; coral-on-white failed AA)
    color: t.colors.text.onLightAccent,
    textAlign: 'center',
  },
  sendHint: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
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
  list: {
    gap: t.spacing[2],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  statusRowIcon: {
    marginTop: 1,
  },
  statusRowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  statusRowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    flexWrap: 'wrap',
  },
  statusRowName: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  statusRowState: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  statusRowTarget: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  statusRowNote: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  staleness: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  clearText: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
}));
