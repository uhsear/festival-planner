import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Schedule view modes surfaced by the in-Timeline segmented control. */
export type ViewMode = 'timeline' | 'grid' | 'cards';

interface UIState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** Mobile-only bottom-sheet visibility (e.g. set detail). */
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

const UIContext = createContext<UIState | null>(null);

/**
 * Mobile-only UI slice (view mode + sheet visibility). React context rather
 * than Zustand — zustand isn't a direct mobile dependency, and this state is
 * purely presentational and app-local.
 */
export function UIProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [sheetOpen, setSheetOpen] = useState(false);

  const value = useMemo<UIState>(
    () => ({
      viewMode,
      setViewMode,
      sheetOpen,
      openSheet: () => setSheetOpen(true),
      closeSheet: () => setSheetOpen(false),
    }),
    [viewMode, sheetOpen],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return ctx;
}
