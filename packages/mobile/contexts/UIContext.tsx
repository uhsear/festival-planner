import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Schedule view modes surfaced by the in-Schedule segmented control. The dense
 * 2D stage×time grid is web/tablet-only (festie.us): a multi-stage grid can't
 * fit a phone, so mobile leads with the single-axis Timeline and degrades to a
 * flat Cards list — the Clashfinder "structure breaks down to fit the screen"
 * rule. Timeline is the mobile default.
 */
export type ViewMode = 'timeline' | 'cards';

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
