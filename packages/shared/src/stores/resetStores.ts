import { useCrewStore } from './crewStore';
import { useUIStore } from './uiStore';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useFestivalModeStore } from './festivalModeStore';

export function resetAllStores(): void {
  useFestivalDataStore.setState({
    festivals: [], currentFestivalId: null, currentFestival: null,
    currentProfile: null, allProfiles: [], sets: [], stages: [], days: [],
    error: null,
  });
  useFestivalUIStore.setState({
    selectedDay: 0, activeStages: [], searchQuery: '',
  });
  useCrewStore.setState({
    crews: [], activeCrew: null, crewMembers: [], crewOverlap: {},
    crewLoading: false, error: null,
  });
  useUIStore.setState({
    detailSet: null, connected: false, offlineMode: false,
    pendingSync: 0, onlineUsers: [],
  });
  useFestivalModeStore.setState({
    isFestivalMode: false, festivalStarted: false, showPastSets: true,
    autoScrollToNow: false, manuallyDisabled: false,
  });
}
