import { create } from 'zustand';

export interface FestivalUIState {
  selectedDay: number;
  activeStages: string[];
  searchQuery: string;
  /** When true, the schedule shows only sets the user has picked. */
  onlyMine: boolean;
}

export interface FestivalUIActions {
  setSelectedDay: (dayIndex: number) => void;
  setActiveStages: (stageIds: string[]) => void;
  setSearchQuery: (query: string) => void;
  setOnlyMine: (onlyMine: boolean) => void;
}

export type FestivalUIStore = FestivalUIState & FestivalUIActions;

export const useFestivalUIStore = create<FestivalUIStore>()((set) => ({
  selectedDay: 0,
  activeStages: [],
  searchQuery: '',
  onlyMine: false,

  setSelectedDay: (dayIndex: number) => {
    set({ selectedDay: dayIndex });
  },

  setOnlyMine: (onlyMine: boolean) => {
    set({ onlyMine });
  },

  setActiveStages: (stageIds: string[]) => {
    set({ activeStages: stageIds });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
}));
