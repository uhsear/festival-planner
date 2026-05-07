import { create } from 'zustand';

export interface FestivalUIState {
  selectedDay: number;
  activeStages: string[];
  searchQuery: string;
}

export interface FestivalUIActions {
  setSelectedDay: (dayIndex: number) => void;
  setActiveStages: (stageIds: string[]) => void;
  setSearchQuery: (query: string) => void;
}

export type FestivalUIStore = FestivalUIState & FestivalUIActions;

export const useFestivalUIStore = create<FestivalUIStore>()((set) => ({
  selectedDay: 0,
  activeStages: [],
  searchQuery: '',

  setSelectedDay: (dayIndex: number) => {
    set({ selectedDay: dayIndex });
  },

  setActiveStages: (stageIds: string[]) => {
    set({ activeStages: stageIds });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
}));
