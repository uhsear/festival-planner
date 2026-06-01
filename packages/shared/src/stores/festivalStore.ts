// Backward-compatible facade -- re-exports the split stores and provides
// a combined `useFestivalStore` hook so existing consumer code keeps working
// without any import changes.
//
// New code should import from festivalDataStore / festivalUIStore directly.

import { useCallback, useRef, useSyncExternalStore } from 'react';
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
// FIX: The previous implementation called `useFestivalDataStore()` and
// `useFestivalUIStore()` without selectors on every render, meaning every
// component using the facade re-rendered on ANY change to EITHER store.
//
// This rewrite uses `useSyncExternalStore` to subscribe to both underlying
// stores but only triggers a re-render when the *selected* value changes
// (compared via `Object.is`, matching Zustand's default behavior).

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

// Subscribe to both underlying stores. The listener fires when either
// data store or UI store changes -- but useSyncExternalStore will only
// trigger a React re-render if `getSnapshot` returns a different value.
function subscribeToBothStores(listener: () => void): () => void {
  const unsubData = useFestivalDataStore.subscribe(listener);
  const unsubUI = useFestivalUIStore.subscribe(listener);
  return () => {
    unsubData();
    unsubUI();
  };
}

export const useFestivalStore: UseFestivalStore = (<T>(selector?: (state: FestivalStore) => T): T | FestivalStore => {
  // Fast path: no selector -- return the full merged state (rare in practice,
  // kept for API compatibility). This will re-render on any change.
  if (!selector) {
    return useSyncExternalStore(subscribeToBothStores, getMergedState, getMergedState);
  }

  // With a selector: only re-render when the selected slice changes.
  // We cache the last snapshot so useSyncExternalStore sees a stable
  // reference when the selected value hasn't changed.
  const cachedRef = useRef<{ value: T; merged: FestivalStore } | null>(null);

  const getSnapshot = useCallback((): T => {
    const merged = getMergedState();
    const next = selector(merged);

    // Return the cached value if the selected slice is unchanged.
    // This preserves referential identity, preventing re-renders.
    if (cachedRef.current !== null && Object.is(cachedRef.current.value, next)) {
      return cachedRef.current.value;
    }

    cachedRef.current = { value: next, merged };
    return next;
  }, [selector]);

  return useSyncExternalStore(subscribeToBothStores, getSnapshot, getSnapshot);
}) as UseFestivalStore;

// Static methods used by non-React code (e.g. `useFestivalStore.getState()`)
useFestivalStore.getState = getMergedState;

useFestivalStore.setState = (partial: Partial<FestivalStore>) => {
  // Route each field to its owning store
  const dataKeys = new Set<string>([
    'festivals',
    'currentFestivalId',
    'currentFestival',
    'currentProfile',
    'allProfiles',
    'sets',
    'stages',
    'days',
    'isLoading',
    'error',
    'loadFestivals',
    'selectFestival',
    'loadProfiles',
    'setCurrentProfile',
    'savePick',
    'removePick',
    'saveNote',
    'setError',
  ]);
  const uiKeys = new Set<string>([
    'selectedDay',
    'activeStages',
    'searchQuery',
    'onlyMine',
    'setSelectedDay',
    'setActiveStages',
    'setSearchQuery',
    'setOnlyMine',
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
