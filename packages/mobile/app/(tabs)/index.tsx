import { useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';
import { useFestivalDataStore } from '@festie/shared/stores';
import FestivalList from '../../components/FestivalList';

export default function TimelineScreen() {
  const festivals = useFestivalDataStore((s) => s.festivals);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);

  const clearSelection = useCallback(() => {
    useFestivalDataStore.setState({
      currentFestivalId: null,
      currentFestival: null,
      currentProfile: null,
      sets: [],
      stages: [],
      days: [],
    });
  }, []);

  useEffect(() => {
    if (festivals.length === 0) {
      loadFestivals().catch(() => {});
    }
  }, [festivals.length, loadFestivals]);

  // No festival selected -- show the festival selector
  if (!currentFestival) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons
            name="musical-notes"
            size={24}
            color={colors.accent.aqua}
          />
          <Text style={styles.headerTitle}>Select a Festival</Text>
        </View>
        <FestivalList />
      </View>
    );
  }

  // Festival selected -- show timeline placeholder
  return (
    <View style={styles.placeholderContainer}>
      <Ionicons name="calendar" size={48} color={colors.accent.aqua} />
      <Text style={styles.festivalName}>{currentFestival.name}</Text>
      <Text style={styles.subtitle}>Coming soon – Timeline</Text>
      <TouchableOpacity
        style={styles.switchButton}
        onPress={clearSelection}
        activeOpacity={0.7}
      >
        <Ionicons
          name="swap-horizontal"
          size={16}
          color={colors.accent.aqua}
        />
        <Text style={styles.switchText}>Switch festival</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerTitle: {
    fontSize: fontSize[20],
    fontWeight: '700',
    color: colors.text.primary,
  },
  placeholderContainer: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
  },
  festivalName: {
    fontSize: fontSize[24],
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize[16],
    color: colors.text.secondary,
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.accent.aqua,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radii.default,
    marginTop: spacing[4],
  },
  switchText: {
    fontSize: fontSize[14],
    fontWeight: '600',
    color: colors.accent.aqua,
  },
});
