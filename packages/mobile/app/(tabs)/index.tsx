import { useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import { useUI, type ViewMode } from '../../contexts/UIContext';
import SegmentedControl from '../../components/SegmentedControl';
import FestivalList from '../../components/FestivalList';

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'grid', label: 'Grid' },
  { value: 'cards', label: 'Cards' },
];

export default function TimelineScreen() {
  const t = useTokens();
  const styles = useStyles();
  const { viewMode, setViewMode } = useUI();
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
          <Ionicons name="musical-notes" size={24} color={t.colors.accent.aqua} />
          <Text style={styles.headerTitle}>Select a Festival</Text>
        </View>
        <FestivalList />
      </View>
    );
  }

  const activeLabel =
    VIEW_OPTIONS.find((o) => o.value === viewMode)?.label ?? 'Timeline';

  // Festival selected -- view switcher + placeholder for the chosen mode
  return (
    <View style={styles.container}>
      <View style={styles.viewSwitcher}>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={setViewMode}
          accessibilityLabel="Schedule view"
        />
      </View>
      <View style={styles.placeholderContainer}>
        <Ionicons name="calendar" size={48} color={t.colors.accent.aqua} />
        <Text style={styles.festivalName}>{currentFestival.name}</Text>
        <Text style={styles.subtitle}>Coming soon – {activeLabel}</Text>
        <TouchableOpacity
          style={styles.switchButton}
          onPress={clearSelection}
          activeOpacity={0.7}
        >
          <Ionicons name="swap-horizontal" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.switchText}>Switch festival</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  headerTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  viewSwitcher: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  placeholderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  festivalName: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    marginTop: t.spacing[4],
  },
  switchText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
