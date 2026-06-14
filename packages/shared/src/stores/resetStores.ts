import { useCrewStore } from './crewStore';
import { useUIStore } from './uiStore';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useFestivalModeStore } from './festivalModeStore';
import { useLiveLocationStore } from './liveLocationStore';
import { clearPersistedFailed } from '../services/offlineQueue';

export function resetAllStores(): void {
  useFestivalDataStore.setState({
    festivals: [],
    currentFestivalId: null,
    currentFestival: null,
    currentProfile: null,
    allProfiles: [],
    sets: [],
    stages: [],
    days: [],
    error: null,
  });
  useFestivalUIStore.setState({
    selectedDay: 0,
    activeStages: [],
    searchQuery: '',
    onlyMine: false,
  });
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    crewOverlap: {},
    polls: [],
    meetingPoints: [],
    packingItems: [],
    rideOffers: [],
    crewStatuses: [],
    expenses: [],
    expenseBalances: [],
    settlements: [],
    activity: [],
    crewLoading: false,
    error: null,
    _cachedAt: null,
    _cachedCrewId: null,
  });
  useUIStore.setState({
    detailSet: null,
    detailAutoSpotify: false,
    connected: false,
    offlineMode: false,
    pendingSync: 0,
    failedSync: [],
    onlineUsers: [],
    toasts: [],
  });
  useFestivalModeStore.setState({
    isFestivalMode: false,
    festivalStarted: false,
    showPastSets: true,
    autoScrollToNow: false,
    manuallyDisabled: false,
  });
  useLiveLocationStore.getState().reset();
  void clearPersistedFailed();
}
