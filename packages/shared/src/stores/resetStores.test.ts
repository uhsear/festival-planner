import { describe, it, expect, beforeEach } from 'vitest';
import { resetAllStores } from './resetStores';
import { useCrewStore } from './crewStore';
import { useUIStore } from './uiStore';
import { useFestivalDataStore } from './festivalDataStore';
import { useFestivalUIStore } from './festivalUIStore';
import { useFestivalModeStore } from './festivalModeStore';
import { useLiveLocationStore } from './liveLocationStore';
import { useOfflineReadinessStore } from './offlineReadinessStore';
import { useNotificationPrefsStore, DEFAULT_NOTIFICATION_PREFS } from './notificationPrefsStore';

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
      crewOverlap: { s1: {} as any },
      crewLoading: true,
      error: 'crew error',
    });
    useUIStore.setState({
      detailSet: { id: 'ds1' } as any,
      connected: true,
      offlineMode: true,
      pendingSync: 5,
      failedSync: [{ clientId: 'x', label: 'test', method: 'PUT', url: '/x', error: 'err', at: 1 }],
      onlineUsers: [{ id: 'u1' } as any],
    });
    useLiveLocationStore.getState().startSharing('crew-1');
    useFestivalModeStore.setState({
      isFestivalMode: true,
      festivalStarted: true,
      showPastSets: false,
      autoScrollToNow: true,
      manuallyDisabled: true,
      lowPowerMode: true,
    });
    useOfflineReadinessStore.setState({
      byFestival: {
        'fest-1': {
          schedule: { status: 'ready', syncedAt: 1 },
          picks: { status: 'ready', syncedAt: 1 },
          crew: { status: 'ready', syncedAt: 1 },
          weather: { status: 'ready', syncedAt: 1 },
          art: { status: 'ready', syncedAt: 1 },
        },
      },
      downloadingFestivalId: 'fest-1',
    });
    useNotificationPrefsStore.setState({
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, setReminders: false, dndStart: '23:00', dndEnd: '08:00' },
      loaded: true,
      isLoading: false,
      error: 'stale error',
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

  it('resets uiStore to defaults (including failedSync)', () => {
    resetAllStores();
    const state = useUIStore.getState();
    expect(state.detailSet).toBeNull();
    expect(state.connected).toBe(false);
    expect(state.offlineMode).toBe(false);
    expect(state.pendingSync).toBe(0);
    expect(state.failedSync).toEqual([]);
    expect(state.onlineUsers).toEqual([]);
  });

  it('resets liveLocationStore to defaults', () => {
    expect(useLiveLocationStore.getState().sharingCrewId).toBe('crew-1');
    resetAllStores();
    const state = useLiveLocationStore.getState();
    expect(state.sharingCrewId).toBeNull();
    expect(state.crewId).toBeNull();
    expect(state.peers).toEqual({});
    expect(state.sos).toBeNull();
  });

  it('resets festivalModeStore to defaults', () => {
    resetAllStores();
    const state = useFestivalModeStore.getState();
    expect(state.isFestivalMode).toBe(false);
    expect(state.festivalStarted).toBe(false);
    expect(state.showPastSets).toBe(true);
    expect(state.autoScrollToNow).toBe(false);
    expect(state.manuallyDisabled).toBe(false);
    // lowPowerMode must reset too, or user A's power preference leaks to user B
    // on a shared device (persisted by festivalModeStore's partialize).
    expect(state.lowPowerMode).toBe(false);
  });

  it('resets offlineReadinessStore.byFestival to defaults', () => {
    resetAllStores();
    const state = useOfflineReadinessStore.getState();
    expect(state.byFestival).toEqual({});
    expect(state.downloadingFestivalId).toBeNull();
  });

  it('resets notificationPrefsStore to defaults', () => {
    resetAllStores();
    const state = useNotificationPrefsStore.getState();
    expect(state.prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(state.loaded).toBe(false);
    expect(state.error).toBeNull();
  });
});
