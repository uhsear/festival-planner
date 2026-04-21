import { useCrewStore } from './crewStore';
import { useUIStore } from './uiStore';
import { useFestivalStore } from './festivalStore';

export function resetAllStores(): void {
  useFestivalStore.setState({
    festivals: [], currentFestivalId: null, currentFestival: null,
    currentProfile: null, allProfiles: [], sets: [], stages: [], days: [],
    selectedDay: 0, activeStages: [], searchQuery: '', error: null,
  });
  useCrewStore.setState({
    crews: [], activeCrew: null, crewMembers: [], crewOverlap: {},
    crewLoading: false, error: null,
  });
  useUIStore.setState({
    detailSet: null, connected: false, offlineMode: false,
    pendingSync: 0, onlineUsers: [],
  });
}
