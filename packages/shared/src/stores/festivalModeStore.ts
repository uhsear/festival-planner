import { create, StateCreator } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

// Read legacy localStorage keys written by the vanilla-JS frontend so users
// who opted in / opted out there keep their preference after the React cutover.
// Legacy keys: festie-festival-mode ('true'/'false'), festie-festival-mode-disabled ('true').
function readLegacyPrefs(): Partial<FestivalModeState> {
  if (typeof window === 'undefined') return {};
  try {
    const on = localStorage.getItem('festie-festival-mode') === 'true';
    const disabled = localStorage.getItem('festie-festival-mode-disabled') === 'true';
    return { isFestivalMode: on && !disabled, manuallyDisabled: disabled };
  } catch {
    return {};
  }
}

function writeLegacyPrefs(on: boolean, manuallyDisabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('festie-festival-mode', String(on));
    if (manuallyDisabled) {
      localStorage.setItem('festie-festival-mode-disabled', 'true');
    } else {
      localStorage.removeItem('festie-festival-mode-disabled');
    }
  } catch {
    /* private mode / storage quota — ignore */
  }
}

const legacy = readLegacyPrefs();

const festivalModeStore: StateCreator<FestivalModeStore> = (set) => ({
  isFestivalMode: legacy.isFestivalMode ?? false,
  festivalStarted: false,
  showPastSets: !(legacy.isFestivalMode ?? false),
  autoScrollToNow: legacy.isFestivalMode ?? false,
  manuallyDisabled: legacy.manuallyDisabled ?? false,

  toggleFestivalMode: () => {
    set((state) => {
      const next = !state.isFestivalMode;
      writeLegacyPrefs(next, !next);
      return next
        ? { isFestivalMode: true, showPastSets: false, autoScrollToNow: true, manuallyDisabled: false }
        : { isFestivalMode: false, showPastSets: true, autoScrollToNow: false, manuallyDisabled: true };
    });
  },

  setFestivalMode: (on: boolean) => {
    set((state) => {
      if (state.isFestivalMode === on) return state;
      // Turning ON is an explicit opt-in — clear any prior manual-disable so
      // future auto-detect can run normally. Turning OFF via this helper is
      // used by internal redirects (not a user opt-out), so leave the flag
      // alone; toggleFestivalMode is what records real user intent.
      const manuallyDisabled = on ? false : state.manuallyDisabled;
      writeLegacyPrefs(on, manuallyDisabled && !on);
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
    storage: createJSONStorage(() => localStorage),
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
