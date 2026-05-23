import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getStorage } from '../platform/storage';

export interface FestivalModeState {
  isFestivalMode: boolean;
  festivalStarted: boolean;
  showPastSets: boolean;
  autoScrollToNow: boolean;
  manuallyDisabled: boolean;
}

export interface FestivalModeActions {
  toggleFestivalMode: () => void;
  setFestivalMode: (on: boolean) => void;
  setFestivalStarted: (started: boolean) => void;
  toggleShowPastSets: () => void;
  toggleAutoScrollToNow: () => void;
}

export type FestivalModeStore = FestivalModeState & FestivalModeActions;

const festivalModeStore: StateCreator<FestivalModeStore> = (set) => ({
  isFestivalMode: false,
  festivalStarted: false,
  showPastSets: true,
  autoScrollToNow: false,
  manuallyDisabled: false,

  toggleFestivalMode: () => {
    set((state) => {
      const next = !state.isFestivalMode;
      return next
        ? { isFestivalMode: true, showPastSets: false, autoScrollToNow: true, manuallyDisabled: false }
        : { isFestivalMode: false, showPastSets: true, autoScrollToNow: false, manuallyDisabled: true };
    });
  },

  setFestivalMode: (on: boolean) => {
    set((state) => {
      if (state.isFestivalMode === on) return state;
      return on
        ? { isFestivalMode: true, showPastSets: false, autoScrollToNow: true, manuallyDisabled: false }
        : { isFestivalMode: false, showPastSets: true, autoScrollToNow: false };
    });
  },

  setFestivalStarted: (started: boolean) => {
    set({ festivalStarted: started });
  },

  toggleShowPastSets: () => {
    set((state) => ({ showPastSets: !state.showPastSets }));
  },

  toggleAutoScrollToNow: () => {
    set((state) => ({ autoScrollToNow: !state.autoScrollToNow }));
  },
});

export const useFestivalModeStore = create<FestivalModeStore>()(
  persist(festivalModeStore, {
    name: 'festie-festival-mode-v2',
    storage: createJSONStorage(() => getStorage()),
    partialize: (state) => ({
      isFestivalMode: state.isFestivalMode,
      manuallyDisabled: state.manuallyDisabled,
    }),
  }),
);

// Pure helper — pass in festival day dates (YYYY-MM-DD) and get back whether
// today is one of them. Kept outside the store so components can call it with
// store-external data without triggering re-renders.
//
// Festival dates are wall-clock dates (e.g. "2026-04-17" = the calendar day
// labeled as Day 1 in local time), so we MUST compare against local date not
// UTC — otherwise users in negative-UTC zones see the banner on the wrong
// calendar day whenever they're past 20:00 local.
export function isTodayFestivalDay(dayDates: string[]): boolean {
  if (!dayDates?.length) return false;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dayDates.includes(today);
}
