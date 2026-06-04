import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import type { CrewRideOffer } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface CrewRidesProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew carpool / ride board (M2 logistics) — a shared "who's driving" board.
 * Offline-native: reads/writes go through the crewStore, so an offer posted with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as packing). Each row is a ride OFFER — driver, seats, where
 * they're leaving from and when. The screen owns loading.
 */
export default function CrewRides({ crewId, currentUserId, isOwner }: CrewRidesProps) {
  const t = useTokens();
  const styles = useStyles();

  const offers = useCrewStore((s) => s.rideOffers);
  const createRideOffer = useCrewStore((s) => s.createRideOffer);
  const deleteRideOffer = useCrewStore((s) => s.deleteRideOffer);

  const [showForm, setShowForm] = useState(false);
  const [driver, setDriver] = useState('');
  const [seats, setSeats] = useState('');
  const [departFrom, setDepartFrom] = useState('');
  const [departAt, setDepartAt] = useState('');
  const [note, setNote] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reset = () => {
    setDriver('');
    setSeats('');
    setDepartFrom('');
    setDepartAt('');
    setNote('');
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (createBusy) return;
    const d = driver.trim();
    const from = departFrom.trim();
    const at = departAt.trim();
    const n = note.trim();
    const seatsNum = seats.trim() ? Number(seats.trim()) : null;
    if (!d && !from && !at && !n && seatsNum == null) return;
    setCreateBusy(true);
    try {
      await createRideOffer(crewId, {
        driver: d || null,
        seats: seatsNum != null && Number.isFinite(seatsNum) ? seatsNum : null,
        departFrom: from || null,
        departAt: at || null,
        note: n || null,
      });
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDelete = (offer: CrewRideOffer) => {
    Alert.alert('Remove ride', `Remove this ride from the board?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBusyId(offer.id);
          deleteRideOffer(crewId, offer.id)
            .catch(() => {})
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const canCreate = !!driver.trim() || !!departFrom.trim() || !!departAt.trim() || !!note.trim() || !!seats.trim();

  return (
    <View style={styles.container}>
      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New ride</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new ride"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Who's driving?"
            placeholderTextColor={t.colors.text.placeholder}
            value={driver}
            onChangeText={setDriver}
            maxLength={100}
            accessibilityLabel="Driver"
          />
          <TextInput
            style={styles.input}
            placeholder="Open seats"
            placeholderTextColor={t.colors.text.placeholder}
            value={seats}
            onChangeText={setSeats}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Open seats"
          />
          <TextInput
            style={styles.input}
            placeholder="Leaving from"
            placeholderTextColor={t.colors.text.placeholder}
            value={departFrom}
            onChangeText={setDepartFrom}
            maxLength={200}
            accessibilityLabel="Leaving from"
          />
          <TextInput
            style={styles.input}
            placeholder="When (Fri 2pm)"
            placeholderTextColor={t.colors.text.placeholder}
            value={departAt}
            onChangeText={setDepartAt}
            maxLength={100}
            accessibilityLabel="Depart time"
          />
          <TextInput
            style={styles.input}
            placeholder="Note"
            placeholderTextColor={t.colors.text.placeholder}
            value={note}
            onChangeText={setNote}
            maxLength={500}
            accessibilityLabel="Note"
          />
          <TouchableOpacity
            style={[styles.primaryButton, (createBusy || !canCreate) && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={createBusy || !canCreate}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Post ride"
          >
            <Text style={styles.primaryButtonText}>{createBusy ? 'Posting…' : 'Post ride'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setShowForm(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Post a ride"
        >
          <Ionicons name="car-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Post a ride</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {offers.length === 0 ? (
        <Text style={styles.empty}>No rides yet — post a carpool so your crew can ride together.</Text>
      ) : (
        offers.map((offer) => {
          const canRemove = offer.created_by === currentUserId || isOwner;
          const title = offer.driver || 'Ride offer';
          const meta = [
            typeof offer.seats === 'number' ? `${offer.seats} seat${offer.seats === 1 ? '' : 's'}` : null,
            offer.depart_from,
            offer.depart_at,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <View key={offer.id} style={styles.itemRow}>
              <View style={styles.iconBadge}>
                <Ionicons name="car" size={16} color={t.colors.accent.aqua} />
              </View>
              <View style={styles.itemBody}>
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {title}
                </Text>
                {meta ? (
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
                {offer.note ? (
                  <Text style={styles.itemNote} numberOfLines={2}>
                    {offer.note}
                  </Text>
                ) : null}
              </View>
              {canRemove ? (
                <TouchableOpacity
                  onPress={() => handleDelete(offer)}
                  disabled={busyId === offer.id}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Remove ride"
                >
                  <Ionicons name="trash-outline" size={16} color={t.colors.accent.coral} />
                </TouchableOpacity>
              ) : null}
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
    backgroundColor: t.colors.accent.coral,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  iconButton: {
    padding: t.spacing[1],
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  iconBadge: {
    width: 24,
    height: 24,
    borderRadius: t.radii.sm ?? 6,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  itemMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  itemNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));
