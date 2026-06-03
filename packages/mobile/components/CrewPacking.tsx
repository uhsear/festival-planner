import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import type { CrewPackingItem } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

interface CrewPackingProps {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew packing board (M2 logistics) — a shared "who's bringing what" checklist.
 * Offline-native: reads/writes go through the crewStore, so an item added with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as polls). Tapping the checkbox claims/unclaims an item (sets or
 * clears `brought_by` = current user). The screen owns loading.
 */
export default function CrewPacking({ crewId, currentUserId, isOwner }: CrewPackingProps) {
  const t = useTokens();
  const styles = useStyles();

  const items = useCrewStore((s) => s.packingItems);
  const createPackingItem = useCrewStore((s) => s.createPackingItem);
  const updatePackingItem = useCrewStore((s) => s.updatePackingItem);
  const deletePackingItem = useCrewStore((s) => s.deletePackingItem);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reset = () => {
    setLabel('');
    setShowForm(false);
  };

  const handleCreate = async () => {
    const l = label.trim();
    if (!l || createBusy) return;
    setCreateBusy(true);
    try {
      await createPackingItem(crewId, { label: l });
      reset();
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleToggle = async (item: CrewPackingItem) => {
    if (busyId === item.id) return;
    setBusyId(item.id);
    try {
      // Claim: mark claimed + record this user as the bringer. Un-claim: clear both.
      await updatePackingItem(crewId, item.id, {
        claimed: !item.claimed,
        broughtBy: !item.claimed ? currentUserId : null,
      });
    } catch {
      // Error surfaced via the crew store.
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (item: CrewPackingItem) => {
    Alert.alert('Remove item', `Remove "${item.label}" from the packing list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBusyId(item.id);
          deletePackingItem(crewId, item.id)
            .catch(() => {})
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const canCreate = !!label.trim();

  return (
    <View style={styles.container}>
      {showForm ? (
        <View style={styles.formBox}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>New item</Text>
            <TouchableOpacity
              onPress={reset}
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel new packing item"
            >
              <Ionicons name="close" size={18} color={t.colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Tent, cooler, sunscreen…"
            placeholderTextColor={t.colors.text.placeholder}
            value={label}
            onChangeText={setLabel}
            maxLength={200}
            accessibilityLabel="Packing item label"
          />
          <TouchableOpacity
            style={[styles.primaryButton, (createBusy || !canCreate) && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={createBusy || !canCreate}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add packing item"
          >
            <Text style={styles.primaryButtonText}>{createBusy ? 'Adding…' : 'Add'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setShowForm(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add a packing item"
        >
          <Ionicons name="bag-add-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.toggleText}>Add packing item</Text>
          <Ionicons name="add" size={16} color={t.colors.accent.aqua} />
        </TouchableOpacity>
      )}

      {items.length === 0 ? (
        <Text style={styles.empty}>Nothing on the list yet — add what your crew needs to bring.</Text>
      ) : (
        items.map((item) => {
          const mine = item.brought_by === currentUserId;
          const canRemove = item.created_by === currentUserId || isOwner;
          return (
            <View key={item.id} style={styles.itemRow}>
              <TouchableOpacity
                onPress={() => handleToggle(item)}
                disabled={busyId === item.id}
                style={[styles.checkbox, item.claimed && styles.checkboxOn]}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.claimed }}
                accessibilityLabel={item.claimed ? `Unclaim ${item.label}` : `Claim ${item.label}`}
              >
                {item.claimed ? <Ionicons name="checkmark" size={16} color={t.colors.accent.aqua} /> : null}
              </TouchableOpacity>
              <View style={styles.itemBody}>
                <Text style={[styles.itemLabel, item.claimed && styles.itemLabelClaimed]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.claimed && item.brought_by ? (
                  <Text style={styles.itemMeta}>{mine ? 'Bringing it' : 'Claimed'}</Text>
                ) : null}
              </View>
              {canRemove ? (
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  disabled={busyId === item.id}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.label}`}
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
    alignItems: 'center',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: t.radii.sm ?? 6,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  itemLabelClaimed: {
    color: t.colors.text.secondary,
    textDecorationLine: 'line-through',
  },
  itemMeta: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
}));
