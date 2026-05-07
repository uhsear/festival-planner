import { describe, it, expect, beforeEach } from 'vitest';
import { resetAllStores } from './resetStores';
import { useCrewStore } from './crewStore';
import { useUIStore } from './uiStore';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useFestivalModeStore } from './festivalModeStore';

describe('resetAllStores', () => {
  beforeEach(() => {
    // Dirty all stores with non-default values
    useFestivalDataStore.setState({
      festivals: [{ id: 'f1' } as any],
      currentFestivalId: 'f1',
      currentFestival: { id: 'f1' } as any,
      currentProfile: { id: 'p1' } as any,
      allProfiles: [{ id: 'p1' } as any],
      sets: [{ id: 's1' } as any],
      stages: [{ id: 'st1' } as any],
      days: [{ id: 'd1' } as any],
      error: 'some error',
    });
    useFestivalUIStore.setState({
      selectedDay: 3,
      activeStages: ['st1', 'st2'],
      searchQuery: 'test',
    });
    useCrewStore.setState({
      crews: [{ id: 'c1' } as any],
      activeCrew: { id: 'c1' } as any,
      crewMembers: [{ id: 'cm1' } as any],
      crewOverlap: { 's1': {} as any },
      crewLoading: true,
      error: 'crew error',
    });
    useUIStore.setState({
      detailSet: { id: 'ds1' } as any,
      connected: true,
      offlineMode: true,
      pendingSync: 5,
      onlineUsers: [{ id: 'u1' } as any],
    });
    useFestivalModeStore.setState({
      isFestivalMode: true,
      festivalStarted: true,
      showPastSets: false,
      autoScrollToNow: true,
      manuallyDisabled: true,
    });
  });

  it('resets festivalDataStore to defaults', () => {
    resetAllStores();
    const state = useFestivalDataStore.getState();
    expect(state.festivals).toEqual([]);
    expect(state.currentFestivalId).toBeNull();
    expect(state.currentFestival).toBeNull();
    expect(state.currentProfile).toBeNull();
    expect(state.allProfiles).toEqual([]);
    expect(state.sets).toEqual([]);
    expect(state.stages).toEqual([]);
    expect(state.days).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('resets festivalUIStore to defaults', () => {
    resetAllStores();
    const state = useFestivalUIStore.getState();
    expect(state.selectedDay).toBe(0);
    expect(state.activeStages).toEqual([]);
    expect(state.searchQuery).toBe('');
  });

  it('resets crewStore to defaults', () => {
    resetAllStores();
    const state = useCrewStore.getState();
    expect(state.crews).toEqual([]);
    expect(state.activeCrew).toBeNull();
    expect(state.crewMembers).toEqual([]);
    expect(state.crewOverlap).toEqual({});
    expect(state.crewLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('resets uiStore to defaults', () => {
    resetAllStores();
    const state = useUIStore.getState();
    expect(state.detailSet).toBeNull();
    expect(state.connected).toBe(false);
    expect(state.offlineMode).toBe(false);
    expect(state.pendingSync).toBe(0);
    expect(state.onlineUsers).toEqual([]);
  });

  it('resets festivalModeStore to defaults', () => {
    resetAllStores();
    const state = useFestivalModeStore.getState();
    expect(state.isFestivalMode).toBe(false);
    expect(state.festivalStarted).toBe(false);
    expect(state.showPastSets).toBe(true);
    expect(state.autoScrollToNow).toBe(false);
    expect(state.manuallyDisabled).toBe(false);
  });
});
