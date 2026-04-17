import { create, StateCreator } from 'zustand';

export interface FestivalModeState {
  isFestivalMode: boolean;
  festivalStarted: boolean;
  showPastSets: boolean;
  autoScrollToNow: boolean;
}

export interface FestivalModeActions {
  toggleFestivalMode: () => void;
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

  toggleFestivalMode: () => {
    set((state) => {
      const newFestivalMode = !state.isFestivalMode;

      // When turning ON: set showPastSets: false, autoScrollToNow: true
      // When turning OFF: reset to defaults
      if (newFestivalMode) {
        return {
          isFestivalMode: true,
          showPastSets: false,
          autoScrollToNow: true,
        };
      } else {
        return {
          isFestivalMode: false,
          showPastSets: true,
          autoScrollToNow: false,
        };
      }
    });
  },

  setFestivalStarted: (started: boolean) => {
    set({ festivalStarted: started });
  },

  toggleShowPastSets: () => {
    set((state) => ({
      showPastSets: !state.showPastSets,
    }));
  },

  toggleAutoScrollToNow: () => {
    set((state) => ({
      autoScrollToNow: !state.autoScrollToNow,
    }));
  },
});

export const useFestivalModeStore = create<FestivalModeStore>()(
  festivalModeStore,
);
