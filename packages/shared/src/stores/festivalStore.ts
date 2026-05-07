// Backward-compatible facade -- re-exports the split stores and provides
// a combined `useFestivalStore` hook so existing consumer code keeps working
// without any import changes.
//
// New code should import from festivalDataStore / festivalUIStore directly.

import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import type { FestivalDataState, FestivalDataActions } from './festivalDataStore';
import type { FestivalUIState, FestivalUIActions } from './festivalUIStore';

export type { FestivalDataState, FestivalDataActions } from './festivalDataStore';
export type { FestivalUIState, FestivalUIActions } from './festivalUIStore';
export { useFestivalDataStore } from './festivalDataStore';
export { useFestivalUIStore } from './festivalUIStore';

// Legacy combined types -- kept so `FestivalState`, `FestivalActions`, and
// `FestivalStore` remain importable from this module.
export type FestivalState = FestivalDataState & FestivalUIState;
export type FestivalActions = FestivalDataActions & FestivalUIActions;
export type FestivalStore = FestivalState & FestivalActions;

// ── Combined hook ────────────────────────────────────────────────────────
// Merges both stores into a single selector surface so every existing
// `useFestivalStore((s) => s.foo)` call works without modification.
//
// Implementation: a thin wrapper that subscribes to both underlying stores
// and returns a merged object.  The `Object.assign` approach avoids an
// extra render because `useSyncExternalStore` (used internally by Zustand)
// already de-duplicates by referential equality on each slice.

type UseFestivalStore = {
  (): FestivalStore;
  <T>(selector: (state: FestivalStore) => T): T;
  getState: () => FestivalStore;
  setState: (partial: Partial<FestivalStore>) => void;
};

function getMergedState(): FestivalStore {
  return {
    ...useFestivalDataStore.getState(),
    ...useFestivalUIStore.getState(),
  } as FestivalStore;
}

export const useFestivalStore: UseFestivalStore = (<T,>(
  selector?: (state: FestivalStore) => T,
): T | FestivalStore => {
  // Subscribe to both stores so the component re-renders when either changes
  const dataState = useFestivalDataStore();
  const uiState = useFestivalUIStore();

  const merged: FestivalStore = {
    ...dataState,
    ...uiState,
  } as FestivalStore;

  if (selector) {
    return selector(merged);
  }
  return merged;
}) as UseFestivalStore;

// Static methods used by non-React code (e.g. `useFestivalStore.getState()`)
useFestivalStore.getState = getMergedState;

useFestivalStore.setState = (partial: Partial<FestivalStore>) => {
  // Route each field to its owning store
  const dataKeys = new Set<string>([
    'festivals', 'currentFestivalId', 'currentFestival', 'currentProfile',
    'allProfiles', 'sets', 'stages', 'days', 'isLoading', 'error',
    'loadFestivals', 'selectFestival', 'loadProfiles', 'setCurrentProfile',
    'savePick', 'removePick', 'saveNote', 'setError',
  ]);
  const uiKeys = new Set<string>([
    'selectedDay', 'activeStages', 'searchQuery',
    'setSelectedDay', 'setActiveStages', 'setSearchQuery',
  ]);

  const dataPart: Record<string, unknown> = {};
  const uiPart: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(partial)) {
    if (dataKeys.has(key)) {
      dataPart[key] = value;
    } else if (uiKeys.has(key)) {
      uiPart[key] = value;
    }
  }

  if (Object.keys(dataPart).length > 0) {
    useFestivalDataStore.setState(dataPart);
  }
  if (Object.keys(uiPart).length > 0) {
    useFestivalUIStore.setState(uiPart);
  }
};
